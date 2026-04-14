from __future__ import annotations

import ast
import base64
import json
import re
from typing import Any

from fastapi import HTTPException

from .settings import settings

VISION_TOKEN_PATTERN = re.compile(r"<\|image_\d+\|>|<image>", re.IGNORECASE)
GENERATION_RESULT_PATTERN = re.compile(
  r"GenerationResult\(\s*text\s*=\s*(?P<literal>'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\")\s*,",
  re.DOTALL
)


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
    coords = [float(entry) for entry in value]
  except Exception:
    return None
  x1, y1 = min(coords[0], coords[2]), min(coords[1], coords[3])
  x2, y2 = max(coords[0], coords[2]), max(coords[1], coords[3])
  if x1 == x2 or y1 == y2:
    return None
  return [x1, y1, x2, y2]


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


def normalize_prompt(value: str, include_layout: bool = False) -> str:
  base_prompt = value if value.strip() else (settings.layout_prompt if include_layout else settings.text_prompt)
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

