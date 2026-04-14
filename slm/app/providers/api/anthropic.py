from __future__ import annotations

import os
from typing import Any

import anthropic

from ...boundary import LLMProvider
from ...logging import log_error, log_info
from ..shared import build_extraction_prompt, parse_json_object, recover_payload_from_candidates, recover_payload_from_text


def _make_client() -> anthropic.Anthropic:
  api_key = os.environ.get("ANTHROPIC_API_KEY", "")
  timeout_ms = int(os.environ.get("ANTHROPIC_API_TIMEOUT_MS", "300000"))
  timeout_seconds = max(10, timeout_ms // 1000)
  return anthropic.Anthropic(api_key=api_key, timeout=float(timeout_seconds))


def _model_id() -> str:
  return os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6"


class AnthropicApiLLMProvider(LLMProvider):
  def __init__(self) -> None:
    self.last_error = ""
    self._ready = False

  def startup(self) -> None:
    log_info("slm.anthropic_api.startup", action="preflight_check")
    try:
      client = _make_client()
      response = client.messages.create(
        model=_model_id(),
        max_tokens=16,
        messages=[{"role": "user", "content": "Respond with exactly: OK"}]
      )
      text = response.content[0].text.strip()
      if text and len(text) < 200:
        self._ready = True
        log_info("slm.anthropic_api.startup.ok", response=text[:50])
      else:
        self.last_error = f"Unexpected preflight response: {text[:100]}"
        log_error("slm.anthropic_api.startup.unexpected", error=self.last_error)
    except Exception as e:
      self.last_error = str(e)
      log_error("slm.anthropic_api.startup.warn", error=str(e))

  def health(self) -> dict[str, Any]:
    payload: dict[str, Any] = {
      "status": "ok" if self._ready else "degraded",
      "modelId": _model_id(),
      "modelLoaded": self._ready,
      "modelLoading": False,
      "lastError": self.last_error,
      "provider": "anthropic_api"
    }
    if not self._ready and not payload["lastError"]:
      payload["lastError"] = "Preflight check did not pass"
    return payload

  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("extractionMode") == "bank-statement":
      return self._select_bank_statement(payload)

    if payload.get("llmAssist"):
      log_info("slm.llm_assist.anthropic_api_text_only", note="Anthropic API provider runs text-only verification against OCR payload")

    for strict in (False, True):
      prompt = build_extraction_prompt(payload, strict=strict)
      try:
        output_text, input_tokens, output_tokens = self._call_api(prompt)
      except Exception as error:
        self.last_error = str(error)
        log_error("slm.extract.failed", error=str(error))
        break

      usage = {"promptTokens": input_tokens, "completionTokens": output_tokens}
      log_info(
        "slm.raw_output",
        output_length=len(output_text),
        completion_tokens=output_tokens,
        first_200=output_text[:200],
        last_200=output_text[-200:] if len(output_text) > 200 else ""
      )
      parsed = parse_json_object(output_text)
      if parsed is not None:
        parsed["_usage"] = usage
        return parsed
      recovered = recover_payload_from_text(output_text, payload)
      if recovered is not None:
        recovered["_usage"] = usage
        return recovered

    fallback = recover_payload_from_candidates(payload)
    if fallback is not None:
      return fallback

    return {
      "selected": {},
      "reasonCodes": {},
      "issues": ["slm_output_invalid_json"]
    }

  def call_prompt(self, prompt_text: str) -> dict[str, Any]:
    try:
      output_text, _input_tokens, _output_tokens = self._call_api(prompt_text)
    except Exception as error:
      self.last_error = str(error)
      log_error("slm.anthropic_api.call_prompt.failed", error=str(error))
      raise

    log_info(
      "slm.call_prompt.raw_output",
      output_length=len(output_text),
      first_200=output_text[:200],
      last_200=output_text[-200:] if len(output_text) > 200 else ""
    )
    parsed = parse_json_object(output_text)
    if parsed is not None:
      return parsed
    raise RuntimeError(f"Anthropic API call_prompt returned non-JSON output: {output_text[:200]}")

  def _select_bank_statement(self, payload: dict[str, Any]) -> dict[str, Any]:
    prompt = payload.get("bankStatementPrompt", "")
    if not prompt:
      return {"selected": {}, "issues": ["missing_bank_statement_prompt"]}

    try:
      output_text, input_tokens, output_tokens = self._call_api(prompt)
    except Exception as error:
      self.last_error = str(error)
      log_error("slm.anthropic_api.bank_statement.failed", error=str(error))
      return {"selected": {}, "issues": ["slm_bank_statement_error"]}

    log_info(
      "slm.bank_statement.raw_output",
      output_length=len(output_text),
      first_200=output_text[:200],
      last_200=output_text[-200:] if len(output_text) > 200 else ""
    )

    parsed = parse_json_object(output_text)
    if parsed is not None:
      parsed["_usage"] = {"promptTokens": input_tokens, "completionTokens": output_tokens}
      parsed["_bankStatementRaw"] = True
      return parsed

    return {"selected": {}, "issues": ["slm_bank_statement_invalid_json"], "rawText": output_text}

  def _call_api(self, prompt: str) -> tuple[str, int, int]:
    client = _make_client()
    model = _model_id()
    log_info("slm.extract.start", provider="anthropic_api", model=model)
    try:
      response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
      )
    except Exception as error:
      log_error("slm.extract.failed", provider="anthropic_api", model=model, error=str(error))
      raise
    text = response.content[0].text
    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens
    log_info(
      "slm.extract.end",
      provider="anthropic_api",
      model=model,
      input_tokens=input_tokens,
      output_tokens=output_tokens
    )
    return text, input_tokens, output_tokens
