from __future__ import annotations

import ast
import re
from typing import Any


GROUNDING_BLOCK_PATTERN = re.compile(
  r"<\|ref\|>(?P<label>.*?)<\|/ref\|><\|det\|>(?P<det>.*?)<\|/det\|>(?P<body>.*?)(?=<\|ref\|>|\Z)",
  re.DOTALL
)


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
      if bbox_model[0] >= bbox_model[2] or bbox_model[1] >= bbox_model[3]:
        continue
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

