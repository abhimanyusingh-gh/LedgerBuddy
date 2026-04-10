from __future__ import annotations

import ast
import json
import re
import time
from threading import Lock, Thread
from typing import Any

from mlx_lm import generate, load

from ..boundary import LLMProvider
from ..logging import log_error, log_info
from ..settings import settings
from .shared import parse_json_object, recover_payload_from_candidates, recover_payload_from_text, sanitize_payload_for_prompt

GENERATION_RESULT_PATTERN = re.compile(
  r"GenerationResult\(\s*text\s*=\s*(?P<literal>'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\")\s*,",
  re.DOTALL
)
THINK_BLOCK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)


class LocalMlxLLMProvider(LLMProvider):
  def __init__(self) -> None:
    self.load_lock = Lock()
    self.generation_lock = Lock()
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
      "provider": "local_mlx"
    }

  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    self._ensure_loaded()
    if self.model is None or self.tokenizer is None:
      raise RuntimeError("SLM model is not initialized.")

    if payload.get("llmAssist"):
      log_info("slm.llm_assist.local_mlx_ignores_images", note="Local MLX provider does not support vision; running text-only re-extraction")

    with self.generation_lock:
      for strict in (False, True):
        prompt = build_prompt(self.tokenizer, payload, strict=strict)
        prompt_tokens = len(self.tokenizer.encode(prompt))
        output = generate(
          self.model,
          self.tokenizer,
          prompt=prompt,
          verbose=False,
          max_tokens=settings.max_new_tokens
        )
        output_text = extract_generation_text(output)
        if prompt.rstrip().endswith("{") and not output_text.lstrip().startswith("{"):
          output_text = "{" + output_text.lstrip()
        completion_tokens = len(self.tokenizer.encode(output_text))
        usage = {"promptTokens": prompt_tokens, "completionTokens": completion_tokens}
        log_info("slm.raw_output", output_length=len(output_text), completion_tokens=completion_tokens, first_200=output_text[:200], last_200=output_text[-200:] if len(output_text) > 200 else "")
        parsed = parse_json_object(output_text)
        if parsed is not None:
          parsed["_usage"] = usage
          return parsed
        recovered = recover_payload_from_text(output_text, payload)
        if recovered is not None:
          recovered["_usage"] = usage
          return recovered

    fallback = recover_payload_from_candidates(payload)
    if fallback is not None:
      return fallback

    return {
      "selected": {},
      "reasonCodes": {},
      "issues": ["slm_output_invalid_json"]
    }

  def call_prompt(self, prompt_text: str) -> dict[str, Any]:
    self._ensure_loaded()
    if self.model is None or self.tokenizer is None:
      raise RuntimeError("SLM model is not initialized.")

    with self.generation_lock:
      formatted = apply_chat_template(self.tokenizer, prompt_text)
      prompt_tokens = len(self.tokenizer.encode(formatted))
      output = generate(
        self.model,
        self.tokenizer,
        prompt=formatted,
        verbose=False,
        max_tokens=settings.max_new_tokens
      )
      output_text = extract_generation_text(output)
      completion_tokens = len(self.tokenizer.encode(output_text))
      usage = {"promptTokens": prompt_tokens, "completionTokens": completion_tokens}
      log_info("slm.raw_output", output_length=len(output_text), completion_tokens=completion_tokens, first_200=output_text[:200], last_200=output_text[-200:] if len(output_text) > 200 else "")
      parsed = parse_json_object(output_text)
      if parsed is not None:
        parsed["_usage"] = usage
        return parsed
      raise RuntimeError(f"MLX model returned non-JSON output: {output_text[:200]}")

  def _preload(self) -> None:
    try:
      self._ensure_loaded()
    except Exception:
      pass

  def _ensure_loaded(self) -> None:
    if self.loaded:
      return

    with self.load_lock:
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


def apply_chat_template(tokenizer: Any, user_content: str) -> str:
  try:
    formatted = str(
      tokenizer.apply_chat_template(
        [{"role": "user", "content": user_content}],
        tokenize=False,
        add_generation_prompt=True
      )
    )
    return formatted + "{"
  except Exception:
    return user_content + "\n{"


_DEFAULT_GL_CATEGORIES_MLX = [
  "Office Expenses", "Professional Services", "Rent", "Utilities", "Travel",
  "Contractor Services", "Raw Materials", "Commission", "Insurance",
  "Repairs & Maintenance", "Software Subscription", "Other"
]


def build_prompt(tokenizer: Any, payload: dict[str, Any], strict: bool) -> str:
  hints = payload.get("hints") if isinstance(payload.get("hints"), dict) else {}
  prior_corrections = hints.get("priorCorrections")
  prior_corrections_text = ""
  if isinstance(prior_corrections, list) and prior_corrections:
    parts = []
    for entry in prior_corrections[:6]:
      if isinstance(entry, dict) and isinstance(entry.get("field"), str) and isinstance(entry.get("hint"), str):
        parts.append(f"{entry['field']}: {entry['hint']}")
    if parts:
      prior_corrections_text = " PRIOR_CORRECTIONS: " + "; ".join(parts) + "."

  gl_list = ", ".join(
    [c for c in hints.get("glCategories", []) if isinstance(c, str) and c.strip()] or _DEFAULT_GL_CATEGORIES_MLX
  )
  instruction = (
    "Extract invoice data from INPUT_JSON. Return one JSON object only. No preamble, no markdown, no <think>.\n"
    "ocrText is layout-aware: each line = one visual row; ' | ' = column separator. Use to map labels to values.\n"
    "RULES:\n"
    "- invoiceNumber: DATES ARE NEVER INVOICE NUMBERS. Reject DD-Mon-YY (26-Feb-26), DD/MM/YYYY, YYYY-MM-DD even near 'Invoice No.'. Reject IRN/Ack/PO/Ref. Numbers contain letters+digits. Layout 'Invoice No. | X | Dated | Y' → X is invoiceNumber.\n"
    "- vendorName: top/header seller only. Never Bill To / Ship To / buyer.\n"
    "- invoiceDate: Invoice Date / Bill Date / Date label only. Reject Ack Date.\n"
    "- totalAmountMinor: Total/Grand Total/Amount Payable > Balance Due. Reject subtotal/tax lines. MUST be > cgst+sgst.\n"
    "- INR: all amounts × 100 for paise. Lakh 12,63,318 = 126331800 paise. OCR may render ₹ as $.\n"
    "- IGST=NA/0/blank → omit igstMinor.\n"
    f"- glCategory ∈ {{{gl_list}}}\n"
    + (prior_corrections_text if prior_corrections_text else "")
    + ("Verify output is valid JSON.\n" if strict else "")
  )

  prompt_payload = sanitize_payload_for_prompt(payload)
  user_message = (
    f"{instruction}\nINPUT_JSON:{json.dumps(prompt_payload, ensure_ascii=True, separators=(',', ':'))}\nOUTPUT_JSON:"
  )
  return apply_chat_template(tokenizer, user_message)


def extract_generation_text(output: Any) -> str:
  direct_text = getattr(output, "text", None)
  if isinstance(direct_text, str):
    return cleanup_generation_text(direct_text)
  if isinstance(output, str):
    return cleanup_generation_text(output)
  if isinstance(output, dict):
    for key in ("text", "output", "response", "generated_text", "content"):
      value = output.get(key)
      if isinstance(value, str):
        return cleanup_generation_text(value)
  return cleanup_generation_text(str(output))


def cleanup_generation_text(value: str) -> str:
  text = unwrap_generation_result(value.strip())
  text = THINK_BLOCK_PATTERN.sub("", text)
  text = text.replace("```json", "").replace("```", "")
  return text.strip()


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
  return "\n\n".join(decoded_segments)


def decode_python_string_literal(value: str) -> str | None:
  try:
    decoded = ast.literal_eval(value)
  except Exception:
    return None
  return decoded if isinstance(decoded, str) else None
