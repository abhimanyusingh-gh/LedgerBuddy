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

    # MLX/Metal is unstable under overlapping generations on this model;
    # serialize inference to avoid command-buffer assertion failures.
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
    "- Dates: YYYY-MM-DD\n"
    "- Currency: ISO code from explicit symbols/codes in value blocks\n"
    "- Do not switch USD invoices to INR only because GST identifiers appear in addresses or tax ids\n"
    "- Amounts like 300/- or 300/= mean 30000 minor units\n"
    "- All *Minor fields must be integers\n"
    "- blockIndex must point to INPUT_JSON.ocrBlocks[index] that contains the value\n"
    "- vendorName must be the seller/company, not bill-to, bank, beneficiary, or email\n"
    "- Prefer amount due / grand total / balance due rows for totalAmountMinor\n"
    "- Prefer tax summary rows for gst totals, not per-line tax sums\n"
    "Extract:\n"
    "- invoiceNumber, vendorName, currency, totalAmountMinor, invoiceDate, dueDate\n"
    "- gst.gstin, gst.subtotalMinor, gst.cgstMinor, gst.sgstMinor, gst.igstMinor, gst.cessMinor, gst.totalTaxMinor\n"
    "- lineItems with description, hsnSac, quantity, rate, amountMinor, taxRate, cgstMinor, sgstMinor, igstMinor\n"
    "- _fieldConfidence, _fieldProvenance, _lineItemProvenance, _classification\n"
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


def sanitize_payload_for_prompt(payload: dict[str, Any]) -> dict[str, Any]:
  if not isinstance(payload, dict):
    return {}

  hints = payload.get("hints") if isinstance(payload.get("hints"), dict) else {}

  def pick(name: str, *, expected_type: type[Any] | None = None, default: Any = None) -> Any:
    value = payload.get(name, hints.get(name, default))
    if expected_type is not None and not isinstance(value, expected_type):
      return default
    return value

  compact_blocks: list[dict[str, Any]] = []
  raw_blocks = payload.get("ocrBlocks")
  if isinstance(raw_blocks, list):
    for index, entry in enumerate(raw_blocks[: settings.max_blocks]):
      if not isinstance(entry, dict):
        continue
      compact_blocks.append(
        {
          "index": index,
          "text": entry.get("text"),
          "page": entry.get("page"),
          "bboxNormalized": entry.get("bboxNormalized") or entry.get("bboxModel") or entry.get("bbox")
        }
      )

  compact_page_images: list[dict[str, Any]] = []
  raw_page_images = pick("pageImages", expected_type=list, default=[])
  if isinstance(raw_page_images, list):
    for entry in raw_page_images[:3]:
      if not isinstance(entry, dict):
        continue
      data_url = entry.get("dataUrl")
      if not isinstance(data_url, str) or not data_url.strip():
        continue
      compact_page_images.append(
        {
          "page": entry.get("page"),
          "mimeType": entry.get("mimeType"),
          "width": entry.get("width"),
          "height": entry.get("height"),
          "dpi": entry.get("dpi"),
          "dataUrl": data_url
        }
      )

  compact: dict[str, Any] = {
    "parsed": payload.get("parsed") if isinstance(payload.get("parsed"), dict) else {},
    "ocrText": payload.get("ocrText") if isinstance(payload.get("ocrText"), str) else "",
    "ocrBlocks": compact_blocks,
    "mode": payload.get("mode"),
  }
  if compact_page_images:
    compact["pageImages"] = compact_page_images

  compact["hints"] = {
    "documentLanguage": pick("documentLanguage"),
    "languageHint": pick("languageHint"),
    "vendorTemplateMatched": pick("vendorTemplateMatched"),
    "fieldCandidates": pick("fieldCandidates", expected_type=dict, default={}),
    "priorCorrections": pick("priorCorrections", expected_type=list, default=[])
  }
  return compact


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

  fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", candidate, re.DOTALL)
  if fence_match:
    parsed = try_parse_json(fence_match.group(1).strip())
    if parsed is not None:
      return normalize_keys(parsed)

  parsed = try_parse_json(candidate)
  if parsed is not None:
    return normalize_keys(parsed)

  best: dict[str, Any] | None = None
  for match in re.finditer(r"\{", candidate):
    start = match.start()
    depth = 0
    end = start
    for i in range(start, len(candidate)):
      if candidate[i] == "{":
        depth += 1
      elif candidate[i] == "}":
        depth -= 1
        if depth == 0:
          end = i + 1
          break
    if end > start:
      parsed = try_parse_json(candidate[start:end].strip())
      if parsed is not None:
        result = normalize_keys(parsed)
        if "selected" in result or "invoiceNumber" in result or "vendorName" in result:
          return result
        if best is None:
          best = result

  return best


def normalize_keys(obj: dict[str, Any]) -> dict[str, Any]:
  KEY_MAP = {
    "invoicenumber": "invoiceNumber",
    "vendorname": "vendorName",
    "totalamountminor": "totalAmountMinor",
    "invoicedate": "invoiceDate",
    "duedate": "dueDate",
    "invoicetype": "invoiceType",
    "reasoncodes": "reasonCodes",
  }
  result: dict[str, Any] = {}
  for key, value in obj.items():
    normalized_key = KEY_MAP.get(key.lower(), key)
    if isinstance(value, dict):
      result[normalized_key] = normalize_keys(value)
    else:
      result[normalized_key] = value
  return result


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
  hints = payload.get("hints") if isinstance(payload.get("hints"), dict) else {}
  field_candidates = hints.get("fieldCandidates")
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
  hints = payload.get("hints") if isinstance(payload.get("hints"), dict) else {}
  raw_candidates = hints.get("fieldCandidates")
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
