#!/usr/bin/env python3
import argparse
import base64
import json
import math
import pathlib
import statistics
import time
import urllib.request

DEFAULT_SAMPLES = [
  ("sample-invoices/benchmark/inbox/invoice2data__AmazonWebServices.pdf", "application/pdf"),
  ("sample-invoices/benchmark/inbox/invoice2data__AmazonWebServices.png", "image/png"),
  ("sample-invoices/benchmark/inbox/invoice_dataset_model_3__FACTU2015010038.jpg", "image/jpeg")
]


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


def parse_sample(entry: str) -> tuple[str, str]:
  parts = entry.split("|", 1)
  if len(parts) != 2:
    raise ValueError(f"Invalid sample '{entry}'. Expected '<path>|<mimeType>'.")
  return parts[0], parts[1]


def main() -> int:
  parser = argparse.ArgumentParser(description="Benchmark OCR endpoint latency")
  parser.add_argument("--label", required=True)
  parser.add_argument("--base-url", required=True, help="OCR base URL, e.g. http://127.0.0.1:8000/v1")
  parser.add_argument("--model", default="deepseek-ai/DeepSeek-OCR")
  parser.add_argument("--max-tokens", type=int, default=192)
  parser.add_argument("--timeout-seconds", type=int, default=1800)
  parser.add_argument(
    "--sample",
    action="append",
    default=[],
    help="Sample in format '<path>|<mimeType>'. Can be provided multiple times."
  )
  args = parser.parse_args()

  samples = [parse_sample(entry) for entry in args.sample] if args.sample else DEFAULT_SAMPLES
  endpoint = args.base_url.rstrip("/") + "/ocr/document"
  latencies: list[float] = []

  for path, mime_type in samples:
    data = pathlib.Path(path).read_bytes()
    payload = {
      "model": args.model,
      "document": f"data:{mime_type};base64," + base64.b64encode(data).decode("ascii"),
      "includeLayout": True,
      "maxTokens": args.max_tokens
    }
    started = time.perf_counter()
    response = post_json(endpoint, payload, args.timeout_seconds)
    latency_ms = (time.perf_counter() - started) * 1000.0
    latencies.append(latency_ms)

    print(
      json.dumps(
        {
          "kind": "ocr",
          "label": args.label,
          "file": pathlib.Path(path).name,
          "latencyMs": round(latency_ms, 1),
          "textLength": len(str(response.get("rawText", ""))),
          "blockCount": len(response.get("blocks") or []),
          "provider": response.get("provider"),
          "engineMode": response.get("engineMode")
        }
      )
    )

  print(
    json.dumps(
      {
        "kind": "ocr",
        "label": args.label,
        "samples": len(latencies),
        "avgMs": round(statistics.mean(latencies), 1),
        "p50Ms": round(percentile(latencies, 0.5), 1),
        "p95Ms": round(percentile(latencies, 0.95), 1)
      }
    )
  )
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
