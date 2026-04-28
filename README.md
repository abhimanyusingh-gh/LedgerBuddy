# LedgerBuddy

Accounts payable for Indian Chartered Accountant firms — multi-tenant, GSTIN-first, Tally Prime-native.

![Build](https://img.shields.io/badge/build-passing-success)
![License](https://img.shields.io/badge/license-proprietary-lightgrey)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue)
![Last commit](https://img.shields.io/github/last-commit/abhimanyusingh-gh/LedgerBuddy)

![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-7.x-47A248?logo=mongodb&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Mongoose](https://img.shields.io/badge/Mongoose-8.x-880000?logo=mongoose&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-5.x-000000)
![Jest](https://img.shields.io/badge/Jest-29.x-C21325?logo=jest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-E2E-2EAD33?logo=playwright&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![AWS](https://img.shields.io/badge/AWS-Terraform-FF9900?logo=amazon-aws&logoColor=white)

![Per-realm dashboard with KPI tiles, the action-required queue, payable trend chart, TDS-deducted breakdown, and recent-activity feed](docs/design/screenshots/dashboard.png)


## What it does

LedgerBuddy runs accounts payable for Indian CA firms that operate AP across many client organisations from a single console. One firm, many client orgs: every client org is an isolated realm with its own vendor master, GST/TDS configuration, approval policy, and Tally Prime company.

The platform compresses the day-to-day AP workflow — invoices land from email or upload, an OCR-plus-SLM pipeline extracts canonical fields with confidence and bounding boxes, India-specific compliance enrichment (GSTIN/PAN, place-of-supply tax split, TDS section detection, MSME flag, Section 197 lookup) runs as pipeline stages, an operator reviews only what was flagged, structurally correct XML is exported to Tally Prime, payments are recorded with method-specific validation, and bank statements reconcile back against the recorded reality.

What makes LedgerBuddy specific: GSTIN-first tenant routing, dual-tagged ledger XML that Tally Prime imports without remediation, and a CA-firm topology where one operator switches across realms with a single keystroke.


## Key features

Ingestion and triage

- Multi-source ingestion — Gmail OAuth in production, MailHog in dev, S3/MinIO drop, manual upload. Each invoice carries its source mailbox plus receipt timestamp.
- Per-mailbox 30-day ingestion counts and a recent-ingestions drawer to audit what landed and where it went.

![Mailboxes list with per-mailbox 30-day ingestion counts, source-type chips, and the recent-ingestions drawer expanded on the right](docs/design/screenshots/mailboxes.png)

- Auto-routing by GSTIN to the correct client org; firm-wide Triage surfaces invoices that resolved ambiguously (`MULTI_MATCH_GSTIN`, `NO_GSTIN`, `BOUNCE`, `MULTI_MATCH_PAN`) for one-click route-or-reject.

![Triage table with reason chips, route-to dropdown per row, and route or reject actions](docs/design/screenshots/triage.png)

- Keyboard-driven Action queue inside each client org so a junior accountant can clear ten invoices a minute without leaving the trackpad.

![Action Required table with NEEDS_REVIEW and AWAITING_APPROVAL filters, vendor, invoice, section, age, and quick-action chips per row](docs/design/screenshots/action-required.png)

Invoice and vendor lifecycle

- Composable filters on the invoice list — saved views are URLs; status, vendor, section, age, and net payable after TDS are first-class columns.

![Invoices list with status, vendor, invoice number, date, section, age, and net-payable columns; filter chips applied](docs/design/screenshots/invoices.png)

- Vendor master with deductee type, MSME flag, lifetime spend, and an atomic merge dialog for de-duplicating vendors that arrived with two GSTINs across realms.

![Vendors list with GSTIN, PAN, default TDS section, MSME flag, and lifetime-spend columns](docs/design/screenshots/vendors.png)

Compliance and Tally

- TDS dashboard with FY switcher, quarter drill-down, KPIs, section-wise liability table, cumulative-threshold chart, and pending-challan deposits.

![TDS Dashboard with FY 2025-26 KPIs, section-wise liability, cumulative-threshold chart by vendor, and pending-challan deposits](docs/design/screenshots/tds-dashboard.png)

- Tally sync surface — bridge-agent connection status, last-applied AlterID watermark from the Tally company, and recent sync history.

![Tally Sync with bridge-agent connection status, AlterID watermark, last-success timestamp, and a sync-history table](docs/design/screenshots/tally-sync.png)

- Tally export batch tracker — success/failed state per batch, AlterID per row, retry-failed for transient errors, re-download for completed batches, and a per-batch line-error drawer that maps `LINEERROR` ordinals back to source invoices.

![Tally Export batch list with success and failed states, AlterID values, retry-failed and re-download actions, and a per-batch line-error drawer](docs/design/screenshots/tally-export.png)

> [!NOTE]
> Tally export emits structurally correct `ALLLEDGERENTRIES.LIST` plus `BILLALLOCATIONS` with `New Ref`, `<REFERENCE>`, and `<EFFECTIVEDATE>` populated, `ISINVOICE=Yes`, and a deterministic GUID per voucher so re-export is idempotent. The contract is enforced in the XML builder and exercised by fixture tests against a real Tally Prime company.

Money movement

- Payments handles single-invoice, multi-invoice, advance, and reversal flows. Method-specific validation runs inline (RTGS/NEFT IFSC and account-number checks; UPI VPA shape; cash-payment-above-limit risk signal). MSME-overdue rows are highlighted before scheduling.

![Payments list with selected rows ready to disburse, MSME-overdue highlight, RTGS/NEFT method chips, schedule and disburse action bar](docs/design/screenshots/payments.png)

- Reconciliation v2 lands as a junction-table model. The matcher proposes splits and aggregates with a +/- 2 day tolerance on settlement date; the operator confirms or maps manually.

![Reconciliation surface with junction-table proposed matches, split and aggregate detection callouts, and a manual-mapping side panel](docs/design/screenshots/reconciliation.png)

- Bank statements parse into rows that feed reconciliation. Per-statement view exposes parsed-row counts and current reconciliation status so an operator can tell at a glance which months are clean.

![Bank statements list with upload date, parsed-row counts, reconciled / unreconciled status chips, and an upload-new control](docs/design/screenshots/bank-statements.png)

Multi-tenant operations

- Client orgs is the firm-level admin surface — every client org with linked-record counts (invoices, vendors, payments, exports). Archiving asks for explicit confirmation when the linked-record count is non-zero.

![Client Orgs list with linked-record counts per row and archive controls; archive confirm dialog visible](docs/design/screenshots/client-orgs.png)

- Tenant config is the single page where the firm tunes per-realm policy — compliance thresholds and TDS section overrides, ingestion sources and routing rules, and the approval policy (single-step, two-step, value-tier).

![Tenant Config with three panels - compliance thresholds, ingestion sources and routing rules, and approval policy with value-tier configuration](docs/design/screenshots/tenant-config.png)

> [!WARNING]
> The MSME 45-day rule (Micro, Small and Medium Enterprises Development Act, 2006) requires payment to a registered MSME vendor within forty-five days of accepted goods or services. LedgerBuddy computes the deadline against the invoice's document date and surfaces overdue rows in Payments, the aging report, and the dashboard's recent-activity feed.


## Get started

Prerequisites

- Node.js 20 or later
- Yarn 4 (Berry — the repo is a Yarn workspaces monorepo, `packageManager` is pinned in `package.json`)
- Docker and Docker Compose
- Python 3.11 or later (Apple Silicon recommended for local MLX)

A clean day-1 sequence

```bash
git clone git@github.com:abhimanyusingh-gh/LedgerBuddy.git
cd LedgerBuddy
yarn install
cp backend/.env.example backend/.env
export LLAMA_CLOUD_API_KEY=...   # required for the lowcost preset
yarn docker --preset=llamaextract-lowcost
open http://localhost:5177       # log in as tenant-admin-1@local.test / DemoPass!1
```

The stack seeds two demo tenants, a sample realm, and a handful of pre-ingested invoices so the action queue, vendors list, and TDS dashboard all have content on first boot.

Service map

| Service        | Host URL                  |
|----------------|---------------------------|
| Frontend       | `http://localhost:5177`   |
| Backend API    | `http://localhost:4100`   |
| Keycloak       | `http://localhost:8280`   |
| MinIO console  | `http://localhost:9101`   |
| MongoDB        | `localhost:27018`         |
| Mongo Express  | `http://localhost:8181`   |
| MailHog        | `http://localhost:8125`   |
| Redis          | `localhost:6379`          |

Launch profiles compose along three dimensions (`--engine`, `--ocr`, `--extraction`). Full matrix: [docs/LAUNCH_PROFILES.md](docs/LAUNCH_PROFILES.md).


## Usage examples

Day-to-day commands once the stack is up:

```bash
yarn dev                  # backend + frontend in watch mode against the running stack
yarn test                 # unit tests, BE + FE
yarn coverage:check       # threshold-enforced coverage
yarn knip                 # dead-code analysis (CI gate)
yarn quality:check        # knip + coverage combined
yarn e2e:local            # backend E2E against the live stack
yarn e2e:frontend:local   # FE Playwright E2E
yarn build                # production build, BE + FE
```

Switching launch profile without leaving the repo:

```bash
yarn docker --preset=llamaextract-lowcost          # managed cloud, fastest path
yarn docker --engine=claude --extraction=multi     # local Claude CLI
yarn docker --engine=mlx --extraction=single       # local MLX
yarn docker --preset=claude-single-apple           # Apple Vision + Claude
yarn docker --engine=api --ocr=llamaparse          # LlamaParse + Anthropic API
yarn profile:list                                  # all options
```

A typical local backend `.env` block — copy from `backend/.env.example` and adjust the OIDC and Mongo URIs:

```bash
ENV=local
NODE_ENV=development
PORT=4100
API_BASE_URL=http://localhost:4100
MONGO_URI=mongodb://ledgerbuddy_app:ledgerbuddy_local_pass@localhost:27018/ledgerbuddy?authSource=ledgerbuddy
FRONTEND_BASE_URL=http://localhost:5177
OIDC_CLIENT_ID=ledgerbuddy-app
KEYCLOAK_REALM=ledgerbuddy
LOCAL_DEMO_SEED=true
```


## Documentation

Where to read further, by topic:

- Product and domain — [docs/PRD-CA-FIRMS-INDIA.md](docs/PRD-CA-FIRMS-INDIA.md), [docs/accounting-payments/PRD.md](docs/accounting-payments/PRD.md), [docs/accounting-payments/MASTER-SYNTHESIS.md](docs/accounting-payments/MASTER-SYNTHESIS.md).
- RFCs — [docs/accounting-payments/RFC-BACKEND.md](docs/accounting-payments/RFC-BACKEND.md), [docs/accounting-payments/RFC-FRONTEND.md](docs/accounting-payments/RFC-FRONTEND.md), [docs/accounting-payments/IMPLEMENTATION-PLAN-v4.3.md](docs/accounting-payments/IMPLEMENTATION-PLAN-v4.3.md).
- Architecture — [docs/architecture.drawio](docs/architecture.drawio), [docs/COMPOSABLE_PIPELINE.md](docs/COMPOSABLE_PIPELINE.md).
- Runbooks — [docs/runbooks/tally-exporter.md](docs/runbooks/tally-exporter.md) (TDS, vendor, and payment runbooks land per phase).
- Operations — [docs/AWS_DEPLOYMENT_GUIDE.md](docs/AWS_DEPLOYMENT_GUIDE.md), [docs/LAUNCH_PROFILES.md](docs/LAUNCH_PROFILES.md), [docs/LOCAL_DEEPSEEK_OCR_SETUP.md](docs/LOCAL_DEEPSEEK_OCR_SETUP.md), [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).


## Roadmap

The accounting-payments initiative formalises payment recording, TDS cumulative tracking, Tally XML correctness, vendor CRUD, and reconciliation v2. Source of truth: [docs/accounting-payments/MASTER-SYNTHESIS.md](docs/accounting-payments/MASTER-SYNTHESIS.md). MVP target is Phase 0 + 1 + 2 + 3 + 4 plus UX quick wins (~14 weeks); Phase 5 lands shortly after.

Phase 0 — Tally purchase-voucher XML correctness. **Shipped.** Export builder emits `ALLLEDGERENTRIES.LIST`, `BILLALLOCATIONS` with `New Ref`, `ISINVOICE=Yes`, deterministic GUID. Fixture tests assert structural shape against captured Tally Prime imports.

Phase 0.5 — Export batch correlation and re-export. **In progress.** Closes the gap between exporter and operator when a single line in a batch fails — per-invoice `ExportBatch` items, scoped re-export-failures endpoint, `LINEERROR` ordinal correlation (#277).

Phase 1 — TDS cumulative tracking. **In progress.** `TdsVendorLedger` model with atomic `$inc` (#255), pure-fn `TdsCalculationService` refactor (#256), idempotent backfill (#257), liability endpoint (#258), TDS Dashboard FE (#259), `AuditLog` (#260), FY archival and chaos harness (#278), runbook (#279).

Phase 2 — Vendor master CRUD and merge. **Upcoming.** First-class `VendorMaster` with TAN, Section 197 cert, `tallyLedgerName`, deductee type, MSME history (#261); `VendorService` CRUD plus atomic merge (#262); list and detail FE (#263, #264); runbook (#280).

Phase 3 — Payment recording. **Upcoming.** `Payment` model and invoice payment fields (#265), `PaymentService` with allocation and duplicate-UTR guard (#266), reversal flow with `CASH_PAYMENT_ABOVE_LIMIT` risk signal (#267), recording UI (#268), aging columns and history panel (#269), runbook (#281).

Phase 4 — Payment voucher Tally export. **Upcoming.** Payment-voucher XML builder with `BILLALLOCATIONS Agst Ref` (#270), per-tenant mutex endpoint (#271), bulk-select export panel UI (#272).

Phase 5 — Reconciliation v2. **Upcoming.** `ReconciliationMapping` junction-table model (#273), dual-write shim and cursor backfill (#274), TDS-adjusted scoring with +/- 2 day tolerance (#275), split/aggregate detection (#276), aging report with MSME 45-day-overdue split (#282).


## Project structure

```
LedgerBuddy/
├── ai/                                  # Python ML services (OCR, SLM)
├── backend/                             # Express + TypeScript API
│   └── src/
│       ├── routes/urls/*Urls.ts         # typed route URL providers
│       ├── integrations/urls/*Urls.ts   # typed external-service URL providers
│       ├── services/                    # domain services (TDS, payments, exports)
│       ├── models/                      # Mongoose models with tenantId scoping
│       └── sources/                     # ingestion adapters (Gmail, MailHog, S3)
├── frontend/                            # React + Vite SPA
│   └── src/
│       ├── api/urls/*Urls.ts            # typed FE URL providers (mirrors BE)
│       ├── stores/                      # Zustand stores
│       ├── features/                    # per-domain feature surfaces
│       └── components/                  # shared UI
├── dev/                                 # scripts, profiles, sample invoices
├── infra/                               # Keycloak realm exports, Mongo seed, Terraform
├── docs/                                # architecture, RFCs, runbooks, design canvas
└── docker-compose.yml
```


## Contributing

LedgerBuddy uses an issue-first PR workflow: every PR opens against an existing issue and the PR body carries `Closes #N`. Mechanical changes cap at 20 files per PR; backend and frontend land in alternating PRs to keep contracts visible. Open issues are the current source of in-flight scope — see the [issues tab](https://github.com/abhimanyusingh-gh/LedgerBuddy/issues) for what's actively being worked.


## Maintainers

- [@abhimanyusingh-gh](https://github.com/abhimanyusingh-gh)


## License

LedgerBuddy is currently a private, proprietary codebase. No `LICENSE` file is published; reuse outside the repository is not granted by default.
