from __future__ import annotations

import re
from typing import Any, Literal

from .settings import settings

INVOICE_NUMBER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9_\-/]{2,}$", re.IGNORECASE)
VENDOR_BANNED_PATTERN = re.compile(
  r"\b(address|warehouse|village|road|street|taluk|district|invoice|bill|gst|vat|tax|phone|email|customer)\b",
  re.IGNORECASE
)
VALID_CURRENCIES = {"USD", "EUR", "GBP", "INR", "AUD", "CAD", "JPY", "AED", "SGD", "CHF", "CNY"}
VALID_INVOICE_TYPES = {
  "standard", "gst-tax-invoice", "vat-invoice", "receipt", "utility-bill",
  "professional-service", "purchase-order", "credit-note", "proforma", "other"
}


def normalize_candidate_map(raw_value: Any) -> dict[str, list[str]]:
  if not isinstance(raw_value, dict):
    return {}

  output: dict[str, list[str]] = {}
  for key, value in raw_value.items():
    if not isinstance(key, str) or not isinstance(value, list):
      continue

    values = [str(entry).strip() for entry in value if str(entry).strip()]
    if key == "totalAmountMinor":
      normalized_amounts: list[str] = []
      for entry in values:
        if re.fullmatch(r"\d+", entry):
          normalized_amounts.append(entry)
          continue
        parsed = parse_minor_units(entry)
        if parsed is not None:
          normalized_amounts.append(str(parsed))
      values = normalized_amounts

    deduped = list(dict.fromkeys(values))
    if deduped:
      output[key] = deduped

  return output


def normalize_blocks(raw_blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
  normalized: list[dict[str, Any]] = []
  for block in raw_blocks[: settings.max_blocks]:
    if not isinstance(block, dict):
      continue
    text = str(block.get("text", "")).strip()
    if not text:
      continue

    page = normalize_page(block.get("page"))
    bbox_norm = normalize_bbox(block.get("bboxNormalized"))
    if bbox_norm is None:
      bbox_model = normalize_bbox(block.get("bboxModel"))
      if bbox_model is not None:
        bbox_norm = [round(entry / 999.0, 6) for entry in bbox_model]

    if bbox_norm is None:
      bbox_norm = normalize_bbox(block.get("bbox")) or [0.0, 0.0, 0.0, 0.0]

    normalized.append(
      {
        "text": text[:220],
        "page": page,
        "bboxNormalized": bbox_norm,
        "blockType": str(block.get("blockType", "text")).strip().lower() or "text"
      }
    )

  return normalized


def normalize_field_regions(value: Any) -> dict[str, list[dict[str, Any]]]:
  if not isinstance(value, dict):
    return {}

  output: dict[str, list[dict[str, Any]]] = {}
  for key, entries in value.items():
    if not isinstance(key, str) or not isinstance(entries, list):
      continue

    normalized_entries: list[dict[str, Any]] = []
    for entry in entries:
      if not isinstance(entry, dict):
        continue
      text = str(entry.get("text", "")).strip()
      if not text:
        continue

      bbox_norm = normalize_bbox(entry.get("bboxNormalized"))
      if bbox_norm is None:
        bbox_model = normalize_bbox(entry.get("bboxModel"))
        if bbox_model is not None:
          bbox_norm = [round(v / 999.0, 6) for v in bbox_model]
      if bbox_norm is None:
        bbox_norm = [0.0, 0.0, 0.0, 0.0]

      normalized_entries.append(
        {
          "text": text[:220],
          "page": normalize_page(entry.get("page")),
          "bboxNormalized": bbox_norm
        }
      )

    if normalized_entries:
      output[key] = normalized_entries
  return output


def normalize_page(value: Any) -> int:
  try:
    parsed = int(value)
  except Exception:
    return 1
  return parsed if parsed > 0 else 1


def normalize_bbox(value: Any) -> list[float] | None:
  if not isinstance(value, list) or len(value) != 4:
    return None
  try:
    return [float(entry) for entry in value]
  except Exception:
    return None


def select_with_fallback(
  mode: Literal["strict", "relaxed"],
  current: dict[str, Any],
  candidate_map: dict[str, list[str]],
  blocks: list[dict[str, Any]],
  field_regions: dict[str, list[dict[str, Any]]],
  slm_payload: dict[str, Any] | None,
  slm_error: str | None
) -> tuple[dict[str, Any], dict[str, str], list[str]]:
  issues: list[str] = []
  reason_codes: dict[str, str] = {}

  if slm_payload is not None:
    selected = normalize_selected_payload(slm_payload.get("selected"))
    reason_codes = normalize_reason_codes(slm_payload.get("reasonCodes"))
    issues.extend(normalize_issues(slm_payload.get("issues")))

    block_indices = selected.pop("_blockIndices", None)
    validated = validate_selected_values(selected, candidate_map)
    if validated:
      for field in validated:
        reason_codes.setdefault(field, "slm_selected")
      merged = apply_mode(mode, current, validated)
      if repair_vendor_name(merged, candidate_map, field_regions.get("vendorName") or blocks):
        reason_codes.setdefault("vendorName", "heuristic_vendor_repair")
      if isinstance(block_indices, dict) and block_indices:
        merged["_blockIndices"] = block_indices
      return merged, reason_codes, issues
    issues.append("SLM returned no valid field selections.")

  if slm_error:
    normalized_error = slm_error.strip().lower()
    if "not valid json" not in normalized_error:
      issues.append(f"SLM unavailable: {slm_error}")

  fallback_selected, fallback_codes = heuristic_select(candidate_map, blocks, field_regions, current, mode)
  issues.append("Applied heuristic fallback for unresolved fields.")
  return apply_mode(mode, current, fallback_selected), fallback_codes, issues


def extract_invoice_type(slm_payload: dict[str, Any] | None) -> str:
  if slm_payload is None:
    return "other"
  raw = slm_payload.get("invoiceType")
  if isinstance(raw, str) and raw.strip().lower() in VALID_INVOICE_TYPES:
    return raw.strip().lower()
  return "other"


def normalize_selected_payload(value: Any) -> dict[str, Any]:
  if not isinstance(value, dict):
    return {}
  selected: dict[str, Any] = {}
  block_indices: dict[str, int] = {}
  for field in ("invoiceNumber", "vendorName", "currency", "totalAmountMinor", "invoiceDate", "dueDate"):
    if field not in value:
      continue
    raw = value[field]
    candidate = raw
    if isinstance(raw, dict):
      candidate = raw.get("value", raw.get("v"))
      bi = raw.get("blockIndex", raw.get("block_index"))
      if isinstance(bi, int) and bi >= 0:
        block_indices[field] = bi

    if field == "totalAmountMinor":
      if isinstance(candidate, int) and candidate > 0:
        selected[field] = candidate
      elif isinstance(candidate, str):
        stripped = candidate.strip()
        parsed = int(stripped) if re.fullmatch(r"\d+", stripped) else parse_minor_units(stripped)
        if parsed is not None and parsed > 0:
          selected[field] = parsed
      continue

    if isinstance(candidate, str) and candidate.strip():
      selected[field] = candidate.strip()
  gst_raw = value.get("gst")
  if isinstance(gst_raw, dict):
    gst: dict[str, Any] = {}
    gstin = gst_raw.get("gstin")
    if isinstance(gstin, str) and gstin.strip():
      gst["gstin"] = gstin.strip()
    for tax_field in ("subtotalMinor", "cgstMinor", "sgstMinor", "igstMinor", "cessMinor", "totalTaxMinor"):
      raw_val = gst_raw.get(tax_field)
      if isinstance(raw_val, int) and raw_val > 0:
        gst[tax_field] = raw_val
      elif isinstance(raw_val, str) and raw_val.strip():
        parsed_tax = parse_minor_units(raw_val.strip())
        if parsed_tax is not None and parsed_tax > 0:
          gst[tax_field] = parsed_tax
    if gst:
      selected["gst"] = gst
  if block_indices:
    selected["_blockIndices"] = block_indices
  return selected


def normalize_reason_codes(value: Any) -> dict[str, str]:
  if not isinstance(value, dict):
    return {}
  output: dict[str, str] = {}
  for key, entry in value.items():
    if isinstance(key, str) and isinstance(entry, str) and entry.strip():
      output[key] = entry.strip()
  return output


def normalize_issues(value: Any) -> list[str]:
  if not isinstance(value, list):
    return []
  return [str(entry).strip() for entry in value if str(entry).strip()]


def validate_selected_values(selected: dict[str, Any], candidate_map: dict[str, list[str]]) -> dict[str, Any]:
  output: dict[str, Any] = {}

  invoice_number = selected.get("invoiceNumber")
  if isinstance(invoice_number, str) and INVOICE_NUMBER_PATTERN.match(invoice_number):
    if allow_value("invoiceNumber", invoice_number, candidate_map):
      output["invoiceNumber"] = invoice_number

  vendor_name = selected.get("vendorName")
  if isinstance(vendor_name, str) and is_vendor_candidate(vendor_name):
    if allow_value("vendorName", vendor_name, candidate_map):
      output["vendorName"] = vendor_name

  currency = selected.get("currency")
  if isinstance(currency, str):
    upper = currency.upper()
    if upper in VALID_CURRENCIES and allow_value("currency", upper, candidate_map):
      output["currency"] = upper

  total_minor = selected.get("totalAmountMinor")
  if isinstance(total_minor, int) and total_minor > 0:
    if allow_value("totalAmountMinor", str(total_minor), candidate_map):
      output["totalAmountMinor"] = total_minor

  invoice_date = selected.get("invoiceDate")
  if isinstance(invoice_date, str) and invoice_date.strip():
    output["invoiceDate"] = invoice_date.strip()

  due_date = selected.get("dueDate")
  if isinstance(due_date, str) and due_date.strip():
    output["dueDate"] = due_date.strip()

  return output


def allow_value(field: str, value: str, candidate_map: dict[str, list[str]]) -> bool:
  candidates = candidate_map.get(field)
  if not candidates:
    return True
  normalized_value = value.strip().upper() if field == "currency" else value.strip()
  candidate_set = {entry.strip().upper() if field == "currency" else entry.strip() for entry in candidates}
  return normalized_value in candidate_set


def apply_mode(mode: Literal["strict", "relaxed"], current: dict[str, Any], selected: dict[str, Any]) -> dict[str, Any]:
  if mode == "relaxed":
    merged = dict(current)
    merged.update(selected)
    return merged

  merged = dict(current)
  for key, value in selected.items():
    if key not in merged or merged.get(key) in (None, ""):
      merged[key] = value
      continue
    if key == "vendorName" and isinstance(merged[key], str) and isinstance(value, str):
      if looks_like_address(merged[key]) and not looks_like_address(value):
        merged[key] = value
      continue
    if key == "totalAmountMinor" and isinstance(merged[key], int) and isinstance(value, int):
      if merged[key] <= 0 and value > 0:
        merged[key] = value
  return merged


def heuristic_select(
  candidate_map: dict[str, list[str]],
  blocks: list[dict[str, Any]],
  field_regions: dict[str, list[dict[str, Any]]],
  current: dict[str, Any],
  mode: Literal["strict", "relaxed"]
) -> tuple[dict[str, Any], dict[str, str]]:
  selected: dict[str, Any] = {}
  reason_codes: dict[str, str] = {}

  invoice_value = pick_invoice_number(candidate_map.get("invoiceNumber", []))
  if invoice_value:
    selected["invoiceNumber"] = invoice_value
    reason_codes["invoiceNumber"] = "heuristic_invoice_pattern"

  vendor_value = pick_vendor_name(candidate_map.get("vendorName", []), field_regions.get("vendorName") or blocks)
  if vendor_value:
    selected["vendorName"] = vendor_value
    reason_codes["vendorName"] = "heuristic_vendor_spatial"

  currency_value = pick_currency(candidate_map.get("currency", []))
  if currency_value:
    selected["currency"] = currency_value
    reason_codes["currency"] = "heuristic_currency"

  total_value = pick_total_amount(candidate_map.get("totalAmountMinor", []), blocks, current, mode)
  if total_value is not None:
    selected["totalAmountMinor"] = total_value
    reason_codes["totalAmountMinor"] = "heuristic_total"

  return selected, reason_codes


def repair_vendor_name(parsed: dict[str, Any], candidate_map: dict[str, list[str]], blocks: list[dict[str, Any]]) -> bool:
  current = parsed.get("vendorName")
  if isinstance(current, str) and current.strip() and not looks_like_address(current):
    return False
  replacement = pick_vendor_name(candidate_map.get("vendorName", []), blocks)
  if not replacement or current == replacement:
    return False
  parsed["vendorName"] = replacement
  return True


def pick_invoice_number(candidates: list[str]) -> str | None:
  filtered = [entry for entry in candidates if INVOICE_NUMBER_PATTERN.match(entry)]
  if not filtered:
    return None
  return sorted(filtered, key=len, reverse=True)[0]


def pick_vendor_name(candidates: list[str], blocks: list[dict[str, Any]]) -> str | None:
  filtered = [entry for entry in candidates if is_vendor_candidate(entry)]
  if not filtered:
    return None
  block_priority = {str(block.get("text", "")).strip().lower(): score_vendor_block(block) for block in blocks}
  scored: list[tuple[float, str]] = []
  for entry in filtered:
    score = block_priority.get(entry.lower(), 0.0)
    score += len(entry.split()) * 0.1
    if not looks_like_address(entry):
      score += 0.2
    scored.append((score, entry))
  scored.sort(key=lambda item: item[0], reverse=True)
  return scored[0][1]


def score_vendor_block(block: dict[str, Any]) -> float:
  bbox = block.get("bboxNormalized")
  if not isinstance(bbox, list) or len(bbox) != 4:
    return 0.0
  try:
    _, top, _, _ = [float(entry) for entry in bbox]
  except Exception:
    return 0.0
  return max(0.0, 1.0 - top)


def pick_currency(candidates: list[str]) -> str | None:
  valid = [entry.strip().upper() for entry in candidates if entry.strip().upper() in VALID_CURRENCIES]
  return valid[0] if valid else None


def pick_total_amount(
  candidates: list[str],
  blocks: list[dict[str, Any]],
  current: dict[str, Any],
  mode: Literal["strict", "relaxed"]
) -> int | None:
  parsed_values = [int(entry.strip()) if re.fullmatch(r"\d+", entry.strip()) else parse_minor_units(entry) for entry in candidates]
  values = [entry for entry in parsed_values if entry is not None and entry > 0]
  if not values:
    return None

  weighted: list[tuple[float, int]] = []
  for value in values:
    score = float(value)
    if has_value_near_bottom_right(str(value), blocks):
      score *= 1.05
    weighted.append((score, value))
  weighted.sort(reverse=True)
  candidate = weighted[0][1]

  if mode == "strict":
    current_value = current.get("totalAmountMinor")
    if isinstance(current_value, int) and current_value > 0:
      if abs(candidate - current_value) > max(100, int(current_value * 0.05)):
        return current_value
  return candidate


def has_value_near_bottom_right(value: str, blocks: list[dict[str, Any]]) -> bool:
  needle = value.strip()
  if not needle:
    return False
  for block in blocks:
    text = str(block.get("text", ""))
    if needle not in text:
      continue
    bbox = block.get("bboxNormalized")
    if not isinstance(bbox, list) or len(bbox) != 4:
      continue
    try:
      _, top, right, _ = [float(entry) for entry in bbox]
    except Exception:
      continue
    if top >= 0.55 and right >= 0.55:
      return True
  return False


def is_vendor_candidate(line: str) -> bool:
  if len(line) < 3:
    return False
  if VENDOR_BANNED_PATTERN.search(line):
    return False
  return sum(1 for char in line if char.isalpha()) >= 3


def looks_like_address(line: str) -> bool:
  return bool(VENDOR_BANNED_PATTERN.search(line))


def parse_minor_units(raw_value: str) -> int | None:
  stripped = raw_value.strip()
  if re.fullmatch(r"\d+", stripped):
    return int(stripped)

  cleaned = re.sub(r"[^0-9,.\-+]", "", stripped)
  if not cleaned:
    return None
  negative = cleaned.startswith("-")
  normalized = cleaned.lstrip("+-")
  if "," in normalized and "." in normalized:
    normalized = normalized.replace(".", "").replace(",", ".") if normalized.rfind(",") > normalized.rfind(".") else normalized.replace(",", "")
  elif "," in normalized:
    normalized = normalized.replace(",", ".") if normalized.count(",") == 1 and len(normalized.split(",")[-1]) <= 2 else normalized.replace(",", "")

  try:
    value = float(normalized)
  except ValueError:
    return None
  if not (value > 0):
    return None
  minor = int(round(value * 100))
  return -minor if negative else minor
