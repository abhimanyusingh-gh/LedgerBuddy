from __future__ import annotations

import json
from pathlib import Path
import re
import time
from threading import Lock
from typing import Any, Literal, Protocol
from urllib import error as url_error
from urllib import request as url_request

from huggingface_hub import snapshot_download

from .logging import log_error, log_info
from .settings import settings

INVOICE_NUMBER_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9_\-/]{2,}$", re.IGNORECASE)
VENDOR_BANNED_PATTERN = re.compile(
  r"\b(address|warehouse|village|road|street|taluk|district|invoice|bill|gst|vat|tax|phone|email|customer)\b",
  re.IGNORECASE
)
VALID_CURRENCIES = {"USD", "EUR", "GBP", "INR", "AUD", "CAD", "JPY", "AED", "SGD", "CHF", "CNY"}
SYSTEM_PROMPT = (
  "You are an invoice field verification engine. "
  "Return one JSON object only. "
  "Never return markdown. "
  "Never explain. "
  "Never invent values that are not present in candidates or OCR blocks."
)


class SlmEngine(Protocol):
  def startup(self) -> None: ...
  def health(self) -> dict[str, Any]: ...
  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]: ...


class LocalMlxSlmEngine:
  def __init__(self, model_id: str) -> None:
    self.model_id = model_id
    self.lock = Lock()
    self.loaded = False
    self.loading = False
    self.last_error = ""
    self.model: Any = None
    self.tokenizer: Any = None
    self.generate_fn: Any = None

  def startup(self) -> None:
    if settings.load_on_startup:
      self.ensure_loaded()

  def health(self) -> dict[str, Any]:
    status = "ok"
    if self.loading:
      status = "loading"
    elif settings.load_on_startup and not self.loaded:
      status = "starting"
    elif self.last_error:
      status = "error"
    return {
      "status": status,
      "modelId": self.model_id,
      "modelLoaded": self.loaded,
      "modelLoading": self.loading,
      "lastError": self.last_error or "",
      "engine": "local_mlx"
    }

  def ensure_loaded(self) -> None:
    if self.loaded:
      return

    with self.lock:
      if self.loaded:
        return

      self.loading = True
      started_at = time.perf_counter()
      try:
        from mlx_lm import generate as mlx_generate
        from mlx_lm import load as mlx_load

        model_path = resolve_model_path(self.model_id)
        model, tokenizer = mlx_load(str(model_path), lazy=False)
        self.model = model
        self.tokenizer = tokenizer
        self.generate_fn = mlx_generate
        self.loaded = True
        self.last_error = ""
        log_info(
          "slm.model.load.complete",
          modelId=self.model_id,
          modelPath=str(model_path),
          latencyMs=int((time.perf_counter() - started_at) * 1000)
        )
      except Exception as error:
        self.last_error = str(error)
        log_error("slm.model.load.failed", modelId=self.model_id, error=str(error))
        raise
      finally:
        self.loading = False

  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    self.ensure_loaded()
    if self.model is None or self.tokenizer is None or self.generate_fn is None:
      raise RuntimeError("SLM model is not initialized.")

    prompt = build_prompt(self.tokenizer, payload)
    raw_output = self.generate_fn(
      self.model,
      self.tokenizer,
      prompt,
      verbose=False,
      max_tokens=settings.max_new_tokens
    )

    parsed = parse_json_object(raw_output)
    if parsed is None:
      raise RuntimeError("SLM output was not valid JSON.")
    return parsed


class RemoteHttpSlmEngine:
  def __init__(
    self,
    model_id: str,
    base_url: str,
    select_path: str,
    api_key: str,
    timeout_ms: int,
    validate_on_startup: bool
  ) -> None:
    self.model_id = model_id
    self.base_url = base_url.rstrip("/")
    self.select_path = ensure_path(select_path)
    self.api_key = api_key.strip()
    self.timeout_ms = timeout_ms
    self.validate_on_startup = validate_on_startup
    self.last_error = ""

  def startup(self) -> None:
    if self.validate_on_startup:
      self._request_json("/health")

  def health(self) -> dict[str, Any]:
    payload: dict[str, Any] = {
      "status": "ok",
      "modelId": self.model_id,
      "modelLoaded": True,
      "modelLoading": False,
      "lastError": self.last_error or "",
      "engine": "remote_http"
    }
    try:
      remote = self._request_json("/health")
      if isinstance(remote, dict):
        payload["remote"] = remote
    except Exception as error:
      payload["status"] = "error"
      payload["lastError"] = str(error)
      self.last_error = str(error)
    return payload

  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    request_body = {
      "parsed": payload.get("parsed", {}),
      "ocrText": payload.get("ocrText", ""),
      "ocrBlocks": payload.get("ocrBlocks", []),
      "mode": payload.get("mode", "strict"),
      "hints": {
        "fieldCandidates": payload.get("fieldCandidates", {}),
        "fieldRegions": payload.get("fieldRegions", {}),
        "vendorNameHint": payload.get("vendorNameHint"),
        "vendorTemplateMatched": bool(payload.get("vendorTemplateMatched"))
      }
    }
    response = self._request_json(self.select_path, body=request_body)
    if not isinstance(response, dict):
      raise RuntimeError("Remote SLM returned invalid payload.")

    selected = response.get("selected")
    if isinstance(selected, dict):
      return {
        "selected": selected,
        "reasonCodes": response.get("reasonCodes") if isinstance(response.get("reasonCodes"), dict) else {},
        "issues": response.get("issues") if isinstance(response.get("issues"), list) else []
      }

    parsed = response.get("parsed")
    if isinstance(parsed, dict):
      return {
        "selected": parsed,
        "reasonCodes": response.get("reasonCodes") if isinstance(response.get("reasonCodes"), dict) else {},
        "issues": response.get("issues") if isinstance(response.get("issues"), list) else []
      }

    raise RuntimeError("Remote SLM payload does not contain selected/parsed output.")

  def _request_json(self, path: str, body: dict[str, Any] | None = None) -> Any:
    url = f"{self.base_url}{ensure_path(path)}"
    headers = {"Content-Type": "application/json"}
    if self.api_key:
      headers["Authorization"] = f"Bearer {self.api_key}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = url_request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    timeout_seconds = max(1, int(self.timeout_ms / 1000))

    try:
      with url_request.urlopen(request, timeout=timeout_seconds) as response:
        return json.loads(response.read().decode("utf-8"))
    except url_error.HTTPError as error:
      detail = error.read().decode("utf-8", errors="replace")
      raise RuntimeError(f"Remote SLM HTTP {error.code}: {detail[:400]}") from error
    except Exception as error:
      raise RuntimeError(f"Remote SLM request failed: {error}") from error


def create_slm_engine() -> SlmEngine:
  if settings.engine == "remote_http":
    if not settings.remote_base_url:
      raise RuntimeError("SLM_ENGINE=remote_http requires SLM_REMOTE_BASE_URL.")
    return RemoteHttpSlmEngine(
      model_id=settings.model_id,
      base_url=settings.remote_base_url,
      select_path=settings.remote_select_path,
      api_key=settings.remote_api_key,
      timeout_ms=settings.remote_timeout_ms,
      validate_on_startup=settings.validate_remote_on_startup
    )

  return LocalMlxSlmEngine(settings.model_id)


def ensure_path(value: str) -> str:
  return value if value.startswith("/") else f"/{value}"


def resolve_model_path(model_id: str) -> Path:
  env_path = settings.model_path
  if env_path:
    candidate = Path(env_path).expanduser().resolve()
    if candidate.exists():
      return candidate
    raise RuntimeError(f"SLM_MODEL_PATH '{candidate}' does not exist.")

  direct = Path(model_id)
  if direct.exists():
    return direct.resolve()

  return Path(
    snapshot_download(
      repo_id=model_id,
      local_files_only=not settings.allow_download
    )
  )


def build_prompt(tokenizer: Any, payload: dict[str, Any]) -> str:
  instruction = (
    "Use OCR text blocks and bounding boxes to choose invoice fields. "
    "Output schema must be exactly: "
    "{\"selected\":{\"invoiceNumber\":\"\",\"vendorName\":\"\",\"currency\":\"\",\"totalAmountMinor\":0,"
    "\"invoiceDate\":\"\",\"dueDate\":\"\"},\"reasonCodes\":{},\"issues\":[]} "
    "Rules: vendorName cannot be an address; totalAmountMinor must be integer minor units; "
    "if unknown keep empty string or 0."
  )
  compact_payload = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
  user_message = f"{instruction}\nINPUT_JSON:{compact_payload}\nOUTPUT_JSON:"

  chat_builder = getattr(tokenizer, "apply_chat_template", None)
  if callable(chat_builder):
    try:
      return str(
        chat_builder(
          [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message}
          ],
          tokenize=False,
          add_generation_prompt=True
        )
      )
    except Exception:
      pass

  return f"{SYSTEM_PROMPT}\n{user_message}"


def parse_json_object(text: str) -> dict[str, Any] | None:
  candidate = text.strip()
  if not candidate:
    return None

  parsed = try_parse_json(candidate)
  if parsed is not None:
    return parsed

  for match in re.finditer(r"\{", candidate):
    start = match.start()
    for end in range(len(candidate), start, -1):
      snippet = candidate[start:end]
      parsed = try_parse_json(snippet)
      if parsed is not None:
        return parsed

  return None


def try_parse_json(text: str) -> dict[str, Any] | None:
  try:
    parsed = json.loads(text)
  except Exception:
    return None
  return parsed if isinstance(parsed, dict) else None


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
      bbox = normalize_bbox(block.get("bbox"))
      if bbox is not None:
        bbox_norm = bbox

    normalized.append(
      {
        "text": text[:220],
        "page": page,
        "bboxNormalized": bbox_norm or [0.0, 0.0, 0.0, 0.0],
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
    parsed = [float(entry) for entry in value]
  except Exception:
    return None
  return parsed


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

    validated = validate_selected_values(selected, candidate_map)
    if validated:
      for field in validated.keys():
        reason_codes.setdefault(field, "slm_selected")
      merged = apply_mode(mode, current, validated)
      if repair_vendor_name(merged, candidate_map, field_regions.get("vendorName") or blocks):
        reason_codes.setdefault("vendorName", "heuristic_vendor_repair")
      return merged, reason_codes, issues

    issues.append("SLM returned no valid field selections.")

  if slm_error:
    issues.append(f"SLM unavailable: {slm_error}")

  fallback_selected, fallback_codes = heuristic_select(candidate_map, blocks, field_regions, current, mode)
  issues.append("Applied heuristic fallback for unresolved fields.")
  return apply_mode(mode, current, fallback_selected), fallback_codes, issues


def normalize_selected_payload(value: Any) -> dict[str, Any]:
  if not isinstance(value, dict):
    return {}
  selected: dict[str, Any] = {}
  for field in ("invoiceNumber", "vendorName", "currency", "totalAmountMinor", "invoiceDate", "dueDate"):
    if field not in value:
      continue
    candidate = value[field]
    if field == "totalAmountMinor":
      if isinstance(candidate, int) and candidate > 0:
        selected[field] = candidate
      elif isinstance(candidate, str):
        stripped = candidate.strip()
        if re.fullmatch(r"\d+", stripped):
          parsed = int(stripped)
        else:
          parsed = parse_minor_units(stripped)
        if parsed is not None and parsed > 0:
          selected[field] = parsed
      continue

    if isinstance(candidate, str) and candidate.strip():
      selected[field] = candidate.strip()

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
  value_norm = value.strip().upper() if field == "currency" else value.strip()
  candidate_set = {entry.strip().upper() if field == "currency" else entry.strip() for entry in candidates}
  return value_norm in candidate_set


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

  invoice_candidates = candidate_map.get("invoiceNumber", [])
  invoice_value = pick_invoice_number(invoice_candidates)
  if invoice_value:
    selected["invoiceNumber"] = invoice_value
    reason_codes["invoiceNumber"] = "heuristic_invoice_pattern"

  vendor_candidates = candidate_map.get("vendorName", [])
  vendor_value = pick_vendor_name(vendor_candidates, field_regions.get("vendorName") or blocks)
  if vendor_value:
    selected["vendorName"] = vendor_value
    reason_codes["vendorName"] = "heuristic_vendor_spatial"

  currency_candidates = candidate_map.get("currency", [])
  currency_value = pick_currency(currency_candidates)
  if currency_value:
    selected["currency"] = currency_value
    reason_codes["currency"] = "heuristic_currency"

  total_candidates = candidate_map.get("totalAmountMinor", [])
  total_value = pick_total_amount(total_candidates, blocks, current, mode)
  if total_value is not None:
    selected["totalAmountMinor"] = total_value
    reason_codes["totalAmountMinor"] = "heuristic_total"

  return selected, reason_codes


def repair_vendor_name(
  parsed: dict[str, Any],
  candidate_map: dict[str, list[str]],
  blocks: list[dict[str, Any]]
) -> bool:
  current = parsed.get("vendorName")
  if isinstance(current, str) and current.strip() and not looks_like_address(current):
    return False

  candidates = candidate_map.get("vendorName", [])
  replacement = pick_vendor_name(candidates, blocks)
  if not replacement:
    return False

  if current == replacement:
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
  scored = []
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
  normalized = [entry.strip().upper() for entry in candidates]
  valid = [entry for entry in normalized if entry in VALID_CURRENCIES]
  if not valid:
    return None
  return valid[0]


def pick_total_amount(
  candidates: list[str],
  blocks: list[dict[str, Any]],
  current: dict[str, Any],
  mode: Literal["strict", "relaxed"]
) -> int | None:
  parsed_values = [
    int(entry.strip()) if re.fullmatch(r"\d+", entry.strip()) else parse_minor_units(entry) for entry in candidates
  ]
  values = [entry for entry in parsed_values if entry is not None and entry > 0]
  if not values:
    return None

  weighted = []
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
  letter_count = sum(1 for char in line if char.isalpha())
  return letter_count >= 3


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
