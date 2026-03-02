from __future__ import annotations

import json
from typing import Any
from urllib import error as url_error
from urllib import request as url_request

from ..boundary import LLMProvider
from ..settings import settings


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
      "modelLoaded": True,
      "modelLoading": False,
      "lastError": self.last_error,
      "provider": "prod_http"
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
          "vendorTemplateMatched": bool(payload.get("vendorTemplateMatched"))
        }
      }
    )
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
    if settings.remote_api_key:
      headers["Authorization"] = f"Bearer {settings.remote_api_key}"

    request = url_request.Request(
      url,
      data=json.dumps(body).encode("utf-8") if body is not None else None,
      headers=headers,
      method="POST" if body is not None else "GET"
    )

    try:
      with url_request.urlopen(request, timeout=max(1, int(settings.remote_timeout_ms / 1000))) as response:
        return json.loads(response.read().decode("utf-8"))
    except url_error.HTTPError as error:
      detail = error.read().decode("utf-8", errors="replace")
      raise RuntimeError(f"Remote SLM HTTP {error.code}: {detail[:400]}") from error
    except Exception as error:
      raise RuntimeError(f"Remote SLM request failed: {error}") from error


def ensure_path(value: str) -> str:
  return value if value.startswith("/") else f"/{value}"
