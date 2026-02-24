from __future__ import annotations

import base64
import time
from typing import Any

from Foundation import NSData
from Quartz import (
  CGImageGetHeight,
  CGImageGetWidth,
  CGImageSourceCreateImageAtIndex,
  CGImageSourceCreateWithData
)
import Vision

from .base import OCREngine
from ..engine import estimate_confidence, normalize_model_output, render_pdf_pages, resolve_prompt
from ..settings import settings


APPLE_VISION_MODEL_ID = "apple-vision-text-recognition"


class LocalAppleVisionOCREngine(OCREngine):
  def startup(self) -> None:
    return None

  def health(self) -> dict[str, Any]:
    return {
      "status": "ok",
      "modelId": APPLE_VISION_MODEL_ID,
      "modelLoaded": True,
      "modelLoading": False,
      "mode": "apple_vision",
      "lastError": "",
      "engine": "local_apple_vision"
    }

  def list_models(self) -> list[dict[str, Any]]:
    return [
      {
        "id": APPLE_VISION_MODEL_ID,
        "object": "model",
        "created": int(time.time()),
        "owned_by": "local"
      }
    ]

  def extract_document(
    self,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    include_layout: bool,
    max_tokens: int
  ) -> dict[str, Any]:
    _ = resolve_prompt(prompt, include_layout)
    _ = max_tokens
    if mime_type == "application/pdf":
      return self._extract_pdf(image_bytes, include_layout)
    return self._extract_image(image_bytes, 1, include_layout)

  def _extract_pdf(self, pdf_bytes: bytes, include_layout: bool) -> dict[str, Any]:
    pages = render_pdf_pages(pdf_bytes, settings.pdf_max_pages)
    if not pages:
      raise RuntimeError("No renderable pages found in PDF.")

    text_chunks: list[str] = []
    blocks: list[dict[str, Any]] = []
    page_images: list[dict[str, Any]] = []
    confidence_samples: list[float] = []

    for page_number, page_bytes, page_width, page_height in pages:
      page_images.append(
        {
          "page": page_number,
          "mimeType": "image/png",
          "width": page_width,
          "height": page_height,
          "dpi": 300,
          "dataUrl": f"data:image/png;base64,{base64.b64encode(page_bytes).decode('ascii')}"
        }
      )

      page_result = self._extract_image(page_bytes, page_number, include_layout)
      page_text = normalize_model_output(page_result.get("rawText"))
      if page_text:
        text_chunks.append(f"[page {page_number}]\n{page_text}")

      page_confidence = _read_confidence(page_result.get("confidence"))
      if page_confidence is not None:
        confidence_samples.append(page_confidence)

      if include_layout:
        page_blocks = page_result.get("blocks")
        if isinstance(page_blocks, list):
          blocks.extend(page_blocks)

    raw_text = "\n\n".join(text_chunks).strip()
    confidence = (
      sum(confidence_samples) / len(confidence_samples)
      if confidence_samples
      else estimate_confidence(raw_text, blocks)
    )

    return {
      "rawText": raw_text,
      "blocks": blocks if include_layout else [],
      "pageImages": page_images,
      "confidence": max(0.0, min(1.0, confidence)),
      "mode": "apple_vision_pdf",
      "model": APPLE_VISION_MODEL_ID,
      "provider": "apple-vision-local"
    }

  def _extract_image(self, image_bytes: bytes, page_number: int, include_layout: bool) -> dict[str, Any]:
    cg_image = _create_cg_image(image_bytes)
    width = int(CGImageGetWidth(cg_image))
    height = int(CGImageGetHeight(cg_image))
    if width <= 0 or height <= 0:
      raise RuntimeError("Unable to resolve image dimensions for Apple Vision OCR.")

    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    request.setUsesLanguageCorrection_(True)

    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg_image, {})
    success, error = handler.performRequests_error_([request], None)
    if not success:
      raise RuntimeError(f"Apple Vision OCR request failed: {error}")

    observations = request.results() or []
    blocks: list[dict[str, Any]] = []
    text_lines: list[str] = []
    weighted_confidence = 0.0
    weighted_length = 0

    for observation in observations:
      candidates = observation.topCandidates_(1)
      if not candidates:
        continue
      candidate = candidates[0]
      text = str(candidate.string()).strip()
      if not text:
        continue

      confidence = float(candidate.confidence())
      bbox_normalized = _observation_bbox_normalized(observation)
      if bbox_normalized is None:
        continue
      bbox = _bbox_pixels(bbox_normalized, width, height)
      if bbox is None:
        continue

      text_lines.append(text)
      weighted_confidence += confidence * max(1, len(text))
      weighted_length += max(1, len(text))
      if include_layout:
        blocks.append(
          {
            "text": text,
            "bbox": bbox,
            "bboxNormalized": bbox_normalized,
            "page": page_number,
            "blockType": "text"
          }
        )

    raw_text = "\n".join(text_lines).strip()
    confidence = (
      weighted_confidence / weighted_length
      if weighted_length > 0
      else estimate_confidence(raw_text, blocks)
    )

    return {
      "rawText": raw_text,
      "blocks": blocks if include_layout else [],
      "confidence": max(0.0, min(1.0, confidence)),
      "mode": "apple_vision",
      "model": APPLE_VISION_MODEL_ID,
      "provider": "apple-vision-local"
    }


def _create_cg_image(image_bytes: bytes):
  data = NSData.dataWithBytes_length_(image_bytes, len(image_bytes))
  source = CGImageSourceCreateWithData(data, None)
  if source is None:
    raise RuntimeError("Apple Vision OCR could not decode image payload.")
  cg_image = CGImageSourceCreateImageAtIndex(source, 0, None)
  if cg_image is None:
    raise RuntimeError("Apple Vision OCR could not create CGImage.")
  return cg_image


def _observation_bbox_normalized(observation: Any) -> list[float] | None:
  rect = observation.boundingBox()
  left = _clamp_unit(float(rect.origin.x))
  bottom = _clamp_unit(float(rect.origin.y))
  width = _clamp_unit(float(rect.size.width))
  height = _clamp_unit(float(rect.size.height))
  right = _clamp_unit(left + width)
  top_from_bottom = _clamp_unit(bottom + height)
  top = _clamp_unit(1.0 - top_from_bottom)
  lower = _clamp_unit(1.0 - bottom)
  if right <= left or lower <= top:
    return None
  return [round(left, 6), round(top, 6), round(right, 6), round(lower, 6)]


def _bbox_pixels(bbox_normalized: list[float], width: int, height: int) -> list[int] | None:
  left = int(round(bbox_normalized[0] * width))
  top = int(round(bbox_normalized[1] * height))
  right = int(round(bbox_normalized[2] * width))
  bottom = int(round(bbox_normalized[3] * height))
  left = max(0, min(width - 1, left))
  top = max(0, min(height - 1, top))
  right = max(left + 1, min(width, right))
  bottom = max(top + 1, min(height, bottom))
  if right <= left or bottom <= top:
    return None
  return [left, top, right, bottom]


def _read_confidence(value: Any) -> float | None:
  try:
    parsed = float(value)
  except Exception:
    return None
  if parsed > 1:
    parsed = parsed / 100.0
  return max(0.0, min(1.0, parsed))


def _clamp_unit(value: float) -> float:
  if value < 0:
    return 0.0
  if value > 1:
    return 1.0
  return value
