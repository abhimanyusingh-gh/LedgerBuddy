from __future__ import annotations

import json
import re
import time
from threading import Lock, Thread
from typing import Any

from mlx_lm import generate, load

from .base import LLMEngine
from ..logging import log_error, log_info
from ..settings import settings

SYSTEM_PROMPT = (
  "You are an invoice field verification engine. "
  "Return one JSON object only. "
  "Never return markdown. "
  "Never explain. "
  "Never invent values that are not present in candidates or OCR blocks."
)


class LocalMlxLLMEngine(LLMEngine):
  def __init__(self) -> None:
    self.lock = Lock()
    self.loaded = False
    self.loading = False
    self.last_error = ""
    self.model: Any = None
    self.tokenizer: Any = None

  def startup(self) -> None:
    if settings.load_on_startup:
      Thread(target=self._preload, daemon=True, name="slm-preload").start()

  def health(self) -> dict[str, Any]:
    status = "ok"
    if self.loading:
      status = "loading"
    elif settings.load_on_startup and not self.loaded:
      status = "starting"
    elif self.last_error:
      status = "error"
    return {
      "status": status,
      "modelId": settings.model_id,
      "modelLoaded": self.loaded,
      "modelLoading": self.loading,
      "lastError": self.last_error,
      "engine": "local_mlx"
    }

  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    self._ensure_loaded()
    if self.model is None or self.tokenizer is None:
      raise RuntimeError("SLM model is not initialized.")

    prompt = build_prompt(self.tokenizer, payload)
    output = generate(
      self.model,
      self.tokenizer,
      prompt=prompt,
      verbose=False,
      max_tokens=settings.max_new_tokens
    )
    parsed = parse_json_object(str(output))
    if parsed is None:
      raise RuntimeError("SLM output was not valid JSON.")
    return parsed

  def _preload(self) -> None:
    try:
      self._ensure_loaded()
    except Exception:
      pass

  def _ensure_loaded(self) -> None:
    if self.loaded:
      return

    with self.lock:
      if self.loaded:
        return

      self.loading = True
      started_at = time.perf_counter()
      try:
        model, tokenizer = load(resolve_model_reference())
        self.model = model
        self.tokenizer = tokenizer
        self.loaded = True
        self.last_error = ""
        log_info(
          "slm.model.load.complete",
          modelId=settings.model_id,
          latencyMs=int((time.perf_counter() - started_at) * 1000)
        )
      except Exception as error:
        self.last_error = str(error)
        log_error("slm.model.load.failed", modelId=settings.model_id, error=str(error))
        raise
      finally:
        self.loading = False


def resolve_model_reference() -> str:
  return settings.model_path if settings.model_path else settings.model_id


def build_prompt(tokenizer: Any, payload: dict[str, Any]) -> str:
  instruction = (
    "Use OCR text blocks and bounding boxes to choose invoice fields. "
    "Output schema must be exactly: "
    "{\"selected\":{\"invoiceNumber\":\"\",\"vendorName\":\"\",\"currency\":\"\",\"totalAmountMinor\":0,"
    "\"invoiceDate\":\"\",\"dueDate\":\"\"},\"reasonCodes\":{},\"issues\":[]} "
    "Rules: vendorName cannot be an address; totalAmountMinor must be integer minor units; "
    "if unknown keep empty string or 0."
  )
  user_message = f"{instruction}\nINPUT_JSON:{json.dumps(payload, ensure_ascii=True, separators=(',', ':'))}\nOUTPUT_JSON:"
  return str(
    tokenizer.apply_chat_template(
      [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_message}
      ],
      add_generation_prompt=True
    )
  )


def parse_json_object(text: str) -> dict[str, Any] | None:
  candidate = text.strip()
  if not candidate:
    return None

  parsed = try_parse_json(candidate)
  if parsed is not None:
    return parsed

  for match in re.finditer(r"\{", candidate):
    start = match.start()
    for end in range(len(candidate), start, -1):
      parsed = try_parse_json(candidate[start:end])
      if parsed is not None:
        return parsed

  return None


def try_parse_json(text: str) -> dict[str, Any] | None:
  try:
    parsed = json.loads(text)
  except Exception:
    return None
  return parsed if isinstance(parsed, dict) else None
