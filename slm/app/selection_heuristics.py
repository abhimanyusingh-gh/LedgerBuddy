from __future__ import annotations

import re
from typing import Any, Literal

from .payload_normalization import parse_minor_units, looks_like_address

INVOICE_NUMBER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9_\-/]{2,}$", re.IGNORECASE)
VENDOR_BANNED_PATTERN = re.compile(
  r"\b(address|warehouse|village|road|street|taluk|district|invoice|bill|gst|vat|tax|phone|email|customer)\b",
  re.IGNORECASE
)
VALID_CURRENCIES = {"USD", "EUR", "GBP", "INR", "AUD", "CAD", "JPY", "AED", "SGD", "CHF", "CNY"}


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
  return valid[0] if valid else "INR"


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
