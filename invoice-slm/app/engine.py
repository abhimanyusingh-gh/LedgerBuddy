from __future__ import annotations

from typing import Any, Literal

from .payload_normalization import (
  apply_mode,
  extract_selected_payload,
  normalize_reason_codes,
  normalize_issues
)
from .selection_heuristics import heuristic_select, repair_vendor_name

VALID_INVOICE_TYPES = {
  "standard", "gst-tax-invoice", "vat-invoice", "receipt", "utility-bill",
  "professional-service", "purchase-order", "credit-note", "proforma", "other"
}


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
    selected_raw = slm_payload.get("selected")
    if not isinstance(selected_raw, dict):
      # Some providers return the verifier contract directly at the top level.
      selected_raw = {
        key: value
        for key, value in slm_payload.items()
        if key not in {"reasonCodes", "issues", "_usage"}
      }

    if isinstance(selected_raw, dict):
      if "gst" not in selected_raw:
        top_gst = slm_payload.get("gst")
        if isinstance(top_gst, dict):
          selected_raw["gst"] = top_gst
      if "invoiceType" not in selected_raw and slm_payload.get("invoiceType"):
        selected_raw["invoiceType"] = slm_payload["invoiceType"]
      if "_fieldConfidence" not in selected_raw and isinstance(slm_payload.get("_fieldConfidence"), dict):
        selected_raw["_fieldConfidence"] = slm_payload["_fieldConfidence"]
      if "_fieldProvenance" not in selected_raw and isinstance(slm_payload.get("_fieldProvenance"), dict):
        selected_raw["_fieldProvenance"] = slm_payload["_fieldProvenance"]
      if "_lineItemProvenance" not in selected_raw and isinstance(slm_payload.get("_lineItemProvenance"), list):
        selected_raw["_lineItemProvenance"] = slm_payload["_lineItemProvenance"]
      if "_classification" not in selected_raw and isinstance(slm_payload.get("_classification"), dict):
        selected_raw["_classification"] = slm_payload["_classification"]
    selected = extract_selected_payload(selected_raw)
    reason_codes = normalize_reason_codes(slm_payload.get("reasonCodes"))
    issues.extend(normalize_issues(slm_payload.get("issues")))

    block_indices = selected.pop("_blockIndices", None)
    field_confidence = selected.pop("_fieldConfidence", None)
    field_provenance = selected.pop("_fieldProvenance", None)
    line_item_provenance = selected.pop("_lineItemProvenance", None)
    classification = selected.pop("_classification", None)
    if selected:
      for field in selected:
        reason_codes.setdefault(field, "slm_selected")
      merged = apply_mode(mode, current, selected)
      if repair_vendor_name(merged, candidate_map, field_regions.get("vendorName") or blocks):
        reason_codes.setdefault("vendorName", "heuristic_vendor_repair")
      if isinstance(block_indices, dict) and block_indices:
        merged["_blockIndices"] = block_indices
      if isinstance(field_confidence, dict) and field_confidence:
        merged["_fieldConfidence"] = field_confidence
      if isinstance(field_provenance, dict) and field_provenance:
        merged["_fieldProvenance"] = field_provenance
      if isinstance(line_item_provenance, list) and line_item_provenance:
        merged["_lineItemProvenance"] = line_item_provenance
      if isinstance(classification, dict) and classification:
        merged["_classification"] = classification
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
