# Invoice Processor

Invoice ingestion and review platform built with Node.js (backend), React (frontend), MongoDB, and Terraform.

## Current State

Implemented:
- Configurable ingestion source interface (`email`, `folder` currently).
- OCR provider interface (`deepseek`, `mock`).
- Runtime composition manifest support (`APP_MANIFEST_PATH`) for database/OCR/source/export wiring with env fallback.
- Parser + confidence/risk scoring.
- Currency amounts persisted and transmitted as integer minor units (`parsed.totalAmountMinor`) to avoid floating-point drift.
- Staged extraction pipeline: vendor fingerprint -> template path (known vendors) -> OCR confidence gate -> layout graph + heuristics -> deterministic validation -> SLM field verifier fallback.
- MongoDB persistence with per-file source+tenant checkpointing and folder idempotency filtering by `sourceDocumentId`.
- OCR block crop artifacts persisted per bounding box with file-store abstraction:
  - `ENV=local|dev` -> local disk
  - `ENV=stg|prod` -> S3
- Tenant/workload partition keys (`tenantId`, `workloadTier`) across sources, checkpoints, and invoices.
- Review dashboard with failed/parsed visibility, confidence badges, batch approval/export, and full invoice list paging.
- Review dashboard includes value-source highlighting with OCR bounding-box overlays and per-field crop inspect actions.
- Tally exporter using XML import envelope and purchase voucher structure.
- Terraform modules for scheduled spot workers, reusable worker IAM, and production DocumentDB.
- Terraform module for reusable S3 artifact storage used by the backend file-store abstraction in production.
- Unit tests + true full-stack local end-to-end test (no mock OCR/SLM path).

Not yet implemented:
- Authentication/authorization.
- Production-ready observability/alerting.
- Advanced invoice line-item extraction.

## Repository Layout

- `backend/` Node.js API + worker + ingestion pipeline.
- `frontend/` React review dashboard.
- `invoice-ocr/` local OCR FastAPI service with pluggable providers (DeepSeek MLX, Apple Vision, hybrid, prod HTTP).
- `invoice-slm/` local MLX field-verifier FastAPI service with pluggable providers.
- `infra/modules/` copy-first reusable Terraform module catalog.
- `infra/terraform/` Invoice Processor stack composition using local modules (`environments/prod.tfvars.example` included).
- `sample-invoices/inbox/` local folder source for manual and e2e runs.
- `docker-compose.yml` local backend, frontend, MongoDB, and Mongo Express services.

## Local Prerequisites

- Node.js 20+
- Yarn 4+
- Docker Desktop
- Docker Compose v2
- Apple Silicon Mac for local MLX OCR/SLM services

## Local Setup

1. Install dependencies:
```bash
yarn install
```

2. Set runtime mode (defaults to local if not set):
```bash
export ENV=local
```

3. Create a local Python environment for MLX services:
```bash
python3 -m venv .venv-ml
./.venv-ml/bin/pip install --upgrade pip
./.venv-ml/bin/pip install -r invoice-ocr/requirements.local.txt -r invoice-slm/requirements.local.txt
```

4. Start full local stack:
```bash
yarn docker:up
```

This brings up:
- Backend API: `http://localhost:4000`
- Frontend dashboard: `http://localhost:5173`
- MongoDB: `localhost:27017`
- Mongo Express: `http://localhost:8081`
- OCR service: `http://localhost:8000`
- SLM service: `http://localhost:8100`

`yarn docker:up` starts local OCR/SLM services on host macOS (for `ENV=local|dev`) and then starts compose services.

5. Create env files (optional overrides):
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Notes:
- `docker compose` can boot without `backend/.env`; it always loads `backend/.env.example` and treats `backend/.env` as optional override.
- Create `backend/.env` when you need local secrets or non-default config.
- For local MLX OCR/SLM, no API key is required.
- MLX services run on host macOS, not inside Docker.
- Backend blocks startup until both ML capabilities are reachable and healthy.
- Runtime mode switch: `ENV=local|dev|stg|prod`.
- `ENV=local|dev`: run host OCR/SLM services (`SLM_ENGINE=local_mlx`, `OCR_ENGINE=local_hybrid` by default).
- `ENV=stg|prod`: use production-safe HTTP providers (`SLM_ENGINE=prod_http`, `OCR_ENGINE=prod_http`) and set remote URLs.
- Artifact storage is also env-driven:
  - `ENV=local|dev` uses `LOCAL_FILE_STORE_ROOT` (default `.local-run/artifacts`, gitignored)
  - `ENV=stg|prod` uses `S3_FILE_STORE_BUCKET` + `S3_FILE_STORE_REGION` + `S3_FILE_STORE_PREFIX`
- OCR path is direct inference via `POST /v1/ocr/document` (no `/v1/chat/completions` usage).
- OCR/SLM API layers are provider-agnostic and selected by env:
  - OCR: `OCR_ENGINE=local_hybrid|local_mlx|local_apple_vision|prod_http`
  - SLM: `SLM_ENGINE=local_mlx|prod_http`
- Production Docker dependencies exclude MLX packages entirely.
- Optional OCR service tuning via `yarn ocr:dev` env variables:
  - `OCR_ENGINE` (`local_hybrid` default, or `local_mlx|local_apple_vision|prod_http`)
  - `OCR_MODEL_ID` (default `mlx-community/DeepSeek-OCR-4bit`)
  - `OCR_MODEL_PATH` (optional local snapshot path)
  - `OCR_HYBRID_APPLE_ACCEPT_SCORE` (default `0.9`; DeepSeek confidence gate before Apple second pass)
  - `OCR_REMOTE_BASE_URL` (required for `OCR_ENGINE=prod_http`)
  - `OCR_REMOTE_API_KEY` (optional bearer token for remote OCR)
  - `OCR_REMOTE_TIMEOUT_MS` (default `300000`)
  - `OCR_MAX_NEW_TOKENS` (default `512`)
  - `OCR_LOAD_ON_STARTUP` (`true` by default)
- Optional SLM tuning via `yarn slm:dev` env variables:
  - `SLM_ENGINE` (`local_mlx` default, or `prod_http`)
  - `SLM_MODEL_ID` (default `mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit`)
  - `SLM_REMOTE_BASE_URL` (required for `SLM_ENGINE=prod_http`)
  - `SLM_REMOTE_SELECT_PATH` (default `/v1/verify/invoice`)
  - `SLM_REMOTE_API_KEY` (optional bearer token)

Pristine teardown (containers + Mongo volume + compose images):
```bash
yarn docker:down
```

Tail backend/frontend/mongo plus local OCR/SLM logs in one stream:
```bash
yarn logs:local
```
Backend + OCR + SLM emit JSON logs with a shared `correlationId` so one id traces a request from API ingress to OCR and export.

## ML Provider Boundaries

Python ML services use strict boundary interfaces with explicit provider factory selection:

- SLM:
  - `invoice-slm/app/boundary/llm_provider.py` (`LLMProvider`)
  - `invoice-slm/app/providers/local_mlx.py` (MLX only)
  - `invoice-slm/app/providers/prod_http.py` (Docker/Linux safe)
  - `invoice-slm/app/providers/factory.py`
- OCR:
  - `invoice-ocr/app/boundary/ocr_provider.py` (`OCRProvider`)
  - `invoice-ocr/app/providers/local_mlx.py` (DeepSeek OCR MLX, `mlx_vlm`)
  - `invoice-ocr/app/providers/local_apple_vision.py` (Apple Vision OCR)
  - `invoice-ocr/app/providers/local_hybrid.py` (DeepSeek + Apple arbitration)
  - `invoice-ocr/app/providers/prod_http.py` (Docker/Linux safe)
  - `invoice-ocr/app/providers/factory.py`

Why MLX cannot leak into production:
- MLX imports exist only in `local_mlx.py` modules.
- Docker images install `requirements.prod.txt` only (no MLX packages).
- Dockerfiles default to `*_ENGINE=prod_http`.
- Provider selection is explicit (`*_ENGINE`) and has no fallback.

## Runtime Composition Manifest

Backend runtime supports an optional manifest file (`APP_MANIFEST_PATH`) that composes adapters without code changes:
- database adapter (`mongo` URI)
- OCR adapter (`deepseek` / `mock`)
- field verifier adapter (`http` / `none`)
- ingestion source adapters (`email` / `folder`)
- export adapter defaults (Tally endpoint/company/ledger)
- tenant + workload defaults (`tenantId`, `workloadTier`)
- extraction gate tuning (`extraction.ocrHighConfidenceThreshold`)

Example files:
- `backend/runtime-manifest.local.json`
- `backend/runtime-manifest.prod.example.json`

This keeps local and production wiring pluggable:
- local: Docker Mongo + host-run MLX OCR + host-run MLX SLM
- production: provisioned DB + remote OCR endpoint + remote SLM verifier endpoint (for example Modal)

## Local Ingestion Modes

### 1. Email Source

Set in `backend/.env`:
- `INGESTION_SOURCES=email`
- `EMAIL_*` values
- `OCR_PROVIDER=auto` (recommended)

Run ingestion:
```bash
yarn worker:once
```

### 2. Folder Source (Local Demo / E2E)

Set in `backend/.env`:
- `INGESTION_SOURCES=folder`
- `FOLDER_SOURCE_KEY=local-folder`
- `FOLDER_SOURCE_PATH=./sample-invoices/inbox`
- `FOLDER_RECURSIVE=false`

For local simulation without external OCR:
- `OCR_PROVIDER=mock`
- `MOCK_OCR_TEXT="Invoice Number: DEMO-1001\nVendor: Demo Supplier\nInvoice Date: 2026-02-10\nDue Date: 2026-02-20\nCurrency: USD\nGrand Total: 1500.00"`
- `MOCK_OCR_CONFIDENCE=0.97`

Then place real invoice files in:
- `sample-invoices/inbox/*.pdf`
- `sample-invoices/inbox/*.jpg`
- `sample-invoices/inbox/*.jpeg`
- `sample-invoices/inbox/*.png`

A real sample invoice downloaded from the web is already included:
- `sample-invoices/inbox/web-sample-AmazonWebServices.pdf`

Source:
- https://raw.githubusercontent.com/invoice-x/invoice2data/master/tests/compare/AmazonWebServices.pdf

To download it again manually:
```bash
curl -L 'https://raw.githubusercontent.com/invoice-x/invoice2data/master/tests/compare/AmazonWebServices.pdf' -o sample-invoices/inbox/web-sample-AmazonWebServices.pdf
```

Run ingestion:
```bash
yarn worker:once
```

OCR runtime:
- `OCR_PROVIDER=auto`
- `auto` resolves to DeepSeek OCR and validates model availability at startup.
- No Tesseract fallback is used.
- Configure `DEEPSEEK_BASE_URL` to an endpoint that serves `/v1/ocr/document` and `/v1/models`.
- Local default OCR model is `mlx-community/DeepSeek-OCR-4bit`.
- Startup checks `/models` and fails fast if the configured model is unavailable.
- First local startup downloads model weights and can take several minutes.
- OCR results now include block-level bounding boxes (`ocrBlocks`) for later overlay rendering.
- Field verification supports local MLX endpoint (`FIELD_VERIFIER_PROVIDER=http`, `FIELD_VERIFIER_BASE_URL=http://localhost:8100/v1`) or can be disabled (`FIELD_VERIFIER_PROVIDER=none`).
- Forced providers:
  - `OCR_PROVIDER=mock` forces mock OCR.

## Manual End-to-End Local Run (Folder -> Dashboard)

1. Start local stack:
```bash
yarn docker:up
```

2. Backend in Compose loads `backend/.env` and mounts `sample-invoices/inbox` into the container.
If needed, adjust values in `backend/.env` (and compose overrides in `docker-compose.yml`).

3. Drop invoices into `sample-invoices/inbox/`.

4. Process invoices from dashboard by triggering `Run Ingestion`, or via API:
```bash
curl -X POST http://localhost:4000/api/jobs/ingest
```
The API returns run summary counts: `totalFiles`, `newInvoices`, `duplicates`, `failures`.
Live status is available at:
```bash
curl http://localhost:4000/api/jobs/ingest/status
```
The UI polls this endpoint and shows ingestion state (`running`, `completed`, `failed`), progress (`processedFiles` / `totalFiles`), and counters (`successful`, `new`, `duplicates`, `failures`) so users get immediate feedback and avoid repeated clicks.

5. Open dashboard (`http://localhost:5173`) and review parsed/failed invoices.
The list view loads all pages from the backend (not only first 100 records).
Use `Hide Details Panel` to collapse the right-side invoice details section and expand the invoice list.

## Automated End-to-End Test

Runs against the live stack: backend, frontend, MongoDB, local OCR, and local SLM.

```bash
yarn e2e:local
```

What it verifies:
- Local OCR and SLM health/readiness before backend test run.
- Full app startup (`backend`, `frontend`, `mongo`, `mongo-express`) with `docker compose`.
- Real ingestion run through `/api/jobs/ingest` for `pdf/png/jpg` files.
- Invoice persistence and listing through `/api/invoices`.
- Checkpoint behavior on rerun (second run processes `0` files).
- Approval endpoint behavior for `NEEDS_REVIEW` invoices (when present).
- No mock OCR provider in E2E assertions.

Frontend-only user-flow E2E (single `jpg` + `png` + `pdf`, ingest + UI bbox overlay verification):
```bash
yarn e2e:frontend:local
```
This verifies from the UI that:
- one file per type ingestion completes,
- value-source chips are shown,
- image preview is visible,
- selected-field bounding-box overlay is rendered in details and popup view,
- extracted-field inspect icon opens the persisted crop preview modal.

## Infra Composition

Terraform is split into reusable modules:
- `infra/modules/aws_iam_instance_profile` for EC2 role/profile
- `infra/modules/aws_scheduled_ec2_service` for scheduled compute runtime (`spot` or `on-demand`)
- `infra/modules/aws_documentdb_cluster` for production DB provisioning
- `infra/modules/aws_s3_bucket` for production artifact storage (OCR previews/crops)

For app-specific overrides, use `app_manifest` in tfvars:
- override ingestion/OCR/confidence/tally settings
- inject app-specific environment values via `app_manifest.env`
- reuse the same worker/DB/IAM modules across future apps with only tfvars changes
- future registry migration is mechanical (replace module `source` addresses only)

## Checkpoint Behavior

Checkpoint markers are stored per tenant + source key in MongoDB (`checkpoints` collection).

Behavior:
- After each file is processed, checkpoint is persisted immediately.
- If worker crashes mid-batch, next run resumes from the last saved marker.
- Folder source enumerates all supported files each run, and ingestion skips already processed files using existing `sourceDocumentId` values.
- Invoice-level uniqueness is also enforced by a MongoDB unique index on source/file identity.

## Amount Storage Model (Minor Units)

- Extracted amounts are converted to the smallest unit of the detected currency before persistence.
- Example: `USD 1200.50` is stored as `parsed.totalAmountMinor = 120050`.
- Example: `JPY 5000` is stored as `parsed.totalAmountMinor = 5000` (JPY has 0 decimal minor digits).
- Backend APIs and DB records use integer minor units only.
- Decimal formatting is done only at display/export boundaries (UI labels and Tally XML payload generation).

## Tests

Unit tests:
```bash
yarn test
```

Quality gate (dead-code + coverage):
```bash
yarn run quality:check
```

Dead code analysis only:
```bash
yarn run knip
```

Backend e2e only:
```bash
yarn workspace invoice-processor-backend run test:e2e
```

Benchmark local and prod endpoints:
```bash
yarn benchmark:ml
```
Optional prod benchmark targets:
- `OCR_PROD_URL` (example `https://your-ocr-endpoint/v1`)
- `SLM_PROD_URL` (example `https://your-slm-endpoint/v1`)

Commit gate:
- Husky pre-commit hook runs `yarn quality:check`.
- Commits fail unless Knip is clean and coverage thresholds pass.

## Build

```bash
yarn build
```

## Deployment (Terraform)

1. Move into terraform directory:
```bash
cd infra/terraform
```

2. Configure variables:
```bash
cp environments/prod.tfvars.example terraform.tfvars
```

3. Fill required values in `terraform.tfvars` (VPC/subnets, image URI, source settings, Tally settings).
The production template already sets `provision_documentdb=true` and expects `documentdb_*` values so worker runtime uses module-managed DB output.

4. Deploy:
```bash
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

The deployment provisions scheduled spot workers and (optionally) a production DocumentDB cluster.
When `provision_documentdb=true`, worker `MONGO_URI` is auto-wired from the provisioned DB output.

## Key Configuration

Backend env variables:
- Ingestion: `INGESTION_SOURCES`, `EMAIL_*`, `FOLDER_*`
- OCR: `OCR_PROVIDER`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_OCR_MODEL`, `DEEPSEEK_TIMEOUT_MS`, `MOCK_OCR_*` (`DEEPSEEK_API_KEY` optional)
- Confidence: `CONFIDENCE_EXPECTED_MAX_TOTAL`, `CONFIDENCE_EXPECTED_MAX_DUE_DAYS`, `CONFIDENCE_AUTO_SELECT_MIN`
  - `CONFIDENCE_EXPECTED_MAX_TOTAL` is configured in major units (for readability), then converted internally to minor units using detected currency.
- Export: `TALLY_ENDPOINT`, `TALLY_COMPANY`, `TALLY_PURCHASE_LEDGER`

Confidence/UI behavior:
- Tone bands are `red` (`0-79`), `yellow` (`80-90`), `green` (`91+`).
- Auto-select applies when confidence score is `>= CONFIDENCE_AUTO_SELECT_MIN` (default `91`).
- Extracted details focus on parsed values, tally mappings, and source-highlight overlays instead of OCR implementation labels.

Terraform variables mirror core runtime settings, including confidence and Tally ledger config.
Use Terraform `extra_env` for backend variables that are not first-class inputs (for example `DEEPSEEK_*` values).
DocumentDB-specific variables: `provision_documentdb`, `documentdb_allowed_cidrs`, `documentdb_master_username`, `documentdb_master_password`, and related `documentdb_*` settings.

## Additional Docs

- AWS deployment guide: `docs/AWS_DEPLOYMENT_GUIDE.md`
- Local OCR setup: `docs/LOCAL_DEEPSEEK_OCR_SETUP.md`
- Product requirements (PRD): `docs/PRD.md`
- Architecture and design decisions (RFC): `docs/RFC.md`
