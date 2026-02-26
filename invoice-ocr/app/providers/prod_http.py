from __future__ import annotations

import base64
import json
import time
from typing import Any
from urllib import error as url_error
from urllib import request as url_request

from ..boundary import OCRProvider
from ..engine import normalize_blocks, normalize_remote_confidence, normalize_text
from ..settings import settings


class ProdHttpOCRProvider(OCRProvider):
  def __init__(self) -> None:
    self.last_error = ""
    self.base_url = settings.remote_base_url.rstrip("/")

  def startup(self) -> None:
    if settings.validate_remote_on_startup:
      self._validate_remote()

  def health(self) -> dict[str, Any]:
    payload: dict[str, Any] = {
      "status": "ok",
      "modelId": settings.model_id,
      "modelLoaded": True,
      "modelLoading": False,
      "mode": "prod_http",
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

  def list_models(self) -> list[dict[str, Any]]:
    try:
      payload = self._request_json("/models")
      if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        data = [
          entry
          for entry in payload["data"]
          if isinstance(entry, dict) and isinstance(entry.get("id"), str) and entry.get("id", "").strip()
        ]
        if data:
          return data
    except Exception as error:
      self.last_error = str(error)

    return [{"id": settings.model_id, "object": "model", "created": int(time.time()), "owned_by": "remote"}]

  def extract_document(
    self,
    image_bytes: bytes,
    mime_type: str,
    prompt: str,
    include_layout: bool,
    max_tokens: int
  ) -> dict[str, Any]:
    payload = self._request_json(
      "/ocr/document",
      {
        "model": settings.model_id,
        "document": f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}",
        "includeLayout": include_layout,
        "prompt": prompt,
        "maxTokens": max_tokens
      }
    )
    if not isinstance(payload, dict):
      raise RuntimeError("Remote OCR returned invalid payload.")

    return {
      "rawText": normalize_text(payload.get("rawText")) or normalize_text(payload.get("raw_text")) or "",
      "blocks": normalize_blocks(payload.get("blocks")),
      "confidence": normalize_remote_confidence(payload.get("confidence")),
      "mode": "prod_http",
      "provider": normalize_text(payload.get("provider")) or "prod_http",
      "model": normalize_text(payload.get("model")) or settings.model_id
    }

  def _validate_remote(self) -> None:
    configured = normalize_model_id(settings.model_id)
    available = {normalize_model_id(str(entry.get("id", ""))) for entry in self.list_models()}
    if available and configured not in available:
      raise RuntimeError(
        f"Configured model '{settings.model_id}' is not listed by remote OCR. Available: {sorted(available)}"
      )

  def _request_json(self, path: str, body: dict[str, Any] | None = None) -> Any:
    url = f"{self.base_url}{path}"
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
      raise RuntimeError(f"Remote OCR HTTP {error.code}: {detail[:400]}") from error
    except Exception as error:
      raise RuntimeError(f"Remote OCR request failed: {error}") from error


def normalize_model_id(value: str) -> str:
  normalized = value.strip().lower()
  return normalized[:-7] if normalized.endswith(":latest") else normalized
