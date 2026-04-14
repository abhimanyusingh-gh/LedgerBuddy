from __future__ import annotations

import json
from typing import Any
from urllib import error as url_error
from urllib import request as url_request

from ...boundary import LLMProvider
from ...settings import settings


class ProdHttpLLMProvider(LLMProvider):
  def __init__(self) -> None:
    self.last_error = ""
    self.base_url = settings.remote_base_url.rstrip("/")
    self.select_path = ensure_path(settings.remote_select_path)

  def startup(self) -> None:
    if settings.validate_remote_on_startup:
      self._request_json("/health")

  def health(self) -> dict[str, Any]:
    payload: dict[str, Any] = {
      "status": "ok",
      "modelId": settings.model_id,
      "modelLoaded": False,
      "modelLoading": False,
      "lastError": self.last_error,
      "provider": "prod_http"
    }
    try:
      remote = self._request_json("/health", probe=True)
      if isinstance(remote, dict):
        payload["remote"] = remote
        remote_loaded = remote.get("modelLoaded", False)
        payload["modelLoaded"] = remote_loaded is True
        if not remote_loaded:
          payload["status"] = "loading"
          payload["modelLoading"] = True
    except Exception as error:
      payload["status"] = "error"
      payload["lastError"] = str(error)
      self.last_error = str(error)
    return payload

  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    response = self._request_json(
      self.select_path,
      {
        "parsed": payload.get("parsed", {}),
        "ocrText": payload.get("ocrText", ""),
        "ocrBlocks": payload.get("ocrBlocks", []),
        "mode": payload.get("mode", "strict"),
        "hints": {
          "fieldCandidates": payload.get("fieldCandidates", {}),
          "fieldRegions": payload.get("fieldRegions", {}),
          "documentContext": payload.get("documentContext"),
          "vendorNameHint": payload.get("vendorNameHint"),
          "vendorTemplateMatched": bool(payload.get("vendorTemplateMatched")),
          "pageImages": payload.get("pageImages"),
          "llmAssist": bool(payload.get("llmAssist")),
          "languageHint": payload.get("languageHint"),
          "documentLanguage": payload.get("documentLanguage"),
          "priorCorrections": payload.get("priorCorrections"),
          "extractionMode": payload.get("extractionMode"),
          "bankStatementPrompt": payload.get("bankStatementPrompt")
        }
      }
    )
    if not isinstance(response, dict):
      raise RuntimeError("Remote SLM returned invalid payload.")

    invoice_type = response.get("invoiceType") if isinstance(response.get("invoiceType"), str) else "other"
    remote_usage = response.get("usage")

    selected = response.get("selected")
    if isinstance(selected, dict):
      result: dict[str, Any] = {
        "selected": selected,
        "reasonCodes": response.get("reasonCodes") if isinstance(response.get("reasonCodes"), dict) else {},
        "issues": response.get("issues") if isinstance(response.get("issues"), list) else [],
        "invoiceType": invoice_type
      }
      if isinstance(remote_usage, dict):
        result["_usage"] = remote_usage
      return result

    parsed = response.get("parsed")
    if isinstance(parsed, dict):
      result: dict[str, Any] = {
        "selected": parsed,
        "reasonCodes": response.get("reasonCodes") if isinstance(response.get("reasonCodes"), dict) else {},
        "issues": response.get("issues") if isinstance(response.get("issues"), list) else [],
        "invoiceType": invoice_type
      }
      if isinstance(remote_usage, dict):
        result["_usage"] = remote_usage
      return result

    raise RuntimeError("Remote SLM payload does not contain selected/parsed output.")

  def call_prompt(self, prompt_text: str) -> dict[str, Any]:
    raise NotImplementedError("ProdHttpLLMProvider delegates pipeline to the remote SLM; use select_fields instead.")

  def _request_json(self, path: str, body: dict[str, Any] | None = None, probe: bool = False) -> Any:
    url = f"{self.base_url}{ensure_path(path)}"
    headers = {"Content-Type": "application/json"}
    if settings.remote_api_key:
      headers["Authorization"] = f"Bearer {settings.remote_api_key}"

    request = url_request.Request(
      url,
      data=json.dumps(body).encode("utf-8") if body is not None else None,
      headers=headers,
      method="POST" if body is not None else "GET"
    )

    timeout_s = settings.probe_timeout_ms // 1000 if probe else max(1, int(settings.remote_timeout_ms / 1000))
    try:
      with url_request.urlopen(request, timeout=max(1, timeout_s)) as response:
        return json.loads(response.read().decode("utf-8"))
    except url_error.HTTPError as error:
      detail = error.read().decode("utf-8", errors="replace")
      raise RuntimeError(f"Remote SLM HTTP {error.code}: {detail[:400]}") from error
    except Exception as error:
      raise RuntimeError(f"Remote SLM request failed: {error}") from error


def ensure_path(value: str) -> str:
  return value if value.startswith("/") else f"/{value}"
