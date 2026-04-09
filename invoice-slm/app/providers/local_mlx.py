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
      prompt_tokens = len(self.tokenizer.encode(prompt_text))
      output = generate(
        self.model,
        self.tokenizer,
        prompt=prompt_text,
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

  instruction = (
    "Extract invoice data from INPUT_JSON.\n"
    "Return one JSON object only.\n"
    "No preamble. No markdown. No explanation. No <think>.\n"
    "Use only values present in INPUT_JSON. Use null or [] when missing.\n"
    "Rules:\n"
    "- Dates: YYYY-MM-DD; invoiceDate must be labeled Invoice Date, Bill Date, or Date; never use Ack Date, Acknowledgment Date, or IRN Date\n"
    "- Currency: ISO code from explicit symbols/codes in value blocks\n"
    "- Do not switch USD invoices to INR only because GST identifiers appear in addresses or tax ids\n"
    "- Amounts like 300/- or 300/= mean 30000 minor units\n"
    "- All *Minor fields must be integers in minor units (paise for INR): multiply rupee amount by 100\n"
    "- blockIndex must point to INPUT_JSON.ocrBlocks[index] that contains the value\n"
    "- vendorName is the issuing seller whose name appears at the top of the invoice; never use the Bill To, Ship To, Billed To, or To: section which contains the buyer\n"
    "- invoiceNumber is the human-readable invoice or bill number assigned by the issuer; reject IRN (64-character hex), Ack No (15+ digit number), PO numbers, Ref numbers, and Order numbers; reject any date-format string (DD-Mon-YY, DD/MM/YYYY, YYYY-MM-DD) — invoice numbers are alphanumeric with hyphens/slashes, never pure dates; for proforma invoices extract the proforma invoice number\n"
    "- Prefer grand total / total / amount payable rows for totalAmountMinor; reject subtotal, taxable value, and individual tax amounts; totalAmountMinor MUST be greater than cgstMinor + sgstMinor — if the candidate is ≤ any single tax component it is a tax line, not the total\n"
    "- OCR may render ₹ as $; treat $ as ₹ when currency is INR\n"
    "- Indian lakh-format amounts like 12,63,318 or 9,55,900 are rupees — multiply by 100 to get paise; never output the rupee value directly as a minor-unit integer\n"
    "- If IGST is shown as NA, blank, or 0, do not extract igstMinor\n"
    "- Prefer tax summary rows for gst totals, not per-line tax sums\n"
    "Extract:\n"
    "- invoiceNumber, vendorName, currency, totalAmountMinor, invoiceDate, dueDate\n"
    "- gst.gstin, gst.subtotalMinor, gst.cgstMinor, gst.sgstMinor, gst.igstMinor, gst.cessMinor, gst.totalTaxMinor\n"
    "- lineItems with description, hsnSac, quantity, rate, amountMinor, taxRate, cgstMinor, sgstMinor, igstMinor\n"
    "- _fieldConfidence, _fieldProvenance, _lineItemProvenance, _classification\n"
    "- _classification.glCategory must be one of: " + ", ".join(
      [c for c in hints.get("glCategories", []) if isinstance(c, str) and c.strip()] or _DEFAULT_GL_CATEGORIES_MLX
    ) + "\n"
    "Schema:\n"
    '{"selected":{"invoiceNumber":{"value":"","blockIndex":null},"vendorName":{"value":"","blockIndex":null},'
    '"currency":{"value":"","blockIndex":null},"totalAmountMinor":{"value":null,"blockIndex":null},'
    '"invoiceDate":{"value":null,"blockIndex":null},"dueDate":{"value":null,"blockIndex":null},'
    '"pan":null,"bankAccountNumber":null,"bankIfsc":null,"udyamNumber":null,'
    '"gst":{"gstin":null,"subtotalMinor":null,"cgstMinor":null,"sgstMinor":null,"igstMinor":null,"cessMinor":null,"totalTaxMinor":null},'
    '"lineItems":[],"_fieldConfidence":{},"_fieldProvenance":{},"_lineItemProvenance":[],"_classification":{}},'
    '"reasonCodes":{},"issues":[],"invoiceType":null}\n'
    + ("Final check: output must be valid JSON and match schema.\n" if strict else "")
    + "INPUT_JSON:\n"
    + prior_corrections_text
  )

  prompt_payload = sanitize_payload_for_prompt(payload)
  user_message = (
    f"{instruction}\nINPUT_JSON:{json.dumps(prompt_payload, ensure_ascii=True, separators=(',', ':'))}\nOUTPUT_JSON:\n{{"
  )
  return str(
    tokenizer.apply_chat_template(
      [
        {"role": "user", "content": user_message}
      ],
      tokenize=False,
      add_generation_prompt=False
    )
  )


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
