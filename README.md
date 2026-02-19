# Invoice Processor

Invoice ingestion and review platform built with Node.js (backend), React (frontend), MongoDB, and Terraform.

## Current State

Implemented:
- Configurable ingestion source interface (`email`, `folder` currently).
- OCR provider interface (`google-vision`, `tesseract`, `deepseek`, `mock`).
- OCR engine display is separated from extraction source (`ocrProvider` vs `metadata.extractionSource`).
- Parser + confidence/risk scoring.
- Currency amounts persisted and transmitted as integer minor units (`parsed.totalAmountMinor`) to avoid floating-point drift.
- Agentic extraction workflow that evaluates multiple OCR/text candidates and selects the best parse.
- MongoDB persistence with per-file source checkpointing and folder idempotency filtering by `sourceDocumentId`.
- Review dashboard with failed/parsed visibility, confidence badges, batch approval/export, and full invoice list paging.
- Tally exporter using XML import envelope and purchase voucher structure.
- Terraform modules for scheduled spot workers and production DocumentDB.
- Unit tests + local folder-based end-to-end ingestion test.

Delivery timeline:
- `docs/DELIVERY_TIMELINE.md` (7-day phased view with milestone mapping).

Not yet implemented:
- Authentication/authorization.
- Production-ready observability/alerting.
- Advanced invoice line-item extraction.

## Repository Layout

- `backend/` Node.js API + worker + ingestion pipeline.
- `frontend/` React review dashboard.
- `infra/terraform/` AWS Terraform with reusable `spot_worker` and `documentdb` modules.
- `sample-invoices/inbox/` local folder source for manual and e2e runs.
- `sample-invoices/benchmark/` 31-file mixed PDF/PNG/JPEG benchmark corpus with source manifest.
- `docker-compose.yml` local MongoDB + Mongo Express.

## Local Prerequisites

- Node.js 20+
- Yarn 4+
- Docker + Docker Compose

## Local Setup

1. Install dependencies:
```bash
yarn install
```

2. Start full local stack with Docker Compose:
```bash
docker compose up -d
```

This brings up:
- Backend API: `http://localhost:4000`
- Frontend dashboard: `http://localhost:5173`
- MongoDB: `localhost:27017`
- Mongo Express: `http://localhost:8081`

3. Create env files:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Notes:
- `docker compose` can boot without `backend/.env`; it always loads `backend/.env.example` and treats `backend/.env` as optional override.
- Create `backend/.env` when you need local secrets or non-default config.

4. Optional host-based dev mode (instead of Compose backend/frontend):
```bash
yarn dev
```

Compose-first workflow is recommended for cross-OS consistency.

Pristine teardown (containers + Mongo volume + compose images):
```bash
yarn docker:down
```

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

For local real OCR on images without cloud credentials:
- `OCR_PROVIDER=tesseract`

For LLM OCR with field-aware extraction:
- `OCR_PROVIDER=auto` (or `deepseek`)
- `DEEPSEEK_API_KEY=...`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com/v1`
- `DEEPSEEK_OCR_MODEL=deepseek-chat`
- `DEEPSEEK_TIMEOUT_MS=45000`

Recommended automatic OCR bootstrap:
- `OCR_PROVIDER=auto`
- Boot order is:
  - DeepSeek (valid API key check)
  - Google Vision (valid credential check)
  - Tesseract fallback
- Forced providers:
  - `OCR_PROVIDER=mock` forces mock OCR.
  - `OCR_PROVIDER=tesseract` forces Tesseract OCR.

## Manual End-to-End Local Run (Folder -> Dashboard)

1. Start stack:
```bash
docker compose up -d
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

Runs with Dockerized local dependencies and ingests fixture invoices from a temporary folder.

```bash
yarn e2e:local
```

What it verifies:
- Folder source picks up supported invoice files.
- Ingestion writes invoices to MongoDB.
- Checkpoint is updated after each processed file.
- Crash-resume behavior: after a simulated worker crash, next run resumes from checkpoint.
- Subsequent run behavior: already processed files are skipped by `sourceDocumentId`.
- New files are still ingested even when copied with older `mtime`.
- OCR engine remains accurate in persisted data even when extraction source is `pdf-native`.
- Invoice list data is ready for dashboard review.

## Checkpoint Behavior

Checkpoint markers are stored per source key in MongoDB (`checkpoints` collection).

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

Commit gate:
- Husky pre-commit hook runs `yarn quality:check`.
- Commits fail unless Knip is clean and coverage thresholds pass.

## Benchmark Corpus (31 files)

Public benchmark samples were collected from web-searched sources:
- `invoice2data` compare set (mixed vendors/countries): `tests/compare`
- `mouadhamri/invoice_dataset` (layout-diverse JPEG invoices)

Corpus details:
- Files: 31
- Types: 11 PDF, 4 PNG, 16 JPEG
- Input folder: `sample-invoices/benchmark/inbox`
- Source manifest: `sample-invoices/benchmark/SOURCES.csv`

Run benchmark:
```bash
docker compose up -d mongo
OCR_PROVIDER=tesseract \
INGESTION_SOURCES=folder \
FOLDER_SOURCE_PATH="$(pwd)/sample-invoices/benchmark/inbox" \
MONGO_URI="mongodb://127.0.0.1:27017/invoice_processor" \
yarn benchmark:corpus
```

Current benchmark snapshot after extraction tuning:
- Invoice2data amount exact-match accuracy: `66.67%` (`10/15`)
- Currency match accuracy: `86.67%` (`13/15`)
- Invoice-number match accuracy: `40.00%` (`6/15`)
- Corpus average confidence: `74.65`

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
cp terraform.tfvars.example terraform.tfvars
```

3. Fill required values in `terraform.tfvars` (VPC/subnets, image URI, source settings, Tally settings).
For production, set `provision_documentdb=true` and provide `documentdb_*` values.

4. Deploy:
```bash
terraform init
terraform plan
terraform apply
```

The deployment provisions scheduled spot workers and (optionally) a production DocumentDB cluster.
When `provision_documentdb=true`, worker `MONGO_URI` is auto-wired from the provisioned DB output.

## Key Configuration

Backend env variables:
- Ingestion: `INGESTION_SOURCES`, `EMAIL_*`, `FOLDER_*`
- OCR: `OCR_PROVIDER`, `GOOGLE_APPLICATION_CREDENTIALS`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_OCR_MODEL`, `DEEPSEEK_TIMEOUT_MS`, `MOCK_OCR_*`
- Confidence: `CONFIDENCE_EXPECTED_MAX_TOTAL`, `CONFIDENCE_EXPECTED_MAX_DUE_DAYS`, `CONFIDENCE_AUTO_SELECT_MIN`
  - `CONFIDENCE_EXPECTED_MAX_TOTAL` is configured in major units (for readability), then converted internally to minor units using detected currency.
- Export: `TALLY_ENDPOINT`, `TALLY_COMPANY`, `TALLY_PURCHASE_LEDGER`

Confidence/UI behavior:
- Tone bands are `red` (`0-79`), `yellow` (`80-90`), `green` (`91+`).
- Auto-select applies when confidence score is `>= CONFIDENCE_AUTO_SELECT_MIN` (default `91`).
- Extracted details show both `OCR Engine` and `Extraction Source`.

Terraform variables mirror core runtime settings, including confidence and Tally ledger config.
Use Terraform `extra_env` for backend variables that are not first-class inputs (for example `DEEPSEEK_*` values).
DocumentDB-specific variables: `provision_documentdb`, `documentdb_allowed_cidrs`, `documentdb_master_username`, `documentdb_master_password`, and related `documentdb_*` settings.

## Additional Docs

- AWS deployment guide: `docs/AWS_DEPLOYMENT_GUIDE.md`
- Product requirements (PRD): `docs/PRD.md`
- Architecture and design decisions (RFC): `docs/RFC.md`
