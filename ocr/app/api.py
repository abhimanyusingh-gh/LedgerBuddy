import time
import uuid
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from .engine import estimate_confidence, parse_data_url
from .providers import create_ocr_provider
from .logging import log_error, log_info, reset_correlation_id, set_correlation_id
from .schemas import OcrDocumentRequest
from .settings import settings

provider = create_ocr_provider()
app = FastAPI(title="Invoice OCR Service", version="2.0.0")


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
  incoming = request.headers.get("x-correlation-id", "").strip()
  correlation_id = incoming if incoming else uuid.uuid4().hex
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
  return provider.health()


@app.get("/ping")
def ping() -> dict[str, Any]:
  return {"pong": True}


@app.get("/v1/models")
def list_models() -> dict[str, Any]:
  return {
    "object": "list",
    "data": provider.list_models()
  }


@app.post("/v1/ocr/document")
def ocr_document(request: OcrDocumentRequest) -> dict[str, Any]:
  document = request.document.strip()
  if not document:
    raise HTTPException(status_code=400, detail="Request field 'document' must contain a data URL payload.")

  mime_type, document_bytes = parse_data_url(document)
  include_layout = bool(request.includeLayout)
  max_tokens = max(64, min(int(request.maxTokens), settings.max_new_tokens))
  started_at = time.perf_counter()

  try:
    extraction = provider.extract_document(
      image_bytes=document_bytes,
      mime_type=mime_type,
      prompt=request.prompt,
      include_layout=include_layout,
      max_tokens=max_tokens
    )
  except HTTPException:
    raise
  except Exception as error:
    log_error("ocr.document.failed", mimeType=mime_type, includeLayout=include_layout, error=str(error))
    raise HTTPException(status_code=500, detail=f"OCR extraction failed: {error}") from error

  raw_text = str(extraction.get("rawText", ""))
  blocks = extraction["blocks"] if isinstance(extraction.get("blocks"), list) else []
  page_images = extraction["pageImages"] if isinstance(extraction.get("pageImages"), list) else []
  confidence = normalize_confidence(extraction.get("confidence"))
  if confidence is None:
    confidence = estimate_confidence(raw_text, blocks)
  elapsed_ms = int((time.perf_counter() - started_at) * 1000)

  log_info(
    "ocr.document.complete",
    mimeType=mime_type,
    includeLayout=include_layout,
    blockCount=len(blocks),
    latencyMs=elapsed_ms
  )

  response: dict[str, Any] = {
    "id": f"ocr-{uuid.uuid4().hex}",
    "object": "ocr.document",
    "created": int(time.time()),
    "model": request.model or extraction.get("model", ""),
    "provider": extraction.get("provider", "ocr-provider"),
    "mimeType": mime_type,
    "rawText": raw_text,
    "confidence": int(round(confidence * 100)),
    "blocks": blocks,
    "pageImages": page_images,
    "engineMode": extraction.get("mode", "unknown"),
    "latencyMs": elapsed_ms
  }
  usage = extraction.get("usage")
  if isinstance(usage, dict):
    response["usage"] = usage
  return response


def normalize_confidence(value: Any) -> float | None:
  try:
    parsed = float(value)
  except Exception:
    return None
  if parsed > 1:
    parsed = parsed / 100.0
  if parsed < 0:
    return 0.0
  if parsed > 1:
    return 1.0
  return round(parsed, 4)
