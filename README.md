# BillForge

Invoice processing for Indian CA firms. Extracts fields from PDF invoices, pairs each value with a cropped image of where it was found in the document, and exports GST-ready Tally XML.

## Quick Start

Prerequisites: Node.js 20+, Yarn 4+, Docker, Python 3.11+ (Apple Silicon for local MLX).

```bash
git clone <repo-url> && cd billforge
yarn install
yarn docker --preset=llamaextract-lowcost
```

Requires `LLAMA_CLOUD_API_KEY` in your environment. Open `http://localhost:5177` and log in as `tenant-admin-1@local.test` / `DemoPass!1`.

The stack starts MongoDB, Keycloak, MinIO, Redis, OCR, SLM, backend, and frontend with seeded demo tenants and sample invoices.

## Services

| Service | Host URL |
|---------|----------|
| Frontend | `http://localhost:5177` |
| Backend API | `http://localhost:4100` |
| Keycloak | `http://localhost:8280` |
| MinIO Console | `http://localhost:9101` |
| MongoDB | `localhost:27018` |
| Mongo Express | `http://localhost:8181` |
| MailHog (SMTP test) | `http://localhost:8125` |
| Redis | `localhost:6379` |

## Launch Profiles

BillForge uses a composable profile system instead of per-combination scripts. Select dimensions via flags:

```bash
yarn docker --preset=llamaextract-lowcost         # Managed cloud (recommended)
yarn docker --engine=claude --extraction=multi     # Local Claude CLI
yarn docker --engine=mlx --extraction=single       # Local MLX
yarn docker --preset=claude-single-apple           # Apple Vision + Claude
yarn docker --engine=api --ocr=llamaparse          # LlamaParse + Anthropic API
yarn profile:list                                  # See all options
```

### Dimensions

| Dimension | Flag | Options |
|-----------|------|---------|
| Engine | `--engine=X` | `claude`, `mlx`, `codex`, `api` |
| OCR | `--ocr=X` | `default`, `apple_vision`, `llamaparse` |
| Extraction | `--extraction=X` | `default`, `single`, `multi` |
| Preset | `--preset=X` | `llamaextract`, `llamaextract-lowcost`, `claude-single-apple`, `mlx-multi` |

### Other Stack Commands

```bash
yarn docker:down          # Stop stack (keep ML services)
yarn docker:down:all      # Stop everything
yarn docker:reload        # Rebuild and restart
yarn slm --engine=mlx     # Restart SLM only
yarn benchmark            # Run ML benchmarks
yarn logs:local           # Tail all service logs
```

Full profile documentation: [docs/LAUNCH_PROFILES.md](docs/LAUNCH_PROFILES.md)

## Extraction Pipeline

### Path A -- LlamaExtract (fully managed cloud)

LlamaParse OCR produces structured page items and screenshots. LlamaExtract performs schema-driven field extraction with bounding boxes and confidence scores. No local SLM required.

### Path B -- SLM (local or cloud model)

OCR (Apple Vision, DeepSeek MLX, or LlamaParse) extracts text blocks and page images. The SLM processes these into structured fields. When confidence falls below 85%, LLM vision re-extraction analyzes the page image directly. Corrections are recorded per vendor to improve future extractions.

Both paths finish with deterministic validation (date/amount/currency consistency) and the learning store.

## Directory Structure

```
billforge/
├── ai/                 # Python ML services (OCR, SLM)
│   ├── ocr/
│   └── slm/
├── backend/            # Express + TypeScript API
├── frontend/           # React + Vite dashboard
├── dev/                # Developer tooling
│   ├── scripts/
│   ├── profiles/
│   ├── config/
│   └── sample-invoices/
├── infra/              # Infrastructure config
│   ├── keycloak/
│   ├── mailhog/
│   ├── mongo/
│   ├── terraform/
│   └── modules/
├── docs/               # Architecture diagrams and guides
└── docker-compose.yml
```

## Tech Stack

**Backend:** Node.js 20, TypeScript 5 (strict), Express 4, Mongoose 8, Zod 3, Sharp, AWS SDK v3
**Frontend:** React 18, TypeScript (strict), Vite 6, Recharts
**ML Services:** Python 3.11, FastAPI, MLX
**Infrastructure:** Docker Compose, MongoDB 7, Keycloak 26, MinIO, Redis 7, Terraform

## Roles

| Role | Access |
|------|--------|
| PLATFORM_ADMIN | Full system administration, analytics, tenant onboarding |
| TENANT_ADMIN | Tenant configuration, user management, all invoice operations |
| MEMBER | Invoice processing, approval, export |
| VIEWER | Read-only access with configurable data scope |

## Configuration

The same Docker image serves local, staging, and production. Configuration varies by environment variables.

| Boundary | Options |
|----------|---------|
| Ingestion | Gmail OAuth, S3 Upload |
| OCR | Apple Vision (local), DeepSeek MLX (local), LlamaParse (cloud) |
| Extraction | Local MLX, Claude CLI, Anthropic API, LlamaExtract (cloud) |
| Export | Tally XML (CGST/SGST/IGST/Cess) |
| Storage | AWS S3 / MinIO |
| Email | SendGrid, SMTP, Gmail OAuth |

## Deployment

**Local:** `yarn docker --preset=llamaextract-lowcost` -- single command, includes demo data and seeded tenants.

**AWS:**

```bash
ENV=stg AWS_REGION=us-east-1 bash ./dev/scripts/deploy-aws.sh
```

Terraform modules: EC2 Spot workers, DocumentDB, S3, ECS Keycloak, IAM roles. See [AWS Deployment Guide](docs/AWS_DEPLOYMENT_GUIDE.md).

## Testing

```bash
yarn test              # All unit tests (backend + frontend)
yarn coverage:check    # Coverage with threshold enforcement
yarn knip              # Dead code analysis
yarn e2e:local         # Backend E2E (requires running stack)
yarn quality:check     # knip + coverage combined
```

100% branch coverage enforced on tracked modules (export, confidence, currency).

## Documentation

| Document | Contents |
|----------|----------|
| [Product Requirements](docs/PRD-CA-FIRMS-INDIA.md) | Customer outcomes, user flows, feature requirements |
| [Launch Profiles](docs/LAUNCH_PROFILES.md) | Profile system, dimensions, presets, migration table |
| [AWS Deployment Guide](docs/AWS_DEPLOYMENT_GUIDE.md) | Terraform provisioning, ECR push, deploy script |
| [Local OCR Setup](docs/LOCAL_DEEPSEEK_OCR_SETUP.md) | Apple Silicon MLX services, port mapping, health checks |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues, health checks, log access |
| [Architecture Diagram](docs/architecture.drawio) | System architecture (drawio format) |

## Contributing

1. Read the [Launch Profiles](docs/LAUNCH_PROFILES.md) docs before changing launch scripts
2. Follow provider boundaries -- ML imports stay in `local_*.py` modules
3. Add tests -- unit for services, E2E for workflows
4. Run `yarn quality:check` before committing
5. Use integer minor units (cents) for all monetary amounts

## License

[MIT](LICENSE)
