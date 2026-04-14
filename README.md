<div align="center">

# BillForge

**Verify invoices in seconds, not minutes. Every extracted field shows you exactly where in the document it came from.**

[![Node.js](https://img.shields.io/badge/Node.js-20-339933.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB.svg?logo=python&logoColor=white)](https://www.python.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248.svg?logo=mongodb&logoColor=white)](https://www.mongodb.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## Why BillForge

AP clerks processing 150+ invoices daily spend most of their time hunting — scrolling through PDFs to find a vendor name, cross-referencing totals buried on page three. BillForge eliminates the search: for every extracted field, the reviewer sees the value alongside a **cropped image of exactly where in the document it was found**. Verification drops from minutes to seconds.

Four things make BillForge different:

1. **Source-verified review** — Every extracted field is paired with its source crop and bounding box overlay. The reviewer doesn't search the document; the evidence is brought to them.
2. **Accuracy that compounds** — Every correction is recorded per vendor and invoice type. The next invoice from that vendor extracts better. BillForge gets more accurate the longer you use it.
3. **India-first Tally export** — Native XML with full GST breakdown (CGST/SGST/IGST/Cess), ready to import with no manual mapping. Built on an adapter pattern — Tally is the first connector, not the last.
4. **Fully pluggable OCR + extraction** — Mix and match any OCR engine with any extraction model to fit your cost, privacy, and accuracy requirements. Run entirely offline with local Apple Vision + MLX, accelerate with a cloud LLM API, or go fully managed with LlamaParse + LlamaExtract — all without touching application code.

## How It Works

```
Gmail / S3 / Folder
       │
       ▼
   OCR Engine  ──────────────────────────────────────────────────────┐
  (local or cloud)                                                    │
       │                                                              │
       ├─ LlamaExtract path ──► structured fields + bounding boxes   │
       │  (LlamaParse + LlamaExtract)                                 │
       │                                                              │
       └─ SLM path ──► OCR blocks + page images → structured fields  │
          (local MLX / Claude CLI / Anthropic API)                    │
                                                                      │
                    Confidence scoring & deterministic validation ◄───┘
                                      │
                     Source-verified review (field + crop + bbox)
                                      │
                           Approval workflow
                                      │
                          Tally XML export (GST-ready)
                                      │
                  Corrections → learning store → better next time
```

Every external dependency — OCR engine, extraction model, storage, email, accounting export — is behind an interface. Swapping Gmail for Outlook, LlamaParse for Apple Vision, or Tally for QuickBooks, is an adapter change — not a rewrite.

> Full architecture diagram: [`docs/architecture.drawio`](docs/architecture.drawio)

## Local Development Scripts

### Bringing Up the Stack

BillForge supports a wide range of OCR and extraction engine combinations. Choose based on your cost, privacy, and accuracy requirements:

**Fully local (no cloud keys required)**

| Script | OCR | Extraction |
|--------|-----|------------|
| `yarn docker:up` | Apple Vision | default SLM |
| `yarn docker:up:mlx` | Apple Vision | MLX (local, single-step) |
| `yarn docker:up:mlx:multi` | Apple Vision | MLX (local, multi-step) |
| `yarn docker:up:claude` | Apple Vision | Claude CLI (local, multi-step) |
| `yarn docker:up:claude:single` | Apple Vision | Claude CLI (local, single-step) |
| `yarn docker:up:codex` | Apple Vision | Codex CLI |

**Local OCR + cloud extraction**

| Script | OCR | Extraction |
|--------|-----|------------|
| `yarn docker:up:api` | Apple Vision | Anthropic API |
| `yarn docker:up:apple_vision:claude` | Apple Vision | Claude CLI multi-step |
| `yarn docker:up:apple_vision:claude:single` | Apple Vision | Claude CLI single-step |
| `yarn docker:up:apple_vision:api` | Apple Vision | Anthropic API |

**LlamaParse OCR + cloud/local extraction**

| Script | OCR | Extraction |
|--------|-----|------------|
| `yarn docker:up:llamaparse` | LlamaParse | Claude CLI multi-step |
| `yarn docker:up:llamaparse:claude` | LlamaParse | Claude CLI multi-step |
| `yarn docker:up:llamaparse:claude:single` | LlamaParse | Claude CLI single-step |
| `yarn docker:up:llamaparse:api` | LlamaParse | Anthropic API |

**Fully managed cloud (LlamaParse + LlamaExtract)**

| Script | OCR | Extraction |
|--------|-----|------------|
| `yarn docker:up:llamaextract` | LlamaParse | LlamaExtract (agentic, no SLM) |
| `yarn docker:up:llamaextract:slm` | LlamaParse | LlamaExtract + Claude CLI fallback |

> All scripts require `LLAMA_CLOUD_API_KEY` in your `.env` when using LlamaParse or LlamaExtract.

### Restarting Just the SLM

Use these when you want to swap SLM engine without rebuilding the full stack:

| Script | SLM Engine |
|--------|-----------|
| `yarn slm:claude` | claude multi-step |
| `yarn slm:claude:single` | claude single-step |
| `yarn slm:mlx` | MLX single-step |
| `yarn slm:mlx:multi` | MLX multi-step |
| `yarn slm:codex` | Codex CLI |

### Benchmarking

| Script | Description |
|--------|-------------|
| `yarn benchmark:deepseek` | Accuracy benchmark with local DeepSeek OCR + SLM |
| `yarn benchmark:llamaparse` | Accuracy benchmark with LlamaParse OCR + SLM |
| `yarn benchmark:llamaextract` | Accuracy benchmark with LlamaParse OCR + LlamaExtract (agentic) |
| `yarn benchmark:llamaparse:dump` | Dump raw extraction results without comparing to ground truth |
| `yarn benchmark:llamaparse:generate-spec` | Generate a `ground-truth.json` template from extraction results |

Benchmark results are written to `.local-run/benchmark/latest-results.json`. Generated specs go to `.local-run/benchmark/generated-spec.json`.

## Quick Start

**Prerequisites:** Node.js 20+, Yarn 4+, Docker, Python 3.11+ (Apple Silicon for local MLX)

```bash
git clone <repo-url> && cd billforge
yarn install

# Optional: local ML services (mock OCR works without this)
python3 -m venv .venv-ml
./.venv-ml/bin/pip install -r ocr/requirements.local.txt \
                           -r slm/requirements.local.txt

# Start everything
yarn docker:up
```

Open `http://localhost:5177` and log in as `tenant-admin-1@local.test` / `DemoPass!1`.

The stack starts MongoDB, Keycloak, MinIO, OCR, SLM, backend, and frontend with seeded demo tenants and sample invoices. Click "Ingest" to process invoices through the full pipeline.

| Service | URL |
|---------|-----|
| Dashboard | `http://localhost:5177` |
| Backend API | `http://localhost:4100` |
| Keycloak | `http://localhost:8280` |
| MinIO Console | `http://localhost:9101` |

## Extraction Pipeline

BillForge supports two extraction paths — the active path is determined by which docker script you start with:

**Path A — LlamaExtract (fully managed cloud)**

| Stage | What Happens | Cost |
|-------|-------------|------|
| LlamaParse OCR | Cloud OCR + structured page items + page screenshots | Per-page credits |
| LlamaExtract | Schema-driven structured field extraction with bounding boxes and confidence scores | Per-page credits |
| Deterministic Validation | Date/amount/currency consistency checks | Free |
| Learning Store | Record and apply corrections for future extractions | Free |

**Path B — SLM (local or cloud model)**

| Stage | What Happens | Cost |
|-------|-------------|------|
| Vendor Fingerprint | Match known vendor layout patterns | Free |
| OCR | Text + bounding box extraction (Apple Vision, DeepSeek MLX, or LlamaParse) | Low |
| SLM-Direct Extraction | OCR blocks + page images → structured fields | Medium |
| Deterministic Validation | Date/amount/currency consistency checks | Free |
| LLM Vision Re-extraction | Page image analysis when confidence < 85% | High |
| Learning Store | Record and apply corrections for future extractions | Free |

## Configuration

BillForge uses a runtime manifest for environment-specific wiring. The same Docker image serves local, staging, and production — only the manifest differs.

| Boundary | Options |
|----------|---------|
| Ingestion | Gmail, S3 Upload, Folder watch |
| OCR | Apple Vision (local), DeepSeek MLX (local), LlamaParse (cloud) |
| Extraction | Local MLX, Claude CLI, Anthropic API, LlamaExtract (cloud, agentic) |
| Export | Tally XML (CGST/SGST/IGST/Cess) |
| Storage | AWS S3 / MinIO |
| Email | SendGrid, SMTP, Gmail OAuth |

## Deployment

**Local:** `yarn docker:up` — single command, includes demo data and seeded tenants.

**AWS:**

```bash
ENV=stg AWS_REGION=us-east-1 bash ./scripts/deploy-aws.sh
```

Terraform modules: EC2 Spot workers, DocumentDB, S3, ECS Keycloak, IAM/STS roles. See [AWS Deployment Guide](docs/AWS_DEPLOYMENT_GUIDE.md).

## Tech Stack

**Backend:** Node.js 20, TypeScript (strict), Express, Mongoose, Zod, Sharp, AWS SDK v3
**Frontend:** React 18, TypeScript (strict), Vite 6, Recharts
**ML Services:** Python 3.11, FastAPI, MLX (dev only), DeepSeek OCR
**Infrastructure:** Docker Compose, MongoDB 7, Keycloak 26, MinIO, Terraform

## Testing

```bash
yarn test                                    # All unit tests
yarn workspace billforge-backend coverage    # Coverage with threshold enforcement
yarn run knip                                # Dead code analysis
yarn e2e:local                               # Backend E2E (requires running stack)
```

100% branch coverage enforced on tracked modules (export, confidence, currency). CI: typecheck → test → knip → Docker build → Trivy scan.

## Documentation

| Document | What It Covers |
|----------|---------------|
| [Product Requirements (PRD)](docs/PRD.md) | Customer outcomes, user flows, feature requirements, success metrics |
| [Architecture Decisions (RFC)](docs/RFC.md) | Why each technical decision was made and what would change it |
| [AWS Deployment Guide](docs/AWS_DEPLOYMENT_GUIDE.md) | Terraform provisioning, ECR push, deploy script |
| [Local OCR Setup](docs/LOCAL_DEEPSEEK_OCR_SETUP.md) | Apple Silicon MLX services, port mapping, health checks |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues, health checks, log access |

## Contributing

1. Read the [Architecture Decisions (RFC)](docs/RFC.md) before making structural changes
2. Follow provider boundaries — ML imports stay in `local_*.py` modules
3. Add tests — unit for services, E2E for workflows
4. Run `yarn run quality:check` before committing
5. Use integer minor units for all monetary amounts

## License

[MIT](LICENSE)

---

<div align="center">

[Documentation](docs/) · [Report an Issue](../../issues)

</div>
