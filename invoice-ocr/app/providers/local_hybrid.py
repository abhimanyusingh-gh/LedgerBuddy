from __future__ import annotations

import re
from threading import Lock
from typing import Any

from ..boundary import OCRProvider
from .local_apple_vision import LocalAppleVisionOCRProvider
from .local_mlx import LocalMlxOCRProvider
from ..engine import estimate_confidence
from ..logging import log_error, log_info
from ..settings import settings


class LocalHybridOCRProvider(OCRProvider):
  def __init__(self) -> None:
    self.lock = Lock()
    self.deepseek = LocalMlxOCRProvider()
    self.apple = LocalAppleVisionOCRProvider()

  def startup(self) -> None:
    self.deepseek.startup()
    self.apple.startup()

  def health(self) -> dict[str, Any]:
    deepseek_health = self.deepseek.health()
    apple_health = self.apple.health()
    deepseek_status = str(deepseek_health.get("status", "error")).lower()
    apple_status = str(apple_health.get("status", "error")).lower()
    status = "ok"
    if deepseek_status not in {"ok", "ready", "healthy"} and apple_status not in {"ok", "ready", "healthy"}:
      status = "error"

    return {
      "status": status,
      "modelId": settings.model_id,
      "modelLoaded": bool(deepseek_health.get("modelLoaded", False) or apple_health.get("modelLoaded", False)),
      "modelLoading": bool(deepseek_health.get("modelLoading", False)),
      "mode": "local_hybrid",
      "lastError": deepseek_health.get("lastError", ""),
      "provider": "local_hybrid",
      "providers": {
        "deepseek": deepseek_health,
        "appleVision": apple_health
      }
    }

  def list_models(self) -> list[dict[str, Any]]:
    models = []
    models.extend(self.deepseek.list_models())
    models.extend(self.apple.list_models())
    return models

  def extract_document(
    self,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    include_layout: bool,
    max_tokens: int
  ) -> dict[str, Any]:
    with self.lock:
      deepseek_result: dict[str, Any] | None = None
      apple_result: dict[str, Any] | None = None

      if settings.hybrid_deepseek_enabled:
        try:
          # Run DeepSeek text-only in hybrid mode. Apple Vision provides stable layout blocks.
          deepseek_result = self.deepseek.extract_document(
            image_bytes=image_bytes,
            mime_type=mime_type,
            prompt="",
            include_layout=False,
            max_tokens=max_tokens
          )
        except Exception as error:
          log_error("ocr.hybrid.deepseek.failed", mimeType=mime_type, error=str(error))
      else:
        log_info("ocr.hybrid.deepseek.disabled", includeLayout=include_layout, mimeType=mime_type)

      should_run_apple = include_layout or deepseek_result is None or _should_run_apple_second_pass(deepseek_result, False)
      if should_run_apple:
        try:
          apple_result = self.apple.extract_document(
            image_bytes=image_bytes,
            mime_type=mime_type,
            prompt=prompt,
            include_layout=include_layout,
            max_tokens=max_tokens
          )
        except Exception as error:
          log_error("ocr.hybrid.apple.failed", mimeType=mime_type, error=str(error))

      if deepseek_result is None and apple_result is None:
        raise RuntimeError("Both DeepSeek MLX and Apple Vision OCR failed.")

      if deepseek_result is not None and apple_result is not None:
        deepseek_score = _score_result(deepseek_result, False)
        apple_score = _score_result(apple_result, include_layout)
        log_info(
          "ocr.hybrid.selection",
          selected="deepseek_text+apple_layout",
          deepseekScore=round(deepseek_score, 4),
          appleScore=round(apple_score, 4),
          includeLayout=include_layout
        )
        return _compose_hybrid_result(deepseek_result, apple_result, include_layout)

      if deepseek_result is not None:
        return _merge_mode(deepseek_result, "local_hybrid_deepseek_text")

      return _merge_mode(apple_result, "local_hybrid_apple")


def _compose_hybrid_result(
  deepseek_result: dict[str, Any],
  apple_result: dict[str, Any],
  include_layout: bool
) -> dict[str, Any]:
  deepseek_text = str(deepseek_result.get("rawText", "")).strip()
  apple_text = str(apple_result.get("rawText", "")).strip()
  apple_text_source = str(apple_result.get("rawTextSource", "")).strip().lower()

  merged = dict(deepseek_result if deepseek_text else apple_result)
  merged["rawText"] = apple_text if apple_text and apple_text_source == "pdf_text_layer" else (deepseek_text if deepseek_text else apple_text)

  if include_layout:
    merged["blocks"] = apple_result.get("blocks", [])
    page_images = apple_result.get("pageImages")
    if isinstance(page_images, list):
      merged["pageImages"] = page_images
  if apple_text_source:
    merged["rawTextSource"] = apple_text_source

  deepseek_confidence = _read_confidence(deepseek_result.get("confidence"))
  apple_confidence = _read_confidence(apple_result.get("confidence"))
  confidence_candidates = [value for value in (deepseek_confidence, apple_confidence) if value is not None]
  if confidence_candidates:
    merged["confidence"] = max(confidence_candidates)

  return _merge_mode(
    merged,
    "local_hybrid_deepseek_text_apple_layout" if include_layout else "local_hybrid_deepseek_text"
  )


def _score_result(result: dict[str, Any], include_layout: bool) -> float:
  text = str(result.get("rawText", "")).strip()
  blocks = result.get("blocks")
  block_list = blocks if isinstance(blocks, list) else []

  confidence = _read_confidence(result.get("confidence"))
  if confidence is None:
    confidence = estimate_confidence(text, block_list)

  token_count = len([token for token in re.split(r"\s+", text) if token.strip()])
  token_score = min(1.0, token_count / 140.0)
  block_score = min(1.0, len(block_list) / 60.0) if include_layout else 0.0
  weighted = (confidence * 0.7) + (token_score * 0.2) + (block_score * 0.1)
  return max(0.0, min(1.0, weighted))


def _should_run_apple_second_pass(result: dict[str, Any], include_layout: bool) -> bool:
  confidence = _read_confidence(result.get("confidence"))
  blocks = result.get("blocks")
  block_list = blocks if isinstance(blocks, list) else []
  if confidence is not None and confidence >= settings.hybrid_apple_accept_score and (
    not include_layout or len(block_list) > 0
  ):
    return False
  return True


def _read_confidence(value: Any) -> float | None:
  try:
    parsed = float(value)
  except Exception:
    return None
  if parsed > 1:
    parsed = parsed / 100.0
  return max(0.0, min(1.0, parsed))


def _merge_mode(result: dict[str, Any], mode: str) -> dict[str, Any]:
  merged = dict(result)
  merged["mode"] = mode
  return merged
