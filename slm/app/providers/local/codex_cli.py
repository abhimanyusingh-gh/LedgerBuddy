from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any

from ...boundary import LLMProvider
from ...logging import log_error, log_info
from ...settings import settings
from ..shared import build_extraction_prompt, parse_json_object, recover_payload_from_candidates, recover_payload_from_text


class LocalCodexCliLLMProvider(LLMProvider):
  def __init__(self) -> None:
    self.generation_lock = Lock()
    self.last_error = ""
    self.root_dir = Path(__file__).resolve().parents[4]

  def startup(self) -> None:
    # No preload needed. Health probes validate the CLI on demand.
    return

  def health(self) -> dict[str, Any]:
    payload: dict[str, Any] = {
      "status": "ok",
      "modelId": self._effective_model_id(),
      "modelLoaded": True,
      "modelLoading": False,
      "lastError": self.last_error,
      "provider": "local_codex_cli"
    }
    try:
      subprocess.run(
        [settings.codex_command, "--version"],
        cwd=self._resolve_workdir(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
        timeout=max(3, settings.codex_timeout_ms // 1000)
      )
    except Exception as error:
      payload["status"] = "error"
      payload["lastError"] = str(error)
      self.last_error = str(error)
    return payload

  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("extractionMode") == "bank-statement":
      return self._select_bank_statement(payload)

    if payload.get("llmAssist"):
      log_info("slm.llm_assist.local_codex_cli_text_only", note="Codex CLI provider runs text-only verification against OCR payload")

    with self.generation_lock:
      for strict in (False, True):
        prompt = build_extraction_prompt(payload, strict=strict)
        try:
          output_text = self._run_codex(prompt)
        except Exception as error:
          self.last_error = str(error)
          log_error("slm.codex_cli.exec.failed", error=str(error))
          break

        usage = {"promptTokens": None, "completionTokens": None}
        log_info(
          "slm.raw_output",
          output_length=len(output_text),
          completion_tokens=0,
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
    with self.generation_lock:
      try:
        output_text = self._run_codex(prompt_text)
      except Exception as error:
        self.last_error = str(error)
        log_error("slm.codex_cli.call_prompt.failed", error=str(error))
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
    raise RuntimeError(f"Codex CLI call_prompt returned non-JSON output: {output_text[:200]}")

  def _select_bank_statement(self, payload: dict[str, Any]) -> dict[str, Any]:
    prompt = payload.get("bankStatementPrompt", "")
    if not prompt:
      return {"selected": {}, "issues": ["missing_bank_statement_prompt"]}

    with self.generation_lock:
      try:
        output_text = self._run_codex(prompt)
      except Exception as error:
        self.last_error = str(error)
        log_error("slm.codex_cli.bank_statement.failed", error=str(error))
        return {"selected": {}, "issues": ["slm_bank_statement_error"]}

    log_info(
      "slm.bank_statement.raw_output",
      output_length=len(output_text),
      first_200=output_text[:200],
      last_200=output_text[-200:] if len(output_text) > 200 else ""
    )

    parsed = parse_json_object(output_text)
    if parsed is not None:
      parsed["_usage"] = {"promptTokens": None, "completionTokens": None}
      parsed["_bankStatementRaw"] = True
      return parsed

    return {"selected": {}, "issues": ["slm_bank_statement_invalid_json"], "rawText": output_text}

  def _run_codex(self, prompt: str) -> str:
    with tempfile.NamedTemporaryFile("w+", encoding="utf-8", delete=True) as output_file:
      command = [
        settings.codex_command,
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--output-last-message",
        output_file.name,
        "-C",
        str(self._resolve_workdir())
      ]
      if settings.codex_model:
        command.extend(["--model", settings.codex_model])
      command.append("-")

      completed = subprocess.run(
        command,
        input=prompt,
        text=True,
        capture_output=True,
        cwd=self._resolve_workdir(),
        timeout=max(30, settings.codex_timeout_ms // 1000),
        check=False
      )
      stdout = completed.stdout or ""
      stderr = completed.stderr or ""
      if completed.returncode != 0:
        detail = stderr.strip() or stdout.strip() or f"exit code {completed.returncode}"
        if len(detail) > 1600:
          detail = f"{detail[:800]}\n...\n{detail[-800:]}"
        raise RuntimeError(f"Codex CLI failed: {detail}")

      output_file.seek(0)
      text = output_file.read().strip()
      if text:
        return text
      return stdout.strip()

  def _resolve_workdir(self) -> Path:
    configured = settings.codex_workdir.strip()
    return Path(configured).expanduser() if configured else self.root_dir

  def _effective_model_id(self) -> str:
    configured = settings.codex_model.strip()
    if configured:
      return configured
    return "codex-cli/default"


build_codex_prompt = build_extraction_prompt
