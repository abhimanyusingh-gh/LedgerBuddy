#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from typing import Any


PASS_THRESHOLD = 90.0


def load_json(path: str) -> Any:
  with open(path, encoding="utf-8") as f:
    return json.load(f)


def find_result(results: list[dict[str, Any]], filename: str) -> dict[str, Any] | None:
  for entry in results:
    if entry.get("file") == filename:
      return entry
  return None


def get_parsed(result: dict[str, Any]) -> dict[str, Any]:
  return result.get("parsed") or {}


def normalize_date(value: Any) -> str | None:
  if not isinstance(value, str) or not value.strip():
    return None
  trimmed = value.strip()
  if len(trimmed) == 10 and trimmed[4] == "-" and trimmed[7] == "-":
    return trimmed
  return None


def check_invoice_number(expected: str, parsed: dict[str, Any]) -> bool:
  return parsed.get("invoiceNumber") == expected


def check_vendor_name_contains(expected: str, parsed: dict[str, Any]) -> bool:
  actual = parsed.get("vendorName") or ""
  return expected.lower() in actual.lower()


def check_invoice_date(expected: str, parsed: dict[str, Any]) -> bool:
  return normalize_date(parsed.get("invoiceDate")) == expected


def check_due_date(expected: str, parsed: dict[str, Any]) -> bool:
  return normalize_date(parsed.get("dueDate")) == expected


def check_currency(expected: str, parsed: dict[str, Any]) -> bool:
  return parsed.get("currency") == expected


def check_total_amount_minor(expected: int, parsed: dict[str, Any]) -> bool:
  return parsed.get("totalAmountMinor") == expected


def check_line_item_amounts_minor(expected: list[int], parsed: dict[str, Any]) -> bool:
  actual = sorted(
    item["amountMinor"]
    for item in (parsed.get("lineItems") or [])
    if isinstance(item, dict) and isinstance(item.get("amountMinor"), int)
  )
  return sorted(expected) == actual


def check_gst_field(subfield: str, expected: int, parsed: dict[str, Any]) -> bool:
  gst = parsed.get("gst")
  if not isinstance(gst, dict):
    return False
  return gst.get(subfield) == expected


GST_SUBFIELDS = ("subtotalMinor", "cgstMinor", "sgstMinor", "igstMinor", "cessMinor", "totalTaxMinor")


def evaluate_file(expected: dict[str, Any], result: dict[str, Any] | None) -> list[dict[str, Any]]:
  filename = expected["file"]
  checks: list[dict[str, Any]] = []

  if result is None:
    checks.append({"file": filename, "field": "file", "pass": False, "expected": "present", "actual": "missing"})
    return checks

  if result.get("error"):
    checks.append({"file": filename, "field": "pipelineError", "pass": False, "expected": None, "actual": result["error"]})
    return checks

  parsed = get_parsed(result)

  scalar_checks = [
    ("invoiceNumber", check_invoice_number),
    ("invoiceDate", check_invoice_date),
    ("dueDate", check_due_date),
    ("currency", check_currency),
    ("totalAmountMinor", check_total_amount_minor),
  ]

  for field, checker in scalar_checks:
    exp_val = expected.get(field)
    if exp_val is None:
      continue
    passed = checker(exp_val, parsed)
    actual_val = parsed.get(field)
    if field == "invoiceDate" or field == "dueDate":
      actual_val = normalize_date(actual_val)
    checks.append({"file": filename, "field": field, "pass": passed, "expected": exp_val, "actual": actual_val})

  if "vendorNameContains" in expected:
    exp_val = expected["vendorNameContains"]
    passed = check_vendor_name_contains(exp_val, parsed)
    checks.append({"file": filename, "field": "vendorNameContains", "pass": passed, "expected": exp_val, "actual": parsed.get("vendorName")})

  if "lineItemAmountsMinor" in expected:
    exp_val = expected["lineItemAmountsMinor"]
    passed = check_line_item_amounts_minor(exp_val, parsed)
    actual_val = sorted(
      item["amountMinor"]
      for item in (parsed.get("lineItems") or [])
      if isinstance(item, dict) and isinstance(item.get("amountMinor"), int)
    )
    checks.append({"file": filename, "field": "lineItemAmountsMinor", "pass": passed, "expected": sorted(exp_val), "actual": actual_val})

  if "gst" in expected and isinstance(expected["gst"], dict):
    for subfield in GST_SUBFIELDS:
      exp_val = expected["gst"].get(subfield)
      if exp_val is None:
        continue
      passed = check_gst_field(subfield, exp_val, parsed)
      gst = parsed.get("gst") or {}
      actual_val = gst.get(subfield) if isinstance(gst, dict) else None
      checks.append({"file": filename, "field": f"gst.{subfield}", "pass": passed, "expected": exp_val, "actual": actual_val})

  return checks


def format_table(checks: list[dict[str, Any]], per_file_summary: dict[str, dict[str, Any]]) -> str:
  col_file = max(len("File"), max((len(c["file"]) for c in checks), default=0))
  col_field = max(len("Field"), max((len(c["field"]) for c in checks), default=0))
  col_status = 6
  col_expected = max(len("Expected"), max((len(str(c["expected"])) for c in checks), default=0), 20)
  col_actual = max(len("Actual"), max((len(str(c["actual"])) for c in checks), default=0), 20)

  sep = f"+{'-' * (col_file + 2)}+{'-' * (col_field + 2)}+{'-' * (col_status + 2)}+{'-' * (col_expected + 2)}+{'-' * (col_actual + 2)}+"
  header = (
    f"| {'File':<{col_file}} | {'Field':<{col_field}} | {'Status':<{col_status}} | {'Expected':<{col_expected}} | {'Actual':<{col_actual}} |"
  )

  lines = [sep, header, sep]
  for check in checks:
    status = "PASS" if check["pass"] else "FAIL"
    line = (
      f"| {check['file']:<{col_file}} "
      f"| {check['field']:<{col_field}} "
      f"| {status:<{col_status}} "
      f"| {str(check['expected']):<{col_expected}} "
      f"| {str(check['actual']):<{col_actual}} |"
    )
    lines.append(line)
  lines.append(sep)

  lines.append("")
  lines.append("Per-file summary:")
  file_sep = f"+{'-' * (col_file + 2)}+{'-' * 10}+{'-' * 10}+{'-' * 12}+"
  file_header = f"| {'File':<{col_file}} | {'Pass':>8} | {'Fail':>8} | {'Accuracy':>10} |"
  lines.append(file_sep)
  lines.append(file_header)
  lines.append(file_sep)
  for filename, summary in sorted(per_file_summary.items()):
    pct = f"{summary['accuracy']:.1f}%"
    line = f"| {filename:<{col_file}} | {summary['pass']:>8} | {summary['fail']:>8} | {pct:>10} |"
    lines.append(line)
  lines.append(file_sep)

  return "\n".join(lines)


def compute_per_file_summary(checks: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
  summary: dict[str, dict[str, Any]] = {}
  for check in checks:
    filename = check["file"]
    if filename not in summary:
      summary[filename] = {"pass": 0, "fail": 0, "accuracy": 0.0}
    if check["pass"]:
      summary[filename]["pass"] += 1
    else:
      summary[filename]["fail"] += 1
  for filename, data in summary.items():
    total = data["pass"] + data["fail"]
    data["accuracy"] = (data["pass"] / total * 100.0) if total > 0 else 0.0
  return summary


def main() -> int:
  parser = argparse.ArgumentParser(description="Compute per-field accuracy from benchmark results against ground truth")
  parser.add_argument("--results", required=True, help="Path to benchmark results JSON (from runSampleInvoiceBenchmark.ts)")
  parser.add_argument("--ground-truth", required=True, help="Path to ground-truth.json")
  parser.add_argument("--output", default="", help="Write JSON report to this path")
  args = parser.parse_args()

  results_data = load_json(args.results)
  ground_truth_data = load_json(args.ground_truth)

  raw_results: list[dict[str, Any]] = results_data.get("results") or []
  expected_files: list[dict[str, Any]] = ground_truth_data.get("files") or []

  all_checks: list[dict[str, Any]] = []
  for expected in expected_files:
    result = find_result(raw_results, expected["file"])
    checks = evaluate_file(expected, result)
    all_checks.extend(checks)

  total = len(all_checks)
  passed = sum(1 for c in all_checks if c["pass"])
  failed = total - passed
  overall_accuracy = (passed / total * 100.0) if total > 0 else 0.0

  per_file_summary = compute_per_file_summary(all_checks)

  table = format_table(all_checks, per_file_summary)
  print(table)
  print()
  print(f"Overall: {passed}/{total} checks passed — {overall_accuracy:.1f}% accuracy")
  print(f"Pass threshold: {PASS_THRESHOLD:.1f}%")

  if args.output:
    report = {
      "overallAccuracy": round(overall_accuracy, 2),
      "totalChecks": total,
      "passed": passed,
      "failed": failed,
      "passThreshold": PASS_THRESHOLD,
      "perFile": per_file_summary,
      "checks": all_checks
    }
    with open(args.output, "w", encoding="utf-8") as f:
      json.dump(report, f, indent=2)
    print(f"Wrote JSON report to {args.output}")

  return 0 if overall_accuracy >= PASS_THRESHOLD else 1


if __name__ == "__main__":
  raise SystemExit(main())
