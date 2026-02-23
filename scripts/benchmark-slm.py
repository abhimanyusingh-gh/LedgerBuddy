#!/usr/bin/env python3
import argparse
import json
import math
import statistics
import time
import urllib.request

DEFAULT_PAYLOAD = {
  "parsed": {"vendorName": "Warehouse Address: 42 Main St"},
  "ocrText": "Invoice Number: INV-001\nVendor: ACME Corp\nCurrency: USD\nGrand Total: 123.45",
  "ocrBlocks": [
    {"text": "Invoice Number: INV-001", "page": 1, "bboxNormalized": [0.1, 0.1, 0.4, 0.15]},
    {"text": "Vendor: ACME Corp", "page": 1, "bboxNormalized": [0.1, 0.16, 0.4, 0.2]},
    {"text": "Grand Total: 123.45", "page": 1, "bboxNormalized": [0.6, 0.8, 0.9, 0.85]}
  ],
  "mode": "relaxed",
  "hints": {
    "fieldCandidates": {
      "invoiceNumber": ["INV-001"],
      "vendorName": ["ACME Corp"],
      "currency": ["USD"],
      "totalAmountMinor": ["12345"]
    }
  }
}


def percentile(values: list[float], pct: float) -> float:
  if len(values) == 0:
    return 0.0
  ordered = sorted(values)
  index = (len(ordered) - 1) * pct
  lower = math.floor(index)
  upper = math.ceil(index)
  if lower == upper:
    return ordered[int(index)]
  ratio = index - lower
  return ordered[lower] + (ordered[upper] - ordered[lower]) * ratio


def post_json(url: str, payload: dict, timeout_seconds: int) -> dict:
  request = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST"
  )
  with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
    return json.loads(response.read().decode("utf-8"))


def main() -> int:
  parser = argparse.ArgumentParser(description="Benchmark SLM verifier endpoint latency")
  parser.add_argument("--label", required=True)
  parser.add_argument("--base-url", required=True, help="SLM base URL, e.g. http://127.0.0.1:8100/v1")
  parser.add_argument("--runs", type=int, default=3)
  parser.add_argument("--timeout-seconds", type=int, default=1200)
  args = parser.parse_args()

  endpoint = args.base_url.rstrip("/") + "/verify/invoice"
  latencies: list[float] = []

  for run in range(1, args.runs + 1):
    started = time.perf_counter()
    response = post_json(endpoint, DEFAULT_PAYLOAD, args.timeout_seconds)
    latency_ms = (time.perf_counter() - started) * 1000.0
    latencies.append(latency_ms)

    print(
      json.dumps(
        {
          "kind": "slm",
          "label": args.label,
          "run": run,
          "latencyMs": round(latency_ms, 1),
          "changedFields": len(response.get("changedFields") or []),
          "issues": len(response.get("issues") or [])
        }
      )
    )

  print(
    json.dumps(
      {
        "kind": "slm",
        "label": args.label,
        "runs": len(latencies),
        "avgMs": round(statistics.mean(latencies), 1),
        "p50Ms": round(percentile(latencies, 0.5), 1),
        "p95Ms": round(percentile(latencies, 0.95), 1)
      }
    )
  )
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
