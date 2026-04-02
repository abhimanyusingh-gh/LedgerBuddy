from __future__ import annotations

import re
from typing import Any

from .settings import settings

PAN_PATTERN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
IFSC_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
UDYAM_PATTERN = re.compile(r"^UDYAM-[A-Z]{2}-\d{2}-\d{7}$")


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


def normalize_text(value: Any) -> str | None:
  if not isinstance(value, str):
    return None
  trimmed = value.strip()
  return trimmed if trimmed else None


def normalize_field_confidence(value: Any) -> dict[str, float]:
  if not isinstance(value, dict):
    return {}
  output: dict[str, float] = {}
  for key, entry in value.items():
    if not isinstance(key, str) or not key.strip():
      continue
    try:
      parsed = float(entry)
    except Exception:
      continue
    normalized = parsed / 100.0 if parsed > 1 else parsed
    normalized = max(0.0, min(1.0, normalized))
    output[key.strip()] = round(normalized, 4)
  return output


def normalize_provenance_entry(value: Any) -> dict[str, Any] | None:
  if not isinstance(value, dict):
    return None
  bbox = normalize_bbox(value.get("bbox"))
  bbox_norm = normalize_bbox(value.get("bboxNormalized"))
  bbox_model = normalize_bbox(value.get("bboxModel"))
  if bbox is None and bbox_norm is None and bbox_model is None:
    return None

  output: dict[str, Any] = {}
  source = normalize_text(value.get("source"))
  if source:
    output["source"] = source

  try:
    page = int(value.get("page"))
    if page > 0:
      output["page"] = page
  except Exception:
    pass

  if bbox is not None:
    output["bbox"] = bbox
  if bbox_norm is not None:
    output["bboxNormalized"] = bbox_norm
  if bbox_model is not None:
    output["bboxModel"] = bbox_model

  block_index = value.get("blockIndex", value.get("block_index"))
  try:
    parsed_block_index = int(block_index)
    if parsed_block_index >= 0:
      output["blockIndex"] = parsed_block_index
  except Exception:
    pass

  try:
    confidence = float(value.get("confidence"))
    confidence = confidence / 100.0 if confidence > 1 else confidence
    output["confidence"] = round(max(0.0, min(1.0, confidence)), 4)
  except Exception:
    pass

  return output if output else None


def normalize_field_provenance(value: Any) -> dict[str, dict[str, Any]]:
  if not isinstance(value, dict):
    return {}
  output: dict[str, dict[str, Any]] = {}
  for key, entry in value.items():
    if not isinstance(key, str) or not key.strip():
      continue
    normalized = normalize_provenance_entry(entry)
    if normalized is not None:
      output[key.strip()] = normalized
  return output


def normalize_line_item_provenance(value: Any) -> list[dict[str, Any]]:
  if not isinstance(value, list):
    return []
  output: list[dict[str, Any]] = []
  for item in value:
    if not isinstance(item, dict):
      continue
    idx_raw = item.get("index", item.get("itemIndex", item.get("line", item.get("rowIndex"))))
    try:
      index = int(idx_raw)
    except Exception:
      continue
    if index < 0:
      continue

    row = normalize_provenance_entry(item.get("row"))
    fields_output: dict[str, dict[str, Any]] = {}
    fields_raw = item.get("fields")
    if isinstance(fields_raw, dict):
      for field_name, field_value in fields_raw.items():
        if not isinstance(field_name, str) or not field_name.strip():
          continue
        normalized = normalize_provenance_entry(field_value)
        if normalized is not None:
          fields_output[field_name.strip()] = normalized

    if row is None and not fields_output:
      continue
    normalized_item: dict[str, Any] = {"index": index}
    if row is not None:
      normalized_item["row"] = row
    if fields_output:
      normalized_item["fields"] = fields_output
    output.append(normalized_item)
  return output


def normalize_classification(value: Any) -> dict[str, str]:
  if not isinstance(value, dict):
    return {}

  output: dict[str, str] = {}
  invoice_type = normalize_text(value.get("invoiceType", value.get("type")))
  category = normalize_text(value.get("category", value.get("classification")))
  tds_section = normalize_text(value.get("tdsSection", value.get("tdsCategory", value.get("tds"))))
  if invoice_type:
    output["invoiceType"] = invoice_type
  if category:
    output["category"] = category
  if tds_section:
    output["tdsSection"] = tds_section
  return output


def extract_selected_payload(value: Any) -> dict[str, Any]:
  if not isinstance(value, dict):
    return {}
  selected: dict[str, Any] = {}
  block_indices: dict[str, int] = {}
  field_aliases = {
    "invoiceNumber": ("invoiceNumber",),
    "vendorName": ("vendorName", "vendorNameContains"),
    "currency": ("currency",),
    "totalAmountMinor": ("totalAmountMinor",),
    "invoiceDate": ("invoiceDate",),
    "dueDate": ("dueDate",)
  }
  field_provenance: dict[str, dict[str, Any]] = {}

  for field, aliases in field_aliases.items():
    raw = None
    for alias in aliases:
      if alias in value:
        raw = value[alias]
        break
    if raw is None:
      continue
    candidate = raw
    if isinstance(raw, dict):
      candidate = raw.get("value", raw.get("v"))
      bi = raw.get("blockIndex", raw.get("block_index"))
      if isinstance(bi, int) and bi >= 0:
        block_indices[field] = bi
      nested_provenance = normalize_provenance_entry(raw.get("provenance"))
      if nested_provenance is not None:
        field_provenance[field] = nested_provenance
        if "blockIndex" in nested_provenance and field not in block_indices:
          block_indices[field] = int(nested_provenance["blockIndex"])

    if field == "totalAmountMinor":
      if isinstance(candidate, int):
        selected[field] = candidate
      elif isinstance(candidate, str):
        stripped = candidate.strip()
        parsed = int(stripped) if re.fullmatch(r"\d+", stripped) else parse_minor_units(stripped)
        if parsed is not None:
          selected[field] = parsed
      continue

    if isinstance(candidate, str) and candidate.strip():
      selected[field] = candidate.strip().upper() if field == "currency" else candidate.strip()

  gst_raw = value.get("gst")
  if isinstance(gst_raw, dict):
    gst: dict[str, Any] = {}
    gstin_raw = gst_raw.get("gstin")
    if isinstance(gstin_raw, dict):
      gstin_val = gstin_raw.get("value", gstin_raw.get("v"))
      if isinstance(gstin_val, str) and gstin_val.strip():
        gst["gstin"] = gstin_val.strip()
      bi = gstin_raw.get("blockIndex", gstin_raw.get("block_index"))
      if isinstance(bi, int) and bi >= 0:
        block_indices["gst.gstin"] = bi
    elif isinstance(gstin_raw, str) and gstin_raw.strip():
      gst["gstin"] = gstin_raw.strip()

    for tax_field in ("subtotalMinor", "cgstMinor", "sgstMinor", "igstMinor", "cessMinor", "totalTaxMinor"):
      raw_val = gst_raw.get(tax_field)
      if isinstance(raw_val, dict):
        candidate_val = raw_val.get("value", raw_val.get("v"))
        bi = raw_val.get("blockIndex", raw_val.get("block_index"))
        if isinstance(bi, int) and bi >= 0:
          block_indices[f"gst.{tax_field}"] = bi
        raw_val = candidate_val
      if isinstance(raw_val, int):
        gst[tax_field] = raw_val
      elif isinstance(raw_val, str) and raw_val.strip():
        parsed_tax = parse_minor_units(raw_val.strip())
        if parsed_tax is not None:
          gst[tax_field] = parsed_tax
    if gst:
      selected["gst"] = gst

  line_items_raw = value.get("lineItems")
  if isinstance(line_items_raw, list):
    parsed_items: list[dict[str, Any]] = []
    for item in line_items_raw:
      if not isinstance(item, dict):
        continue
      desc = item.get("description")
      if not isinstance(desc, str) or not desc.strip():
        continue
      amount = item.get("amountMinor")
      if isinstance(amount, str):
        amount = parse_minor_units(amount)
      if not isinstance(amount, int):
        continue
      parsed_item: dict[str, Any] = {"description": desc.strip(), "amountMinor": amount}
      hsn = item.get("hsnSac")
      if isinstance(hsn, str) and hsn.strip():
        parsed_item["hsnSac"] = hsn.strip()
      for num_field in ("quantity", "rate", "taxRate"):
        nv = item.get(num_field)
        if isinstance(nv, (int, float)) and nv > 0:
          parsed_item[num_field] = nv
      for tax_field in ("cgstMinor", "sgstMinor", "igstMinor"):
        tv = item.get(tax_field)
        if isinstance(tv, int):
          parsed_item[tax_field] = tv
        elif isinstance(tv, str):
          ptv = parse_minor_units(tv)
          if ptv is not None:
            parsed_item[tax_field] = ptv
      parsed_items.append(parsed_item)
    if parsed_items:
      selected["lineItems"] = parsed_items

  pan_raw = value.get("pan")
  if isinstance(pan_raw, str) and pan_raw.strip():
    pan_upper = pan_raw.strip().upper()
    if PAN_PATTERN.match(pan_upper):
      selected["pan"] = pan_upper

  bank_account = value.get("bankAccountNumber")
  if isinstance(bank_account, str) and bank_account.strip():
    selected["bankAccountNumber"] = bank_account.strip()

  bank_ifsc = value.get("bankIfsc")
  if isinstance(bank_ifsc, str) and bank_ifsc.strip():
    ifsc_upper = bank_ifsc.strip().upper()
    if IFSC_PATTERN.match(ifsc_upper):
      selected["bankIfsc"] = ifsc_upper

  udyam_raw = value.get("udyamNumber")
  if isinstance(udyam_raw, str) and udyam_raw.strip():
    udyam_upper = udyam_raw.strip().upper()
    if UDYAM_PATTERN.match(udyam_upper):
      selected["udyamNumber"] = udyam_upper

  if block_indices:
    selected["_blockIndices"] = block_indices

  field_confidence = normalize_field_confidence(value.get("_fieldConfidence", value.get("fieldConfidence")))
  if field_confidence:
    selected["_fieldConfidence"] = field_confidence

  top_level_field_provenance = normalize_field_provenance(value.get("_fieldProvenance", value.get("fieldProvenance")))
  if top_level_field_provenance:
    field_provenance.update(top_level_field_provenance)
  if field_provenance:
    selected["_fieldProvenance"] = field_provenance

  line_item_provenance = normalize_line_item_provenance(
    value.get("_lineItemProvenance", value.get("lineItemProvenance"))
  )
  if not line_item_provenance and isinstance(line_items_raw, list):
    for index, item in enumerate(line_items_raw):
      if not isinstance(item, dict):
        continue
      nested_provenance = normalize_provenance_entry(item.get("provenance"))
      if nested_provenance is None:
        continue
      line_item_provenance.append(
        {
          "index": index,
          "row": nested_provenance,
          "fields": {
            "amountMinor": nested_provenance
          }
        }
      )
  if line_item_provenance:
    selected["_lineItemProvenance"] = line_item_provenance

  classification = normalize_classification(value.get("_classification", value.get("classification")))
  if classification:
    selected["_classification"] = classification
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


def apply_mode(mode: str, current: dict[str, Any], selected: dict[str, Any]) -> dict[str, Any]:
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


def looks_like_address(line: str) -> bool:
  return bool(re.search(
    r"\b(address|warehouse|village|road|street|taluk|district|invoice|bill|gst|vat|tax|phone|email|customer)\b",
    line,
    re.IGNORECASE
  ))
