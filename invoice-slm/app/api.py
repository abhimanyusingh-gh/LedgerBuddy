import time
import uuid
from typing import Any

from fastapi import FastAPI, Request

from .engine import normalize_blocks, normalize_candidate_map, normalize_field_regions, select_with_fallback
from .providers import create_llm_provider
from .logging import log_error, log_info, reset_correlation_id, set_correlation_id
from .schemas import VerifyInvoiceRequest, VerifyInvoiceResponse

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


@app.get("/v1/health")
def health_v1() -> dict[str, Any]:
  return health()


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
    "vendorNameHint": request.hints.get("vendorNameHint"),
    "vendorTemplateMatched": bool(request.hints.get("vendorTemplateMatched"))
  }

  try:
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

  return VerifyInvoiceResponse(
    parsed=merged,
    issues=deduped_issues,
    changedFields=changed_fields,
    reasonCodes=reason_codes
  )
