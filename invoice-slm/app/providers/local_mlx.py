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

SYSTEM_PROMPT = (
  "You are an invoice field verification engine. "
  "Return one JSON object only. "
  "Do not emit <think> tags. "
  "Never return markdown. "
  "Never explain. "
  "Never invent values that are not present in candidates or OCR blocks."
)
GENERATION_RESULT_PATTERN = re.compile(
  r"GenerationResult\(\s*text\s*=\s*(?P<literal>'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\")\s*,",
  re.DOTALL
)
THINK_BLOCK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)


class LocalMlxLLMProvider(LLMProvider):
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
      "provider": "local_mlx"
    }

  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    self._ensure_loaded()
    if self.model is None or self.tokenizer is None:
      raise RuntimeError("SLM model is not initialized.")

    if payload.get("llmAssist"):
      log_info("slm.llm_assist.local_mlx_ignores_images", note="Local MLX provider does not support vision; running text-only re-extraction")

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
      completion_tokens = len(self.tokenizer.encode(output_text))
      usage = {"promptTokens": prompt_tokens, "completionTokens": completion_tokens}
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


def build_prompt(tokenizer: Any, payload: dict[str, Any], strict: bool) -> str:
  prior_corrections = payload.get("priorCorrections")
  prior_corrections_text = ""
  if isinstance(prior_corrections, list) and prior_corrections:
    parts = []
    for entry in prior_corrections[:6]:
      if isinstance(entry, dict) and isinstance(entry.get("field"), str) and isinstance(entry.get("hint"), str):
        parts.append(f"{entry['field']}: {entry['hint']}")
    if parts:
      prior_corrections_text = " PRIOR_CORRECTIONS: " + "; ".join(parts) + "."

  if strict:
    instruction = (
      "Return only one minified JSON object. "
      "No markdown. No code fence. No explanation. No preamble. "
      "Schema: "
      "{\"selected\":{\"invoiceNumber\":\"\",\"vendorName\":\"\",\"currency\":\"\",\"totalAmountMinor\":0,"
      "\"invoiceDate\":\"\",\"dueDate\":\"\"},\"reasonCodes\":{},\"issues\":[],\"invoiceType\":\"\"}. "
      "invoiceType must be one of: standard, gst-tax-invoice, vat-invoice, receipt, utility-bill, "
      "professional-service, purchase-order, credit-note, proforma, other."
      + prior_corrections_text
    )
  else:
    instruction = (
      "Use OCR text blocks and bounding boxes to choose invoice fields. "
      "Output schema must be exactly: "
      "{\"selected\":{\"invoiceNumber\":\"\",\"vendorName\":\"\",\"currency\":\"\",\"totalAmountMinor\":0,"
      "\"invoiceDate\":\"\",\"dueDate\":\"\"},\"reasonCodes\":{},\"issues\":[],\"invoiceType\":\"\"} "
      "invoiceType must be one of: standard, gst-tax-invoice, vat-invoice, receipt, utility-bill, "
      "professional-service, purchase-order, credit-note, proforma, other. "
      "Rules: vendorName cannot be an address; totalAmountMinor must be integer minor units; "
      "if unknown keep empty string or 0."
      + prior_corrections_text
    )

  prompt_payload = sanitize_payload_for_prompt(payload)
  user_message = (
    f"{instruction}\nINPUT_JSON:{json.dumps(prompt_payload, ensure_ascii=True, separators=(',', ':'))}\nOUTPUT_JSON:"
  )
  return str(
    tokenizer.apply_chat_template(
      [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_message}
      ],
      tokenize=False,
      add_generation_prompt=True
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


def sanitize_payload_for_prompt(payload: dict[str, Any]) -> dict[str, Any]:
  if not isinstance(payload, dict):
    return {}

  cloned = dict(payload)

  page_images = cloned.get("pageImages")
  if isinstance(page_images, list):
    summaries: list[dict[str, Any]] = []
    for entry in page_images[:3]:
      if not isinstance(entry, dict):
        continue
      summary = {
        "page": entry.get("page"),
        "mimeType": entry.get("mimeType"),
        "width": entry.get("width"),
        "height": entry.get("height"),
        "dpi": entry.get("dpi")
      }
      data_url = entry.get("dataUrl")
      if isinstance(data_url, str) and data_url.startswith("data:"):
        summary["dataUrlPreview"] = data_url[:140]
        summary["dataUrlLength"] = len(data_url)
      summaries.append(summary)
    cloned["pageImages"] = summaries

  document_context = cloned.get("documentContext")
  if isinstance(document_context, dict):
    sanitized_context: dict[str, Any] = {}
    original_doc = document_context.get("originalDocumentDataUrl")
    if isinstance(original_doc, str) and original_doc.startswith("data:"):
      sanitized_context["originalDocumentMimeType"] = original_doc.split(";", 1)[0].replace("data:", "")
      sanitized_context["originalDocumentPreview"] = original_doc[:180]
      sanitized_context["originalDocumentLength"] = len(original_doc)

    page_images = document_context.get("pageImages")
    if isinstance(page_images, list):
      summaries: list[dict[str, Any]] = []
      for entry in page_images[:3]:
        if not isinstance(entry, dict):
          continue
        summary = {
          "page": entry.get("page"),
          "mimeType": entry.get("mimeType"),
          "width": entry.get("width"),
          "height": entry.get("height"),
          "dpi": entry.get("dpi")
        }
        data_url = entry.get("dataUrl")
        if isinstance(data_url, str) and data_url.startswith("data:"):
          summary["dataUrlPreview"] = data_url[:140]
          summary["dataUrlLength"] = len(data_url)
        summaries.append(summary)
      sanitized_context["pageImages"] = summaries

    cloned["documentContext"] = sanitized_context

  return cloned


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
      parsed = try_parse_json(candidate[start:end].strip())
      if parsed is not None:
        return parsed

  return None


def try_parse_json(text: str) -> dict[str, Any] | None:
  if not text:
    return None

  try:
    parsed = json.loads(text)
  except Exception:
    try:
      literal_parsed = ast.literal_eval(text)
    except Exception:
      return None
    return literal_parsed if isinstance(literal_parsed, dict) else None
  return parsed if isinstance(parsed, dict) else None


def recover_payload_from_text(text: str, payload: dict[str, Any]) -> dict[str, Any] | None:
  normalized = " ".join(text.strip().split())
  if not normalized:
    return None

  selected: dict[str, Any] = {}
  reason_codes: dict[str, str] = {}
  field_candidates = payload.get("fieldCandidates")
  if isinstance(field_candidates, dict):
    for field in ("invoiceNumber", "vendorName", "currency", "totalAmountMinor", "invoiceDate", "dueDate"):
      raw_candidates = field_candidates.get(field)
      if not isinstance(raw_candidates, list):
        continue

      match = select_candidate_in_text(field, [str(entry) for entry in raw_candidates], normalized)
      if match is None:
        continue
      selected[field] = match
      reason_codes[field] = "slm_text_recovered"

  if not selected:
    return None

  return {
    "selected": selected,
    "reasonCodes": reason_codes,
    "issues": []
  }


def recover_payload_from_candidates(payload: dict[str, Any]) -> dict[str, Any] | None:
  raw_candidates = payload.get("fieldCandidates")
  if not isinstance(raw_candidates, dict):
    return None

  selected: dict[str, Any] = {}
  reason_codes: dict[str, str] = {}
  ordered_fields = ("invoiceNumber", "vendorName", "currency", "totalAmountMinor", "invoiceDate", "dueDate")
  for field in ordered_fields:
    value = pick_first_candidate(field, raw_candidates.get(field))
    if value is None:
      continue
    selected[field] = value
    reason_codes[field] = "slm_candidate_fallback"

  if not selected:
    return None

  return {
    "selected": selected,
    "reasonCodes": reason_codes,
    "issues": []
  }


def select_candidate_in_text(field: str, candidates: list[str], normalized_text: str) -> Any:
  cleaned = [entry.strip() for entry in candidates if entry.strip()]
  if not cleaned:
    return None

  if field == "totalAmountMinor":
    for candidate in cleaned:
      if candidate.isdigit() and re.search(rf"(?<!\d){re.escape(candidate)}(?!\d)", normalized_text):
        return int(candidate)
    return None

  if field == "currency":
    upper_text = normalized_text.upper()
    for candidate in cleaned:
      upper_candidate = candidate.upper()
      if re.search(rf"\b{re.escape(upper_candidate)}\b", upper_text):
        return upper_candidate
    return None

  lowered = normalized_text.lower()
  for candidate in cleaned:
    if candidate.lower() in lowered:
      return candidate
  return None


def pick_first_candidate(field: str, value: Any) -> Any:
  if not isinstance(value, list):
    return None

  candidates = [str(entry).strip() for entry in value if str(entry).strip()]
  if not candidates:
    return None

  if field == "totalAmountMinor":
    for candidate in candidates:
      if candidate.isdigit():
        return int(candidate)
    return None

  if field == "currency":
    return candidates[0].upper()

  return candidates[0]
