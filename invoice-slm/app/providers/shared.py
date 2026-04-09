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
    "priorCorrections": pick("priorCorrections", expected_type=list, default=[]),
    "glCategories": pick("glCategories", expected_type=list, default=[]),
    "mergedBlocks": pick("mergedBlocks", expected_type=list, default=[]),
    "structuredLines": pick("structuredLines", expected_type=list, default=[]),
    "structuredTables": pick("structuredTables", expected_type=list, default=[]),
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
    "You are a deterministic OCR post-processing system for invoice extraction.\n"
    "\n"
    "## BEHAVIOR\n"
    "- Think step-by-step internally (DO NOT output reasoning)\n"
    "- Extract strictly from OCR evidence\n"
    "- Output JSON only\n"
    "\n"
    "## SAMPLING MODE\n"
    "This is one of multiple independent runs.\n"
    "- Do NOT try to match other outputs\n"
    "- Make independent decisions\n"
    "- If uncertain → omit OR include ONLY if strong evidence exists\n"
    "\n"
    "## TASK\n"
    "Extract structured invoice data strictly from OCR evidence.\n"
    "\n"
    "## OUTPUT SCHEMA\n"
    "{\n"
    '  "file": "<filename>",\n'
    '  "lineItemCount": <int>,\n'
    '  "invoiceNumber": { "value": "<string>", "provenance": {...} },\n'
    '  "vendorNameContains": { "value": "<string>", "provenance": {...} },\n'
    '  "invoiceDate": { "value": "YYYY-MM-DD", "provenance": {...} },\n'
    '  "dueDate": { "value": "YYYY-MM-DD", "provenance": {...} },\n'
    '  "currency": { "value": "<ISO>", "provenance": {...} },\n'
    '  "totalAmountMinor": { "value": <int>, "provenance": {...} },\n'
    '  "lineItems": [{ "description": "<string>", "amountMinor": <int>, "provenance": {...} }],\n'
    '  "gst": {\n'
    '    "cgstMinor": { "value": <int>, "provenance": {...} },\n'
    '    "sgstMinor": { "value": <int>, "provenance": {...} },\n'
    '    "subtotalMinor": { "value": <int>, "provenance": {...} },\n'
    '    "totalTaxMinor": { "value": <int>, "provenance": {...} }\n'
    "  },\n"
    '  "classification": { "glCategory": "<string>", "invoiceType": "<string>" }\n'
    "}\n"
    "\n"
    "## HARD RULES\n"
    "- JSON only. No nulls. Omit uncertain fields. Every value must have provenance.\n"
    "- Never guess or infer. No empty arrays or objects.\n"
    f"- glCategory ∈ {{{gl_categories}}}\n"
    "- invoiceType ∈ {purchase, service, expense, rent}\n"
    "\n"
    "## DECISION RULE\n"
    "Include a field ONLY if: clearly present in OCR, correctly labeled OR structurally obvious, no conflicting values. Else omit.\n"
    "\n"
    "## NORMALIZATION\n"
    "- Dates → YYYY-MM-DD. Amounts → integer minor units. Currency → ISO (₹→INR, $→USD). Default currency → INR if missing.\n"
    "- INR amounts: OCR may render ₹ as $. If currency is INR and an amount has a $ prefix, treat it as ₹.\n"
    "- INR paise: ALL rupee amounts (including Indian lakh-format like 12,63,318 or 9,55,900) must be multiplied by 100. Never output a rupee value as the minor-unit integer directly.\n"
    "\n"
    "## PROVENANCE\n"
    "Use ONLY value blocks (not labels).\n"
    '- Single: { "page": int, "blockIndex": int, "bboxNormalized": [...] }\n'
    '- Multi (only if required): { "blockIndices": [...], "bboxNormalized": merged }\n'
    "\n"
    "## FIELD RULES\n"
    "### invoiceNumber\n"
    "- Must be issuer-assigned invoice/bill number\n"
    "- Reject: IRN (64 hex), Ack No (≥15 digits), PO / Ref / Order numbers\n"
    "- Reject: any date-format string (DD-Mon-YY, DD/MM/YYYY, YYYY-MM-DD, etc.) — invoice numbers are alphanumeric with hyphens/slashes, never pure dates\n"
    "- Reject: values from Ack Date, Printed Date, Dated, or similar timestamp fields\n"
    "- For proforma: extract proforma invoice number\n"
    "\n"
    "### vendorNameContains\n"
    "- Must be seller (top/header)\n"
    "- Never extract from buyer sections (Bill To / Ship To / Billed To / To:)\n"
    "\n"
    "### invoiceDate\n"
    "- Accept: Invoice Date / Bill Date / Date\n"
    "- Reject: Ack Date / IRN Date\n"
    "\n"
    "### dueDate — must be explicitly labeled (no derivation)\n"
    "\n"
    "### totalAmountMinor (priority order)\n"
    "1. Total / Grand Total / Amount Payable\n"
    "2. Final payable / Balance Due\n"
    "3. Verify against 'Total in Words' or 'Amount in Words' text — convert words to number to confirm\n"
    "4. Compute ONLY if subtotal + all taxes exist AND no conflict\n"
    "Reject: Paid amount, individual CGST/SGST/IGST amounts, subtotal\n"
    "SANITY CHECK: totalAmountMinor must be GREATER than cgstMinor + sgstMinor (or igstMinor). If the candidate is less than or equal to any single tax component, reject it — it is a tax line, not the total.\n"
    "\n"
    "## GST RULES\n"
    "Include ONLY if explicit. cgstMinor and sgstMinor must be explicit. subtotalMinor must be pre-tax. totalTaxMinor: explicit OR cgst+sgst (ONLY if both exist).\n"
    "If IGST is shown as 'NA', blank, or '0', do NOT extract igstMinor.\n"
    "\n"
    "## LINE ITEMS\n"
    "Include ONLY if confident. One row = one item. Use final amount column only (Amount/Line Total/Net). Each item must have amountMinor + provenance. lineItemCount = number of items. If none → lineItemCount = 0.\n"
    "\n"
    "## OCR POLICY\n"
    "Minor formatting noise allowed. No digit guessing. No conflict resolution.\n"
    "\n"
    "## EXTRACTION ORDER\n"
    "1. Header  2. Totals  3. GST  4. Line items\n"
    "\n"
    "## FINAL CHECK\n"
    "Ensure valid JSON. Ensure schema compliance. If unsure → omit.\n"
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
    "You are a strict consensus engine for invoice extraction.\n"
    "\n"
    "## INPUT\n"
    "- OCR data (rawText, blocks)\n"
    "- Extraction A (JSON)\n"
    "- Extraction B (JSON)\n"
    "\n"
    "## TASK\n"
    "Produce a merged JSON using strict agreement rules.\n"
    "\n"
    "## CORE RULE\n"
    "Keep a field ONLY if both extractions agree. If disagreement → omit field.\n"
    "\n"
    "## RULES\n"
    "- No guessing. No inference. Prefer omission over incorrect data. JSON only. No nulls. No empty objects/arrays.\n"
    "\n"
    "## FIELD RULES\n"
    "### invoiceNumber — must match OR strong substring match. Else omit.\n"
    "### vendorNameContains — must refer to same seller. Else omit.\n"
    "### Dates — must match exactly. Else omit.\n"
    "### currency — must match. Else omit.\n"
    "### totalAmountMinor (STRICT) — must match exactly. Else omit.\n"
    "\n"
    "## LINE ITEMS\n"
    "Match rows by description similarity. Keep item ONLY if present in both outputs AND amount matches. If uncertain → omit entire lineItems.\n"
    "\n"
    "## GST\n"
    "Keep ONLY if both outputs agree fully. Else omit entire gst block.\n"
    "\n"
    "## PROVENANCE\n"
    "Use provenance from either matching field. Merge bbox if needed.\n"
    "\n"
    "## OUTPUT RULES\n"
    "lineItemCount must match items. Omit missing sections entirely.\n"
    "\n"
    "## OUTPUT\n"
    "Return merged JSON only.\n"
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
    "You are a strict invoice extraction verifier.\n"
    "\n"
    "## BEHAVIOR\n"
    "- Think internally (hidden). Do NOT trust input blindly. Remove any invalid or weak data. Output FINAL JSON only.\n"
    "\n"
    "## INPUT\n"
    "- OCR data (rawText, blocks)\n"
    "- Merged JSON\n"
    "\n"
    "## TASK\n"
    "Validate and CLEAN the JSON.\n"
    "\n"
    "## HARD RULES\n"
    "No guessing. No inference. No nulls. Omit invalid fields. Prefer omission over incorrect data. No empty objects/arrays.\n"
    "\n"
    "## VALIDATION PROCESS\n"
    "For EACH field: 1. Confirm presence in OCR. 2. Confirm correct label or structure. 3. Check for conflicts. 4. Validate normalization. 5. Validate provenance (value block only). If ANY fails → REMOVE field.\n"
    "\n"
    "## FIELD VALIDATION\n"
    "### invoiceNumber — Reject if: IRN / Ack / PO / Ref, weak labeling, multiple conflicts\n"
    "### vendorNameContains — Reject if from buyer section\n"
    "### invoiceDate / dueDate — Reject if not explicitly labeled\n"
    "### totalAmountMinor — Accept ONLY if clearly labeled total OR fully consistent. Reject: paid / balance / conflicts.\n"
    "### GST — Must be explicit and consistent. Else remove entire block.\n"
    "### LINE ITEMS — Must be clear table structure. Each item must have: description, amountMinor, valid provenance. Else remove entire section.\n"
    "### PROVENANCE — Must reference value blocks. bbox must align with value.\n"
    "\n"
    "## FINAL RULES\n"
    "lineItemCount must match items. Ensure valid JSON. Ensure schema compliance.\n"
    "\n"
    "## OUTPUT\n"
    "Return final JSON only.\n"
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
