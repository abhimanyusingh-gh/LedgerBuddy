import re
import time
import uuid
from typing import Any, Literal

from fastapi import FastAPI, Request
from pydantic import BaseModel, Field

app = FastAPI(title="Invoice SLM Verifier", version="1.0.0")

VENDOR_BANNED_PATTERN = re.compile(
  r"\b(address|warehouse|village|road|street|taluk|district|invoice|bill|gst|vat|tax|phone|email|customer)\b",
  re.IGNORECASE
)
INVOICE_NUMBER_PATTERN = re.compile(
  r"(?:invoice|bill|inv)\s*(?:number|no\.?|#)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})",
  re.IGNORECASE
)
TOTAL_PATTERN = re.compile(
  r"(?:grand\s*total|invoice\s*total|amount\s*due|balance\s*due|total\s*due|total)\s*[:\-]?\s*([₹$€£]?\s*[-+]?(?:\d{1,3}(?:[,\s.]\d{3})+|\d+)(?:[.,]\d{1,2})?)",
  re.IGNORECASE
)


class VerifyInvoiceRequest(BaseModel):
  parsed: dict[str, Any] = Field(default_factory=dict)
  ocrText: str = ""
  ocrBlocks: list[dict[str, Any]] = Field(default_factory=list)
  mode: Literal["strict", "relaxed"] = "strict"
  hints: dict[str, Any] = Field(default_factory=dict)


class VerifyInvoiceResponse(BaseModel):
  parsed: dict[str, Any]
  issues: list[str]
  changedFields: list[str]


@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
  correlation_id = request.headers.get("x-correlation-id", "").strip() or uuid.uuid4().hex
  request.state.correlation_id = correlation_id
  started = time.perf_counter()
  response = await call_next(request)
  response.headers["x-correlation-id"] = correlation_id
  latency_ms = int((time.perf_counter() - started) * 1000)
  print(
    {
      "service": "slm-verifier",
      "event": "request.end",
      "path": request.url.path,
      "method": request.method,
      "status": response.status_code,
      "latencyMs": latency_ms,
      "correlationId": correlation_id
    },
    flush=True
  )
  return response


@app.get("/health")
def health() -> dict[str, str]:
  return {"status": "ok"}


@app.get("/v1/health")
def health_v1() -> dict[str, str]:
  return {"status": "ok"}


@app.post("/v1/verify/invoice", response_model=VerifyInvoiceResponse)
def verify_invoice(request: VerifyInvoiceRequest) -> VerifyInvoiceResponse:
  current = {key: value for key, value in request.parsed.items() if value not in ("", None)}
  suggestions = suggest_fields(request.ocrText, request.ocrBlocks)
  mode = request.mode

  merged = dict(current)
  changed_fields: list[str] = []
  issues: list[str] = []

  for field, candidate in suggestions.items():
    if candidate in ("", None):
      continue

    if mode == "strict":
      if field in merged and merged.get(field) not in ("", None):
        if field == "vendorName" and looks_like_address(str(merged[field])) and not looks_like_address(str(candidate)):
          merged[field] = candidate
          changed_fields.append(field)
        continue
      merged[field] = candidate
      changed_fields.append(field)
      continue

    if merged.get(field) != candidate:
      merged[field] = candidate
      changed_fields.append(field)

  if "vendorName" in merged and looks_like_address(str(merged["vendorName"])):
    issues.append("Verifier detected address-like vendor value.")

  if "invoiceNumber" not in merged:
    issues.append("Verifier could not recover invoice number.")

  if "totalAmountMinor" not in merged:
    issues.append("Verifier could not recover total amount.")

  if "currency" not in merged:
    issues.append("Verifier could not recover currency.")

  return VerifyInvoiceResponse(parsed=merged, issues=issues, changedFields=changed_fields)


def suggest_fields(text: str, blocks: list[dict[str, Any]]) -> dict[str, Any]:
  lines = normalized_lines(text)
  block_lines = extract_top_block_lines(blocks)
  suggestions: dict[str, Any] = {}

  invoice_match = INVOICE_NUMBER_PATTERN.search(text)
  if invoice_match:
    suggestions["invoiceNumber"] = invoice_match.group(1).strip()

  vendor = detect_vendor(lines, block_lines)
  if vendor:
    suggestions["vendorName"] = vendor

  amount_text = detect_total_text(lines)
  if amount_text:
    amount_value, currency = parse_amount_and_currency(amount_text)
    if amount_value is not None:
      suggestions["totalAmountMinor"] = amount_value
    if currency:
      suggestions["currency"] = currency

  if "currency" not in suggestions:
    currency = detect_currency(text)
    if currency:
      suggestions["currency"] = currency

  return suggestions


def normalized_lines(text: str) -> list[str]:
  return [line.strip() for line in text.replace("\r", "\n").split("\n") if line.strip()]


def extract_top_block_lines(blocks: list[dict[str, Any]]) -> list[str]:
  ranked: list[tuple[int, int, str]] = []
  for block in blocks:
    text = str(block.get("text", "")).strip()
    bbox = block.get("bbox")
    if not text or not isinstance(bbox, list) or len(bbox) != 4:
      continue
    try:
      y = int(float(bbox[1]))
      x = int(float(bbox[0]))
    except (TypeError, ValueError):
      continue
    ranked.append((y, x, text))
  ranked.sort(key=lambda entry: (entry[0], entry[1]))
  return [entry[2] for entry in ranked[:14]]


def detect_vendor(lines: list[str], block_lines: list[str]) -> str | None:
  for line in lines[:20]:
    if line.lower().startswith(("vendor:", "supplier:", "sold by:", "bill from:", "from:")):
      candidate = line.split(":", 1)[1].strip()
      if is_vendor_candidate(candidate):
        return candidate

  for line in block_lines + lines[:18]:
    if is_vendor_candidate(line):
      return line

  return None


def is_vendor_candidate(line: str) -> bool:
  if len(line) < 3:
    return False
  if VENDOR_BANNED_PATTERN.search(line):
    return False
  letter_count = sum(1 for char in line if char.isalpha())
  if letter_count < 3:
    return False
  return True


def looks_like_address(line: str) -> bool:
  return bool(VENDOR_BANNED_PATTERN.search(line))


def detect_total_text(lines: list[str]) -> str | None:
  for line in reversed(lines):
    if TOTAL_PATTERN.search(line):
      return line
  return None


def parse_amount_and_currency(line: str) -> tuple[int | None, str | None]:
  match = TOTAL_PATTERN.search(line)
  if not match:
    return None, None

  raw = match.group(1).replace(" ", "")
  currency = detect_currency(raw)
  amount = parse_minor_units(raw)
  return amount, currency


def detect_currency(text: str) -> str | None:
  upper = text.upper()
  if "₹" in text or "INR" in upper:
    return "INR"
  if "$" in text or "USD" in upper:
    return "USD"
  if "€" in text or "EUR" in upper:
    return "EUR"
  if "£" in text or "GBP" in upper:
    return "GBP"
  return None


def parse_minor_units(raw_value: str) -> int | None:
  cleaned = re.sub(r"[^0-9,.\-+]", "", raw_value)
  if not cleaned:
    return None

  negative = cleaned.startswith("-")
  normalized = cleaned.lstrip("+-")
  if normalized.count(",") > 0 and normalized.count(".") > 0:
    if normalized.rfind(",") > normalized.rfind("."):
      normalized = normalized.replace(".", "").replace(",", ".")
    else:
      normalized = normalized.replace(",", "")
  elif normalized.count(",") > 0:
    if normalized.count(",") == 1 and len(normalized.split(",")[-1]) <= 2:
      normalized = normalized.replace(",", ".")
    else:
      normalized = normalized.replace(",", "")

  try:
    value = float(normalized)
  except ValueError:
    return None
  if not (value > 0):
    return None

  minor = int(round(value * 100))
  return -minor if negative else minor
