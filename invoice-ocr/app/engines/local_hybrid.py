from __future__ import annotations

import re
from typing import Any

from .base import OCREngine
from .local_apple_vision import LocalAppleVisionOCREngine
from .local_mlx import LocalMlxOCREngine
from ..engine import estimate_confidence
from ..logging import log_error, log_info
from ..settings import settings


class LocalHybridOCREngine(OCREngine):
  def __init__(self) -> None:
    self.deepseek = LocalMlxOCREngine()
    self.apple = LocalAppleVisionOCREngine()

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
      "engine": "local_hybrid",
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
    deepseek_result: dict[str, Any] | None = None
    apple_result: dict[str, Any] | None = None

    try:
      deepseek_result = self.deepseek.extract_document(
        image_bytes=image_bytes,
        mime_type=mime_type,
        prompt=prompt,
        include_layout=include_layout,
        max_tokens=max_tokens
      )
    except Exception as error:
      log_error("ocr.hybrid.deepseek.failed", mimeType=mime_type, error=str(error))

    should_run_apple = deepseek_result is None or _should_run_apple_second_pass(deepseek_result, include_layout)
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

    if deepseek_result is not None and apple_result is None:
      return _merge_mode(deepseek_result, "local_hybrid_deepseek")

    if deepseek_result is None and apple_result is not None:
      return _merge_mode(apple_result, "local_hybrid_apple")

    deepseek_score = _score_result(deepseek_result, include_layout)
    apple_score = _score_result(apple_result, include_layout)
    selected = deepseek_result if deepseek_score >= apple_score else apple_result
    selected_name = "deepseek" if selected is deepseek_result else "apple_vision"
    log_info(
      "ocr.hybrid.selection",
      selected=selected_name,
      deepseekScore=round(deepseek_score, 4),
      appleScore=round(apple_score, 4),
      includeLayout=include_layout
    )
    return _merge_mode(selected, f"local_hybrid_{selected_name}")


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
