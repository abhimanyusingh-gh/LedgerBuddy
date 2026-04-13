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

Three things make BillForge different:

1. **Source-verified review** — Every extracted field is paired with its source crop and bounding box overlay. The reviewer doesn't search the document; the evidence is brought to them.
2. **Accuracy that compounds** — Every correction is recorded per vendor and invoice type. The next invoice from that vendor extracts better. BillForge gets more accurate the longer you use it.
3. **India-first Tally export** — Native XML with full GST breakdown (CGST/SGST/IGST/Cess), ready to import with no manual mapping. Built on an adapter pattern — Tally is the first connector, not the last.

## How It Works

```
Gmail inbox → OCR extraction → SLM field extraction → Confidence scoring
  → Source-verified review → Approval workflow → Tally XML export
  → Corrections feed learning store → Better extraction next time
```

Every external dependency — OCR, ML model, storage, email, accounting export — is behind an interface. Swapping Gmail for Outlook, or Tally for QuickBooks, is an adapter change — not a rewrite.

> Full architecture diagram: [`docs/architecture.drawio`](docs/architecture.drawio)

## Local Development Scripts

### Bringing Up the Stack

| Script | OCR | SLM |
|--------|-----|-----|
| `yarn docker:up` | Apple Vision (default) | default |
| `yarn docker:up:claude` | Apple Vision | claude multi-step |
| `yarn docker:up:claude:single` | Apple Vision | claude single-step |
| `yarn docker:up:mlx` | Apple Vision | MLX single-step |
| `yarn docker:up:mlx:multi` | Apple Vision | MLX multi-step |
| `yarn docker:up:codex` | Apple Vision | Codex CLI |
| `yarn docker:up:api` | Apple Vision | Anthropic API |
| `yarn docker:up:apple_vision:claude` | **explicit** Apple Vision | claude multi-step |
| `yarn docker:up:apple_vision:claude:single` | **explicit** Apple Vision | claude single-step |
| `yarn docker:up:apple_vision:api` | **explicit** Apple Vision | Anthropic API |
| `yarn docker:up:llamaparse` | LlamaParse | claude multi-step |
| `yarn docker:up:llamaparse:claude` | LlamaParse | claude multi-step |
| `yarn docker:up:llamaparse:claude:single` | LlamaParse | claude single-step |
| `yarn docker:up:llamaparse:api` | LlamaParse | Anthropic API |

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
| `yarn benchmark:deepseek` | Run accuracy benchmark with local DeepSeek OCR |
| `yarn benchmark:llamaparse` | Run accuracy benchmark with LlamaParse OCR (requires `LLAMA_CLOUD_API_KEY`) |
| `yarn benchmark:llamaparse:dump` | Dump raw extraction results without comparing to ground truth |
| `yarn benchmark:llamaparse:generate-spec` | Generate a `ground-truth.json` template from LlamaParse extraction results |

Benchmark results are written to `.local-run/benchmark/latest-results.json`. Generated specs go to `.local-run/benchmark/generated-spec.json`.

## Quick Start

**Prerequisites:** Node.js 20+, Yarn 4+, Docker, Python 3.11+ (Apple Silicon for local MLX)

```bash
git clone <repo-url> && cd billforge
yarn install

# Optional: local ML services (mock OCR works without this)
python3 -m venv .venv-ml
./.venv-ml/bin/pip install -r invoice-ocr/requirements.local.txt \
                           -r invoice-slm/requirements.local.txt

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

Each invoice passes through progressively more expensive stages, gated by confidence:

| Stage | What Happens | Cost |
|-------|-------------|------|
| Vendor Fingerprint | Match known vendor layout patterns | Free |
| OCR | Text + bounding box extraction from all pages | Low |
| SLM-Direct Extraction | OCR blocks + page images → structured fields + invoice type classification | Medium |
| Deterministic Validation | Date/amount/currency consistency checks | Free |
| LLM Vision Re-extraction | Page image analysis when confidence < 85% | High |
| Learning Store | Record and apply corrections for future extractions | Free |

## Configuration

BillForge uses a runtime manifest for environment-specific wiring. The same Docker image serves local, staging, and production — only the manifest differs.

| Boundary | Current | Next |
|----------|---------|------|
| Ingestion | Gmail, S3 Upload, Folder | Outlook, custom IMAP |
| OCR | DeepSeek MLX / mock | Cloud API endpoint |
| Export | Tally XML (with GST) | QuickBooks, Zoho Books |
| Storage | S3 / MinIO | — |
| Email | SendGrid / SMTP | — |

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
