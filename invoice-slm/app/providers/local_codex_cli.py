from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any

from ..boundary import LLMProvider
from ..logging import log_error, log_info
from ..settings import settings
from .local_mlx import parse_json_object, recover_payload_from_candidates, recover_payload_from_text, sanitize_payload_for_prompt


class LocalCodexCliLLMProvider(LLMProvider):
  def __init__(self) -> None:
    self.generation_lock = Lock()
    self.last_error = ""
    self.root_dir = Path(__file__).resolve().parents[3]

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
    if payload.get("llmAssist"):
      log_info("slm.llm_assist.local_codex_cli_text_only", note="Codex CLI provider runs text-only verification against OCR payload")

    with self.generation_lock:
      for strict in (False, True):
        prompt = build_codex_prompt(payload, strict=strict)
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


def build_codex_prompt(payload: dict[str, Any], strict: bool) -> str:
  hints = payload.get("hints") if isinstance(payload.get("hints"), dict) else {}
  prior_corrections = hints.get("priorCorrections")
  prior_corrections_text = ""
  if isinstance(prior_corrections, list) and prior_corrections:
    parts = []
    for entry in prior_corrections[:6]:
      if isinstance(entry, dict) and isinstance(entry.get("field"), str) and isinstance(entry.get("hint"), str):
        parts.append(f"{entry['field']}: {entry['hint']}")
    if parts:
      prior_corrections_text = "PRIOR_CORRECTIONS:\n- " + "\n- ".join(parts) + "\n"

  instruction = (
    "You are an OCR post-processing system.\n"
    "INPUT\n"
    "rawText\n"
    "blocks[]:\n"
    "text\n"
    "page\n"
    "blockIndex\n"
    "bboxNormalized [x1,y1,x2,y2]\n"
    "pageImages[] when present:\n"
    "page\n"
    "mimeType\n"
    "width\n"
    "height\n"
    "dpi\n"
    "dataUrl\n"
    "TASK\n"
    "Extract invoice data strictly from OCR evidence.\n"
    "Return JSON only.\n"
    "OUTPUT SCHEMA\n"
    "{\n"
    '  "file": "<filename>",\n'
    '  "lineItemCount": <int>,\n'
    '  "invoiceNumber": { "value": "<string>", "provenance": {...} },\n'
    '  "vendorNameContains": { "value": "<string>", "provenance": {...} },\n'
    '  "invoiceDate": { "value": "YYYY-MM-DD", "provenance": {...} },\n'
    '  "dueDate": { "value": "YYYY-MM-DD", "provenance": {...} },\n'
    '  "currency": { "value": "<ISO>", "provenance": {...} },\n'
    '  "totalAmountMinor": { "value": <int>, "provenance": {...} },\n'
    '  "lineItems": [\n'
    "    {\n"
    '      "description": "<string>",\n'
    '      "amountMinor": <int>,\n'
    '      "provenance": {...}\n'
    "    }\n"
    "  ],\n"
    '  "gst": {\n'
    '    "cgstMinor": { "value": <int>, "provenance": {...} },\n'
    '    "sgstMinor": { "value": <int>, "provenance": {...} },\n'
    '    "subtotalMinor": { "value": <int>, "provenance": {...} },\n'
    '    "totalTaxMinor": { "value": <int>, "provenance": {...} }\n'
    "  }\n"
    "}\n"
    "\n"
    "HARD RULES\n"
    "JSON only\n"
    "No nulls\n"
    "Omit uncertain fields\n"
    "Every value must have provenance\n"
    "Never guess or infer\n"
    "\n"
    "DECISION RULE\n"
    "Include a field only if it is clearly present in OCR, correctly labeled or structurally obvious, and has no conflicting values.\n"
    "Else omit it.\n"
    "\n"
    "NORMALIZATION\n"
    "Dates to YYYY-MM-DD\n"
    "Amounts to integer minor units\n"
    "Currency to ISO code using symbols such as ₹ to INR and $ to USD\n"
    "If no explicit currency symbol or code is present, default currency to INR\n"
    "\n"
    "PROVENANCE\n"
    "Use the value block only, not the label block\n"
    'Single block: { "page": int, "blockIndex": int, "bboxNormalized": [...] }\n'
    'Multi-block only if required: { "blockIndices": [...], "bboxNormalized": merged }\n'
    "\n"
    "FIELD RULES\n"
    "invoiceNumber must be labeled Invoice and must reject PO, Ref, and Order numbers\n"
    "vendorNameContains must be the top or header seller only and never Bill To\n"
    "invoiceDate and dueDate must be explicitly labeled with no derivation\n"
    "totalAmountMinor priority order:\n"
    "1. Total or Grand Total\n"
    "2. Final payable\n"
    "3. Total in words only if exact\n"
    "4. Fallback compute only if subtotal and all taxes exist and there is no conflicting total\n"
    "Reject balance due if different and reject paid amount\n"
    "\n"
    "GST RULES\n"
    "Only include GST when explicit\n"
    "cgstMinor and sgstMinor must be explicit\n"
    "subtotalMinor must be pre-tax\n"
    "totalTaxMinor may be explicit or cgst plus sgst only if both exist\n"
    "\n"
    "LINE ITEMS\n"
    "Include line items only if confident\n"
    "lineItemCount must equal the number of returned lineItems when lineItems are present\n"
    "If no confident line items are returned, set lineItemCount to 0\n"
    "Each item must have amountMinor and provenance\n"
    "Use the final row amount column\n"
    "Exclude unit price, tax columns, totals, subtotals, and duplicates\n"
    "One row equals one item\n"
    "\n"
    "TABLE PRIORITY\n"
    "Use Amount, Line Total, or Net columns\n"
    "Never use CGST or SGST columns or summary rows for line items\n"
    "\n"
    "OCR POLICY\n"
    "Minor formatting noise is allowed\n"
    "Digit guessing and conflict resolution are not allowed\n"
    "\n"
    "OUTPUT RULES\n"
    "No empty arrays or empty objects\n"
    "Omit missing sections entirely\n"
    "Prefer omission over wrong extraction\n"
    "\n"
    "EXTRACTION ORDER\n"
    "Header\n"
    "Totals\n"
    "GST\n"
    "Line items\n"
    "\n"
    "FINAL RULE\n"
    "If unsure, omit.\n"
    + ("Final check: output must be valid JSON and match the schema exactly.\n" if strict else "")
    + "\n"
    + (prior_corrections_text if prior_corrections_text else "")
    + "INPUT_JSON:\n"
  )

  prompt_payload = sanitize_payload_for_prompt(payload)
  return (
    f"{instruction}\nINPUT_JSON:{json.dumps(prompt_payload, ensure_ascii=True, separators=(',', ':'))}\nOUTPUT_JSON:"
  )
