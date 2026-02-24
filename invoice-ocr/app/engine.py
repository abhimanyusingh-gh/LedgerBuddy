from __future__ import annotations

import ast
import base64
import io
import json
import re
from typing import Any

from fastapi import HTTPException
from PIL import Image
import pypdfium2 as pdfium

from .settings import settings

GROUNDING_BLOCK_PATTERN = re.compile(
  r"<\|ref\|>(?P<label>.*?)<\|/ref\|><\|det\|>(?P<det>.*?)<\|/det\|>(?P<body>.*?)(?=<\|ref\|>|\Z)",
  re.DOTALL
)
GENERATION_RESULT_PATTERN = re.compile(
  r"GenerationResult\(\s*text\s*=\s*(?P<literal>'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\")\s*,",
  re.DOTALL
)
VISION_TOKEN_PATTERN = re.compile(r"<\|image_\d+\|>|<image>", re.IGNORECASE)
PDF_RENDER_DPI = 300
PDF_RENDER_SCALE = PDF_RENDER_DPI / 72.0


def parse_data_url(data_url: str) -> tuple[str, bytes]:
  try:
    header, encoded = data_url.split(",", 1)
  except ValueError as error:
    raise HTTPException(status_code=400, detail="Invalid data URL format.") from error

  if not header.startswith("data:") or ";base64" not in header:
    raise HTTPException(status_code=400, detail="Only base64 data URLs are supported.")

  mime_type = header[5:].split(";")[0].strip() or "application/octet-stream"
  try:
    image_bytes = base64.b64decode(encoded, validate=True)
  except Exception as error:
    raise HTTPException(status_code=400, detail=f"Invalid base64 image payload: {error}") from error
  return mime_type, image_bytes


def normalize_text(value: Any) -> str | None:
  if not isinstance(value, str):
    return None
  trimmed = value.strip()
  return trimmed if trimmed else None


def normalize_blocks(value: Any) -> list[dict[str, Any]]:
  if not isinstance(value, list):
    return []
  blocks: list[dict[str, Any]] = []
  for entry in value:
    if not isinstance(entry, dict):
      continue
    text = normalize_text(entry.get("text"))
    bbox = normalize_bbox(entry.get("bbox"))
    if not text or not bbox:
      continue
    page = normalize_page(entry.get("page"))
    block_type = str(entry.get("blockType", "text")).strip().lower() or "text"
    bbox_model = normalize_bbox(entry.get("bboxModel"))
    bbox_normalized = normalize_bbox(entry.get("bboxNormalized"))
    blocks.append(
      {
        "text": text,
        "bbox": [int(round(bbox[0])), int(round(bbox[1])), int(round(bbox[2])), int(round(bbox[3]))],
        "page": page,
        "blockType": block_type,
        "bboxModel": bbox_model,
        "bboxNormalized": bbox_normalized
      }
    )
  return blocks


def normalize_page(value: Any) -> int:
  try:
    parsed = int(value)
  except Exception:
    return 1
  return parsed if parsed > 0 else 1


def normalize_bbox(value: Any) -> list[float] | None:
  if not isinstance(value, list) or len(value) != 4:
    return None
  try:
    return [float(entry) for entry in value]
  except Exception:
    return None


def normalize_remote_confidence(value: Any) -> float | None:
  if isinstance(value, (int, float)):
    parsed = float(value)
  elif isinstance(value, str):
    try:
      parsed = float(value.strip())
    except ValueError:
      return None
  else:
    return None
  if parsed > 1:
    parsed = parsed / 100.0
  return max(0.0, min(1.0, round(parsed, 4)))


def resolve_prompt(prompt: str, include_layout: bool) -> str:
  base_prompt = prompt if prompt.strip() else (settings.layout_prompt if include_layout else settings.text_prompt)
  normalized = sanitize_prompt(base_prompt)
  if normalized:
    return normalized
  fallback = settings.layout_prompt if include_layout else settings.text_prompt
  return sanitize_prompt(fallback)


def sanitize_prompt(value: str) -> str:
  sanitized = VISION_TOKEN_PATTERN.sub(" ", value)
  sanitized = re.sub(r"[ \t]+\n", "\n", sanitized)
  sanitized = re.sub(r"\n[ \t]+", "\n", sanitized)
  sanitized = re.sub(r"[ \t]{2,}", " ", sanitized)
  sanitized = re.sub(r"\n{3,}", "\n\n", sanitized)
  return sanitized.strip()


def normalize_model_output(response: Any) -> str:
  if response is None:
    return ""
  direct_text = getattr(response, "text", None)
  if isinstance(direct_text, str):
    return cleanup_generated_text(direct_text)
  if isinstance(response, str):
    return cleanup_generated_text(response)
  if isinstance(response, dict):
    for key in ("text", "output", "response", "generated_text", "content"):
      value = response.get(key)
      if isinstance(value, str):
        return cleanup_generated_text(value)
    return cleanup_generated_text(json.dumps(response, ensure_ascii=False))
  if isinstance(response, list):
    for entry in response:
      entry_text = getattr(entry, "text", None)
      if isinstance(entry_text, str):
        return cleanup_generated_text(entry_text)
      if isinstance(entry, str):
        return cleanup_generated_text(entry)
      if isinstance(entry, dict):
        for key in ("text", "output", "response", "generated_text", "content"):
          value = entry.get(key)
          if isinstance(value, str):
            return cleanup_generated_text(value)
    return cleanup_generated_text(json.dumps(response, ensure_ascii=False))
  return cleanup_generated_text(str(response))


def cleanup_generated_text(text: str) -> str:
  output = unwrap_generation_result(text.strip())
  for marker in ("<|endoftext|>", "<|im_end|>", "</s>"):
    output = output.replace(marker, "")
  return output.strip()


def unwrap_generation_result(value: str) -> str:
  if "GenerationResult(" not in value:
    return value
  decoded_segments: list[str] = []
  for match in GENERATION_RESULT_PATTERN.finditer(value):
    decoded = decode_python_string_literal(match.group("literal"))
    if isinstance(decoded, str) and decoded.strip():
      decoded_segments.append(decoded.strip())

  if not decoded_segments:
    return value

  page_markers = re.findall(r"\[page\s+(\d+)\]", value, flags=re.IGNORECASE)
  if len(page_markers) == len(decoded_segments):
    chunks = [f"[page {page_markers[index]}]\n{decoded_segments[index]}" for index in range(len(decoded_segments))]
    return "\n\n".join(chunks)

  return "\n\n".join(decoded_segments)


def decode_python_string_literal(value: str) -> str | None:
  try:
    decoded = ast.literal_eval(value)
  except Exception:
    return None
  return decoded if isinstance(decoded, str) else None


def open_image(image_bytes: bytes) -> Image.Image:
  image = Image.open(io.BytesIO(image_bytes))
  image.load()
  return image


def render_pdf_pages(pdf_bytes: bytes, max_pages: int) -> list[tuple[int, bytes, int, int]]:
  pages: list[tuple[int, bytes, int, int]] = []
  document = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
  try:
    total_pages = len(document)
    for page_index in range(min(total_pages, max_pages)):
      page = document.get_page(page_index)
      try:
        bitmap = page.render(scale=PDF_RENDER_SCALE)
        pil_image = bitmap.to_pil()
      finally:
        page.close()

      image_buffer = io.BytesIO()
      pil_image.save(image_buffer, format="PNG")
      pages.append((page_index + 1, image_buffer.getvalue(), pil_image.width, pil_image.height))
      pil_image.close()
  finally:
    document.close()
  return pages


def parse_grounding_blocks(raw_text: str, image_width: int = 1000, image_height: int = 1000) -> list[dict[str, Any]]:
  if not raw_text:
    return []

  blocks: list[dict[str, Any]] = []
  for match in GROUNDING_BLOCK_PATTERN.finditer(raw_text):
    label = normalize_block_label(match.group("label"))
    body = normalize_block_payload(match.group("body"))
    if not body:
      continue

    det_entries = parse_det_coordinates(match.group("det"))
    for entry in det_entries:
      bbox_model = [clamp_model_coordinate(entry[0]), clamp_model_coordinate(entry[1]), clamp_model_coordinate(entry[2]), clamp_model_coordinate(entry[3])]
      bbox_pixels = model_bbox_to_pixels(bbox_model, image_width, image_height)
      bbox_normalized = [
        round(max(0.0, min(1.0, bbox_pixels[0] / max(1, image_width))), 6),
        round(max(0.0, min(1.0, bbox_pixels[1] / max(1, image_height))), 6),
        round(max(0.0, min(1.0, bbox_pixels[2] / max(1, image_width))), 6),
        round(max(0.0, min(1.0, bbox_pixels[3] / max(1, image_height))), 6)
      ]
      blocks.append(
        {
          "text": body,
          "bbox": bbox_pixels,
          "bboxModel": bbox_model,
          "bboxNormalized": bbox_normalized,
          "page": 1,
          "blockType": classify_block_type(label)
        }
      )
  return blocks


def parse_det_coordinates(raw_coordinates: str) -> list[list[float]]:
  stripped = raw_coordinates.strip()
  if not stripped:
    return []
  sanitized = sanitize_coordinate_string(stripped)
  parsed = parse_det_with_ast(sanitized)
  if parsed:
    return parsed

  matches = re.findall(r"\[\s*([\d.\-]+)\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)\s*,\s*([\d.\-]+)\s*\]", sanitized)
  output: list[list[float]] = []
  for left, top, right, bottom in matches:
    try:
      output.append([float(left), float(top), float(right), float(bottom)])
    except ValueError:
      continue
  return output


def sanitize_coordinate_string(value: str) -> str:
  sanitized = value.replace("\n", " ").replace("(", "[").replace(")", "]")
  sanitized = re.sub(r",\s*]", "]", sanitized)
  return sanitized.strip()


def parse_det_with_ast(value: str) -> list[list[float]]:
  try:
    parsed = ast.literal_eval(value)
  except Exception:
    return []
  if not isinstance(parsed, list):
    return []
  output: list[list[float]] = []
  for entry in parsed:
    if isinstance(entry, (list, tuple)) and len(entry) == 4:
      try:
        output.append([float(entry[0]), float(entry[1]), float(entry[2]), float(entry[3])])
      except Exception:
        continue
  return output


def clamp_model_coordinate(value: float) -> float:
  if value < 0:
    return 0.0
  if value > 999:
    return 999.0
  return value


def model_bbox_to_pixels(bbox: list[float], width: int, height: int) -> list[int]:
  width_factor = max(1, width) / 999.0
  height_factor = max(1, height) / 999.0
  left = int(round(bbox[0] * width_factor))
  top = int(round(bbox[1] * height_factor))
  right = int(round(bbox[2] * width_factor))
  bottom = int(round(bbox[3] * height_factor))
  return [max(0, left), max(0, top), max(0, right), max(0, bottom)]


def classify_block_type(label: str) -> str:
  normalized = label.strip().lower()
  if normalized.startswith("table"):
    return "table"
  if normalized.startswith("kv") or "key" in normalized:
    return "field"
  return "text"


def normalize_block_payload(value: str) -> str:
  payload = value.replace("\r\n", "\n").replace("\r", "\n")
  payload = re.sub(r"\s+\n", "\n", payload)
  payload = re.sub(r"\n{3,}", "\n\n", payload)
  return payload.strip()


def normalize_block_label(value: str) -> str:
  return value.replace("\r", " ").replace("\n", " ").strip()


def estimate_confidence(text: str, blocks: list[dict[str, Any]]) -> float:
  if not text.strip():
    return 0.0
  tokens = [token for token in re.split(r"\s+", text.strip()) if token]
  if not tokens:
    return 0.0
  low_quality = sum(1 for token in tokens if is_low_quality_token(token))
  low_ratio = low_quality / len(tokens)
  block_bonus = min(0.15, len(blocks) * 0.002)
  base = 0.92 - (low_ratio * 0.55) + block_bonus
  return max(0.0, min(0.99, round(base, 4)))


def is_low_quality_token(token: str) -> bool:
  if len(token) == 1 and token not in {"I", "a", "A", "x", "X", "&"}:
    return True
  if re.search(r"[^\w@#&%$,.:/+\-]", token):
    return True
  if token.count("?") >= 1:
    return True
  if len(re.findall(r"\d", token)) > 0 and len(re.findall(r"[A-Za-z]", token)) > 0 and re.search(r"[^\w]", token):
    return True
  return False
