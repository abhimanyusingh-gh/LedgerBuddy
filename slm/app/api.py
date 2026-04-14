import concurrent.futures
import time
import uuid
from typing import Any

from fastapi import FastAPI, Request

from .engine import select_with_fallback, extract_invoice_type
from .payload_normalization import normalize_blocks, normalize_candidate_map, normalize_field_regions
from .providers import create_llm_provider
from .providers.shared import build_extractor_prompt, build_comparator_prompt, build_verifier_prompt
from .logging import log_error, log_info, reset_correlation_id, set_correlation_id
from .schemas import VerifyInvoiceRequest, VerifyInvoiceResponse
from .settings import settings

app = FastAPI(title="Invoice SLM Service", version="2.0.0")
provider = create_llm_provider()


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
  correlation_id = request.headers.get("x-correlation-id", "").strip() or uuid.uuid4().hex
  token = set_correlation_id(correlation_id)
  started_at = time.perf_counter()

  log_info("request.start", method=request.method, path=request.url.path)
  try:
    response = await call_next(request)
  except Exception as error:
    log_error("request.failed", method=request.method, path=request.url.path, error=str(error))
    reset_correlation_id(token)
    raise

  response.headers["x-correlation-id"] = correlation_id
  log_info(
    "request.end",
    method=request.method,
    path=request.url.path,
    status=response.status_code,
    latencyMs=int((time.perf_counter() - started_at) * 1000)
  )
  reset_correlation_id(token)
  return response


@app.on_event("startup")
def on_startup() -> None:
  provider.startup()


@app.get("/health")
def health() -> dict[str, Any]:
  return provider.health()


@app.get("/ping")
def ping() -> dict[str, Any]:
  return {"pong": True}


def single_step_inference(provider: Any, inference_payload: dict[str, Any]) -> dict[str, Any]:
  extractor_prompt = build_extractor_prompt(inference_payload, strict=True)
  extraction: dict[str, Any] = provider.call_prompt(extractor_prompt)

  final: dict[str, Any] | None = None
  try:
    verifier_prompt = build_verifier_prompt(inference_payload, extraction, strict=True)
    final = provider.call_prompt(verifier_prompt)
  except Exception as e:
    log_error("slm.single_step.verifier.failed", error=str(e))
    final = extraction

  invoice_type = None
  classification = final.get("classification") if isinstance(final, dict) else None
  if isinstance(classification, dict):
    invoice_type = classification.get("invoiceType")

  return {
    "selected": final,
    "reasonCodes": {"single_step": "extractor_verifier"},
    "issues": [],
    "invoiceType": invoice_type
  }


def multi_step_inference(provider: Any, inference_payload: dict[str, Any]) -> dict[str, Any]:
  extractor_prompt = build_extractor_prompt(inference_payload, strict=True)

  extraction_a: dict[str, Any] | None = None
  extraction_b: dict[str, Any] | None = None
  error_a: Exception | None = None
  error_b: Exception | None = None

  def run_extractor() -> dict[str, Any]:
    return provider.call_prompt(extractor_prompt)

  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    future_a = executor.submit(run_extractor)
    future_b = executor.submit(run_extractor)
    try:
      extraction_a = future_a.result()
    except Exception as e:
      error_a = e
      log_error("slm.multi_step.extractor_a.failed", error=str(e))
    try:
      extraction_b = future_b.result()
    except Exception as e:
      error_b = e
      log_error("slm.multi_step.extractor_b.failed", error=str(e))

  if extraction_a is None and extraction_b is None:
    raise RuntimeError(f"Both extractors failed. A={error_a} B={error_b}")

  if extraction_a is None:
    extraction_a = extraction_b
  if extraction_b is None:
    extraction_b = extraction_a

  merged: dict[str, Any] | None = None
  try:
    comparator_prompt = build_comparator_prompt(inference_payload, extraction_a, extraction_b, strict=True)
    merged = provider.call_prompt(comparator_prompt)
  except Exception as e:
    log_error("slm.multi_step.comparator.failed", error=str(e))
    merged = extraction_a if extraction_a is not None else extraction_b

  final: dict[str, Any] | None = None
  try:
    verifier_prompt = build_verifier_prompt(inference_payload, merged, strict=True)
    final = provider.call_prompt(verifier_prompt)
  except Exception as e:
    log_error("slm.multi_step.verifier.failed", error=str(e))
    final = merged

  invoice_type = None
  classification = final.get("classification") if isinstance(final, dict) else None
  if isinstance(classification, dict):
    invoice_type = classification.get("invoiceType")

  return {
    "selected": final,
    "reasonCodes": {"multi_step": "extractor_comparator_verifier"},
    "issues": [],
    "invoiceType": invoice_type
  }


@app.post("/v1/verify/invoice", response_model=VerifyInvoiceResponse)
def verify_invoice(request: VerifyInvoiceRequest) -> VerifyInvoiceResponse:
  current = {key: value for key, value in request.parsed.items() if value not in ("", None)}
  candidate_map = normalize_candidate_map(request.hints.get("fieldCandidates"))
  blocks = normalize_blocks(request.ocrBlocks)
  field_regions = normalize_field_regions(request.hints.get("fieldRegions"))

  slm_payload = None
  slm_error = None
  inference_payload = {
    "mode": request.mode,
    "parsed": current,
    "ocrText": request.ocrText,
    "fieldCandidates": candidate_map,
    "fieldRegions": field_regions,
    "ocrBlocks": blocks,
    "documentContext": request.hints.get("documentContext"),
    "vendorNameHint": request.hints.get("vendorNameHint"),
    "vendorTemplateMatched": bool(request.hints.get("vendorTemplateMatched")),
    "pageImages": request.hints.get("pageImages"),
    "llmAssist": bool(request.hints.get("llmAssist")),
    "languageHint": request.hints.get("languageHint"),
    "documentLanguage": request.hints.get("documentLanguage"),
    "priorCorrections": request.hints.get("priorCorrections"),
    "extractionMode": request.hints.get("extractionMode"),
    "bankStatementPrompt": request.hints.get("bankStatementPrompt")
  }

  pipeline = "multi_step" if settings.multi_step_extraction else settings.extraction_pipeline
  try:
    if pipeline == "multi_step":
      try:
        slm_payload = multi_step_inference(provider, inference_payload)
      except NotImplementedError:
        slm_payload = provider.select_fields(inference_payload)
    elif pipeline == "single_verify":
      try:
        slm_payload = single_step_inference(provider, inference_payload)
      except NotImplementedError:
        slm_payload = provider.select_fields(inference_payload)
    else:
      slm_payload = provider.select_fields(inference_payload)
  except Exception as error:
    slm_error = str(error)
    log_error("slm.infer.failed", error=slm_error)

  merged, reason_codes, issues = select_with_fallback(
    request.mode,
    current,
    candidate_map,
    blocks,
    field_regions,
    slm_payload,
    slm_error
  )

  if not isinstance(merged.get("currency"), str) or not str(merged.get("currency")).strip():
    merged["currency"] = "INR"
    reason_codes["currency"] = "default_currency_inr"

  changed_fields = sorted(
    [field for field, value in merged.items() if current.get(field) != value and value not in ("", None)]
  )

  if "invoiceNumber" not in merged:
    issues.append("Verifier could not recover invoice number.")
  if "totalAmountMinor" not in merged:
    issues.append("Verifier could not recover total amount.")
  if "currency" not in merged:
    issues.append("Verifier could not recover currency.")
  if "vendorName" in merged and isinstance(merged["vendorName"], str) and "address" in merged["vendorName"].lower():
    issues.append("Verifier detected address-like vendor value.")

  deduped_issues = sorted({issue.strip() for issue in issues if issue.strip()})

  invoice_type = extract_invoice_type(slm_payload)

  usage = slm_payload.pop("_usage", None) if isinstance(slm_payload, dict) else None
  field_provenance = merged.get("_fieldProvenance") if isinstance(merged.get("_fieldProvenance"), dict) else {}
  line_item_provenance = merged.get("_lineItemProvenance") if isinstance(merged.get("_lineItemProvenance"), list) else []
  result = build_contract_result(merged, field_provenance, line_item_provenance, request.hints)

  return VerifyInvoiceResponse(
    result=result,
    parsed=merged,
    issues=deduped_issues,
    changedFields=changed_fields,
    reasonCodes=reason_codes,
    invoiceType=invoice_type,
    usage=usage if isinstance(usage, dict) else None,
    fieldProvenance=field_provenance,
    lineItemProvenance=line_item_provenance
  )


def build_contract_result(
  merged: dict[str, Any],
  field_provenance: dict[str, Any],
  line_item_provenance: list[dict[str, Any]],
  hints: dict[str, Any]
) -> dict[str, Any]:
  result: dict[str, Any] = {}
  filename = hints.get("fileName") or hints.get("filename") or hints.get("attachmentName")
  if isinstance(filename, str) and filename.strip():
    result["file"] = filename.strip()
  if isinstance(merged.get("lineItems"), list):
    result["lineItemCount"] = len(merged["lineItems"])

  scalar_mappings = [
    ("invoiceNumber", "invoiceNumber"),
    ("vendorNameContains", "vendorName"),
    ("invoiceDate", "invoiceDate"),
    ("dueDate", "dueDate"),
    ("currency", "currency"),
    ("totalAmountMinor", "totalAmountMinor")
  ]
  for contract_key, merged_key in scalar_mappings:
    value = merged.get(merged_key)
    if value in (None, "", []):
      continue
    payload: dict[str, Any] = {"value": value}
    provenance = field_provenance.get(merged_key)
    if isinstance(provenance, dict) and provenance:
      payload["provenance"] = provenance
    result[contract_key] = payload

  gst_value = merged.get("gst")
  if isinstance(gst_value, dict):
    gst_result: dict[str, Any] = {}
    for field_name in ("cgstMinor", "sgstMinor", "igstMinor", "cessMinor", "subtotalMinor", "totalTaxMinor"):
      value = gst_value.get(field_name)
      if value in (None, "", []):
        continue
      payload = {"value": value}
      provenance = field_provenance.get(f"gst.{field_name}")
      if isinstance(provenance, dict) and provenance:
        payload["provenance"] = provenance
      gst_result[field_name] = payload
    if gst_result:
      result["gst"] = gst_result

  line_items = merged.get("lineItems")
  if isinstance(line_items, list):
    contract_items: list[dict[str, Any]] = []
    for index, entry in enumerate(line_items):
      if not isinstance(entry, dict):
        continue
      amount_minor = entry.get("amountMinor")
      if not isinstance(amount_minor, int):
        continue
      item_payload: dict[str, Any] = {
        "amountMinor": amount_minor
      }
      description = entry.get("description")
      if isinstance(description, str) and description.strip():
        item_payload["description"] = description.strip()
      provenance = next((candidate for candidate in line_item_provenance if isinstance(candidate, dict) and candidate.get("index") == index), None)
      amount_provenance = provenance.get("fields", {}).get("amountMinor") if isinstance(provenance, dict) and isinstance(provenance.get("fields"), dict) else None
      row_provenance = provenance.get("row") if isinstance(provenance, dict) and isinstance(provenance.get("row"), dict) else None
      selected_provenance = amount_provenance if isinstance(amount_provenance, dict) else row_provenance
      if isinstance(selected_provenance, dict) and selected_provenance:
        item_payload["provenance"] = selected_provenance
      contract_items.append(item_payload)
    if contract_items:
      result["lineItems"] = contract_items

  return result
