from __future__ import annotations

import os
import random
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

from ...boundary import LLMProvider
from ...logging import log_error, log_info
from ...settings import settings
from ..shared import build_extraction_prompt, parse_json_object, recover_payload_from_candidates, recover_payload_from_text

_KILL_GRACE_SECONDS = 5


def _kill_process_group(proc: subprocess.Popen[str]) -> None:
  pgid: int | None = None
  try:
    pgid = os.getpgid(proc.pid)
  except OSError:
    pass

  if pgid is not None and pgid != os.getpgid(os.getpid()):
    try:
      os.killpg(pgid, signal.SIGTERM)
    except OSError:
      pass
  else:
    try:
      proc.terminate()
    except OSError:
      pass

  try:
    proc.wait(timeout=_KILL_GRACE_SECONDS)
    return
  except subprocess.TimeoutExpired:
    pass

  if pgid is not None and pgid != os.getpgid(os.getpid()):
    try:
      os.killpg(pgid, signal.SIGKILL)
    except OSError:
      pass
  else:
    try:
      proc.kill()
    except OSError:
      pass

  try:
    proc.wait(timeout=3)
  except subprocess.TimeoutExpired:
    pass


class LocalClaudeCliLLMProvider(LLMProvider):
  FATAL_PATTERNS = ["credit balance", "billing", "payment required", "subscription"]

  def __init__(self) -> None:
    self.last_error = ""
    self.root_dir = Path(__file__).resolve().parents[4]
    self._preflight_passed = False

  def startup(self) -> None:
    log_info("slm.claude_cli.startup", action="preflight_check")
    try:
      result = self._exec_claude_subprocess("Respond with exactly: OK")
      if result and len(result) < 200:
        self._preflight_passed = True
        log_info("slm.claude_cli.startup.ok", response=result[:50])
      else:
        self.last_error = f"Unexpected preflight response length: {len(result)}"
        log_error("slm.claude_cli.startup.unexpected", error=self.last_error)
    except RuntimeError as e:
      self.last_error = str(e)
      if self._is_fatal_error(str(e)):
        log_error("slm.claude_cli.startup.fatal", error=str(e))
        raise RuntimeError(f"Claude CLI preflight failed (fatal): {e}") from e
      log_error("slm.claude_cli.startup.warn", error=str(e))

  def health(self) -> dict[str, Any]:
    payload: dict[str, Any] = {
      "status": "ok",
      "modelId": self._effective_model_id(),
      "modelLoaded": self._preflight_passed,
      "modelLoading": False,
      "lastError": self.last_error,
      "provider": "local_claude_cli"
    }
    try:
      subprocess.run(
        [settings.claude_command, "--version"],
        cwd=self._resolve_workdir(),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
        timeout=max(3, settings.claude_timeout_ms // 1000)
      )
    except Exception as error:
      payload["status"] = "error"
      payload["lastError"] = str(error)
      self.last_error = str(error)
    if not self._preflight_passed:
      payload["status"] = "degraded"
      if not payload["lastError"]:
        payload["lastError"] = "Preflight check did not pass"
    return payload

  def select_fields(self, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("extractionMode") == "bank-statement":
      return self._select_bank_statement(payload)

    if payload.get("llmAssist"):
      log_info("slm.llm_assist.local_claude_cli_text_only", note="Claude CLI provider runs text-only verification against OCR payload")

    for strict in (False, True):
      prompt = build_extraction_prompt(payload, strict=strict)
      try:
        output_text = self._run_claude(prompt)
      except Exception as error:
        self.last_error = str(error)
        log_error("slm.claude_cli.exec.failed", error=str(error))
        if self._is_fatal_error(str(error)):
          raise
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
    try:
      output_text = self._run_claude(prompt_text)
    except Exception as error:
      self.last_error = str(error)
      log_error("slm.claude_cli.call_prompt.failed", error=str(error))
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
    raise RuntimeError(f"Claude CLI call_prompt returned non-JSON output: {output_text[:200]}")

  def _select_bank_statement(self, payload: dict[str, Any]) -> dict[str, Any]:
    prompt = payload.get("bankStatementPrompt", "")
    if not prompt:
      return {"selected": {}, "issues": ["missing_bank_statement_prompt"]}

    try:
      output_text = self._run_claude(prompt)
    except Exception as error:
      self.last_error = str(error)
      log_error("slm.claude_cli.bank_statement.failed", error=str(error))
      if self._is_fatal_error(str(error)):
        raise
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

  def _run_claude(self, prompt: str) -> str:
    max_retries = settings.claude_max_retries
    base_delay_ms = settings.claude_retry_base_delay_ms
    last_error: Exception | None = None

    for attempt in range(max_retries + 1):
      try:
        return self._exec_claude_subprocess(prompt)
      except subprocess.TimeoutExpired as e:
        log_error("slm.claude_cli.timeout", attempt=attempt + 1, max_retries=max_retries, timeout_ms=settings.claude_timeout_ms, error="process killed after timeout")
        last_error = e
        if attempt >= max_retries:
          break
        delay = self._backoff_delay(attempt, base_delay_ms)
        log_info("slm.claude_cli.retry", attempt=attempt + 1, max_retries=max_retries, delay_ms=delay, reason="timeout")
        time.sleep(delay / 1000)
      except RuntimeError as e:
        error_msg = str(e)
        if self._is_fatal_error(error_msg):
          raise
        if self._is_retryable_error(error_msg):
          last_error = e
          if attempt >= max_retries:
            break
          delay = self._backoff_delay(attempt, base_delay_ms)
          log_info("slm.claude_cli.retry", attempt=attempt + 1, max_retries=max_retries, delay_ms=delay, reason=error_msg[:100])
          time.sleep(delay / 1000)
        else:
          raise

    raise RuntimeError(f"claude CLI failed after {max_retries + 1} attempts: {last_error}")

  def _exec_claude_subprocess(self, prompt: str) -> str:
    cmd = [
      settings.claude_command,
      "--print",
      "--output-format", "text",
      "--model", settings.claude_model or "sonnet",
    ]
    if settings.claude_max_budget_usd:
      cmd.extend(["--max-budget-usd", str(settings.claude_max_budget_usd)])
    cmd.extend(["-p", prompt])

    env = os.environ.copy()
    env.pop("ANTHROPIC_API_KEY", None)
    env.pop("CLAUDE_CONVERSATION_ID", None)
    env.pop("CLAUDE_SESSION_ID", None)
    env.pop("CLAUDE_HISTORY", None)

    timeout_seconds = max(10, settings.claude_timeout_ms // 1000)
    proc = subprocess.Popen(
      cmd,
      stdin=subprocess.DEVNULL,
      stdout=subprocess.PIPE,
      stderr=subprocess.PIPE,
      text=True,
      env=env,
      cwd=self._resolve_workdir(),
      start_new_session=True,
    )
    try:
      stdout, stderr = proc.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
      _kill_process_group(proc)
      raise
    except BaseException:
      _kill_process_group(proc)
      raise

    if proc.returncode != 0:
      raise RuntimeError(f"claude exited {proc.returncode}: {stderr.strip()}")
    return stdout.strip()

  @staticmethod
  def _backoff_delay(attempt: int, base_delay_ms: int) -> int:
    delay = base_delay_ms * (2 ** attempt)
    jitter = int(delay * random.random() * 0.25)
    return min(delay + jitter, 30_000)

  @classmethod
  def _is_fatal_error(cls, error_msg: str) -> bool:
    lower = error_msg.lower()
    return any(p in lower for p in cls.FATAL_PATTERNS)

  @staticmethod
  def _is_retryable_error(error_msg: str) -> bool:
    retryable_patterns = [
      "connection", "timeout", "timed out",
      "network", "ECONNREFUSED", "ECONNRESET",
      "overloaded", "rate limit", "429", "503", "502",
      "internal server error", "500",
      "socket hang up"
    ]
    lower = error_msg.lower()
    return any(p in lower for p in retryable_patterns)

  def _resolve_workdir(self) -> Path:
    configured = settings.claude_workdir.strip()
    return Path(configured).expanduser() if configured else self.root_dir

  def _effective_model_id(self) -> str:
    configured = settings.claude_model.strip()
    if configured:
      return configured
    return "claude-cli/sonnet"
