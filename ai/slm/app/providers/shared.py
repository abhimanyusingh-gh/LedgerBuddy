from __future__ import annotations

import ast
import json
import re
from typing import Any

from ..settings import settings


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

  ocr_text = payload.get("ocrText") if isinstance(payload.get("ocrText"), str) else ""

  compact: dict[str, Any] = {
    "parsed": payload.get("parsed") if isinstance(payload.get("parsed"), dict) else {},
    "ocrText": ocr_text,
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
    "priorCorrections": pick("priorCorrections", expected_type=list, default=[]),
    "glCategories": pick("glCategories", expected_type=list, default=[]),
    "ocrLayout": ocr_text,
    "normalizedAmounts": pick("normalizedAmounts", expected_type=list, default=[]),
    "normalizedDates": pick("normalizedDates", expected_type=list, default=[]),
    "normalizedCurrencies": pick("normalizedCurrencies", expected_type=list, default=[])
  }
  return compact


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


_DEFAULT_GL_CATEGORIES = [
  "Office Expenses", "Professional Services", "Rent", "Utilities", "Travel",
  "Contractor Services", "Raw Materials", "Commission", "Insurance",
  "Repairs & Maintenance", "Software Subscription", "Other"
]


def _get_hint(payload: dict[str, Any], name: str, default: Any = None) -> Any:
  hints = payload.get("hints") if isinstance(payload.get("hints"), dict) else {}
  value = payload.get(name, hints.get(name, default))
  return value


def _build_prior_corrections_text(payload: dict[str, Any]) -> str:
  prior_corrections = _get_hint(payload, "priorCorrections")
  if not isinstance(prior_corrections, list) or not prior_corrections:
    return ""
  parts = []
  for entry in prior_corrections[:6]:
    if isinstance(entry, dict) and isinstance(entry.get("field"), str) and isinstance(entry.get("hint"), str):
      parts.append(f"{entry['field']}: {entry['hint']}")
  if not parts:
    return ""
  return "PRIOR_CORRECTIONS:\n- " + "\n- ".join(parts) + "\n"


def _build_gl_categories_str(payload: dict[str, Any]) -> str:
  raw = _get_hint(payload, "glCategories", [])
  categories = [c for c in raw if isinstance(c, str) and c.strip()] if isinstance(raw, list) else []
  return ", ".join(categories or _DEFAULT_GL_CATEGORIES)


def build_extractor_prompt(payload: dict[str, Any], strict: bool) -> str:
  prior_corrections_text = _build_prior_corrections_text(payload)
  gl_categories = _build_gl_categories_str(payload)

  instruction = (
    "Extract structured invoice data from INPUT_JSON. Output JSON only. No reasoning, no markdown.\n"
    "Include a field ONLY if clearly present in OCR with correct label. Omit uncertain fields.\n"
    f"glCategory ∈ {{{gl_categories}}} | invoiceType ∈ {{purchase,service,expense,rent}}\n"
    "\n"
    "SCHEMA: {\"file\":\"\",\"lineItemCount\":0,"
    "\"invoiceNumber\":{\"value\":\"\",\"provenance\":{}},"
    "\"vendorNameContains\":{\"value\":\"\",\"provenance\":{}},"
    "\"invoiceDate\":{\"value\":\"YYYY-MM-DD\",\"provenance\":{}},"
    "\"dueDate\":{\"value\":\"YYYY-MM-DD\",\"provenance\":{}},"
    "\"currency\":{\"value\":\"\",\"provenance\":{}},"
    "\"totalAmountMinor\":{\"value\":0,\"provenance\":{}},"
    "\"lineItems\":[{\"description\":\"\",\"amountMinor\":0,\"provenance\":{}}],"
    "\"gst\":{\"cgstMinor\":{\"value\":0,\"provenance\":{}},"
    "\"sgstMinor\":{\"value\":0,\"provenance\":{}},"
    "\"subtotalMinor\":{\"value\":0,\"provenance\":{}},"
    "\"totalTaxMinor\":{\"value\":0,\"provenance\":{}}},"
    "\"classification\":{\"glCategory\":\"\",\"invoiceType\":\"\"}}\n"
    "\n"
    "LAYOUT: ocrText is layout-aware — each line = one visual row; ' | ' = column separator on same row.\n"
    "Example: 'Invoice No. | RS-25-26-1148 | Dated | 26-Feb-26' → invoiceNumber=RS-25-26-1148, invoiceDate=26-Feb-26\n"
    "\n"
    "PROVENANCE: use value blocks only (not label blocks).\n"
    "Single: {\"page\":int,\"blockIndex\":int,\"bboxNormalized\":[...]}\n"
    "\n"
    "FIELD RULES:\n"
    "invoiceNumber: DATES ARE NEVER INVOICE NUMBERS. Reject DD-Mon-YY (e.g. 26-Feb-26), DD/MM/YYYY, YYYY-MM-DD even near 'Invoice No.'. Reject IRN/Ack No/PO/Ref. Invoice numbers contain letters+digits: RS-25-26-1148, INV-001.\n"
    "vendorName: seller at top/header only — never Bill To / Ship To / buyer sections.\n"
    "invoiceDate: labeled Invoice Date / Bill Date / Date only. Reject Ack Date / IRN Date.\n"
    "dueDate: explicitly labeled only.\n"
    "totalAmountMinor: prefer Total/Grand Total/Amount Payable > Balance Due. Reject subtotal, individual tax lines. MUST be > cgst+sgst (or igst) — if ≤ any single tax it is a tax line, not the total. Verify against Amount in Words.\n"
    "GST: include only if explicit. IGST=NA/0/blank → omit igstMinor.\n"
    "lineItems: one row per item, final amount column only. Each needs amountMinor + provenance.\n"
    "currency: set INR if ₹/INR/GSTIN/CGST/SGST present; set USD/EUR/GBP from explicit symbol or code. Never infer INR from $ alone — $ is USD unless India tax context is present.\n"
    "INR amounts: multiply × 100 for paise. Lakh format 12,63,318 = 1263318 rupees = 126331800 paise.\n"
    "\n"
    + (prior_corrections_text if prior_corrections_text else "")
  )

  prompt_payload = sanitize_payload_for_prompt(payload)
  return (
    f"{instruction}\nINPUT_JSON:{json.dumps(prompt_payload, ensure_ascii=True, separators=(',', ':'))}\nOUTPUT_JSON:"
  )


def build_comparator_prompt(
  payload: dict[str, Any],
  extraction_a: dict[str, Any],
  extraction_b: dict[str, Any],
  strict: bool
) -> str:
  instruction = (
    "Merge two invoice extractions using strict agreement. Keep a field ONLY if both agree. Output JSON only.\n"
    "No guessing. No nulls. No empty arrays. Prefer omission over conflict.\n"
    "invoiceNumber: match or strong substring. vendorName: same seller. Dates/currency: exact match. totalAmountMinor: exact match.\n"
    "lineItems: match by description+amount — omit entire section if uncertain. GST: both must agree fully — else omit block.\n"
    "lineItemCount must match items. Use provenance from either matching field.\n"
  )

  prompt_payload = sanitize_payload_for_prompt(payload)
  return (
    f"{instruction}"
    f"\nINPUT_JSON:{json.dumps(prompt_payload, ensure_ascii=True, separators=(',', ':'))}"
    f"\nEXTRACTION_A:{json.dumps(extraction_a, ensure_ascii=True, separators=(',', ':'))}"
    f"\nEXTRACTION_B:{json.dumps(extraction_b, ensure_ascii=True, separators=(',', ':'))}"
    f"\nOUTPUT_JSON:"
  )


def build_verifier_prompt(
  payload: dict[str, Any],
  merged: dict[str, Any],
  strict: bool
) -> str:
  instruction = (
    "Validate and clean this invoice extraction against OCR evidence. Output final JSON only. Remove any invalid field.\n"
    "For each field: confirm OCR presence, correct label, no conflicts, valid provenance (value block only). Fail any check → remove field.\n"
    "\n"
    "LAYOUT: ocrText is layout-aware — each line = one visual row; ' | ' = column separator.\n"
    "\n"
    "VALIDATION RULES:\n"
    "invoiceNumber: DATES ARE NEVER INVOICE NUMBERS. Reject if matches DD-Mon-YY/DD/MM/YYYY/YYYY-MM-DD, or is IRN/Ack/PO/Ref.\n"
    "vendorName: reject if from Bill To / Ship To / buyer section.\n"
    "invoiceDate/dueDate: reject if not explicitly labeled.\n"
    "totalAmountMinor: must be clearly labeled total, > cgst+sgst. Reject if paid/subtotal/tax line.\n"
    "GST: must be explicit and consistent — else remove entire gst block.\n"
    "lineItems: clear table rows only, each needs description+amountMinor+provenance — else remove entire section.\n"
    "lineItemCount must match items. No nulls, no empty arrays.\n"
  )

  prompt_payload = sanitize_payload_for_prompt(payload)
  return (
    f"{instruction}"
    f"\nINPUT_JSON:{json.dumps(prompt_payload, ensure_ascii=True, separators=(',', ':'))}"
    f"\nMERGED_JSON:{json.dumps(merged, ensure_ascii=True, separators=(',', ':'))}"
    f"\nOUTPUT_JSON:"
  )


def build_extraction_prompt(payload: dict[str, Any], strict: bool) -> str:
  return build_extractor_prompt(payload, strict)
