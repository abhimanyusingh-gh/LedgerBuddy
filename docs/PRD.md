# PRD: BillForge

## 1. Problem

Finance teams receive invoices in mixed formats and channels. Manual extraction, review, and accounting export are slow, error-prone, and hard to audit.

## 2. Goal

Build a minimal, modular application that ingests invoices, extracts structured data with OCR/AI, supports review + approval, and exports approved data to Tally.

## 3. Users

- AP/Finance reviewers
- Operations admins
- Developers maintaining ingestion/export integrations

## 4. Functional Requirements

1. Ingestion
- Support PDF (vector + scanned) and image files (`jpg`, `jpeg`, `png`).
- Use configurable, extensible ingestion interface.
- Initial source: email inbox integration.
- Local/test source: folder ingestion.
- Assign each source to a tenant and workload tier (`standard` or `heavy`) for operational isolation.
- For folder ingestion, process all supported files and skip already processed records by source identity to avoid duplicate work.

2. OCR and Extraction
- OCR provider abstraction with reliable handwriting-capable provider support.
- Local OCR runtime: host macOS MLX service with default model `mlx-community/DeepSeek-OCR-4bit`.
- Local SLM runtime: MLX-based verifier with default model `mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit`.
- Production OCR runtime: external OCR endpoint through the same OCR interface.
- No Tesseract fallback in runtime.
- Agentic extraction flow: evaluate multiple text candidates and select best parse.
- Extract core fields: invoice number, vendor, dates, currency, total amount.
- Store amount as integer minor currency unit only (`totalAmountMinor`).
- Persist OCR engine and extraction source separately for traceability.

3. Confidence and Risk
- Show extraction confidence in UI.
- Confidence color bands:
  - `0-79`: red
  - `80-90`: yellow
  - `91+`: green
- `91+` can be auto-selected for approval.
- Flag anomalous values (for example high total amount) and include in confidence scoring.

4. Review UI
- List parsed, failed, approved, and exported invoices.
- Load and display all invoice pages from the backend (no hidden first-page cap).
- Allow collapsing the right-side Invoice Details section so the Invoice list can expand.
- Show extracted values and Tally mapping in table format with clear labels.
- Show confidence and source-highlight overlays for extracted fields.
- Provide a lightweight inspect icon per extracted field to open the persisted crop image used for that value.
- File details popup shows detected data + mapping.
- Batch approval workflow.
- Export confirmation dialog shows selected file count.
- Exported invoices marked `EXPORTED` and no longer selectable.
- Allow approver edits of parsed fields before export, and block edits after export.

5. Export
- Tally export integration using correct API envelope/payload format.
- Keep approved selection behavior stable for export flow.

6. Authentication, Tenant Admin, and Platform Admin
- OAuth2 authorization-code login for all users.
- Tenant bootstrap on first login with explicit onboarding gate.
- Tenant RBAC: `TENANT_ADMIN` and `MEMBER`.
- Tenant invite flow with single-use token lifecycle.
- Platform admin access controlled by OAuth email allowlist.
- Platform admin view must expose tenant usage only (counts/status/health metadata), never invoice content or OCR payloads.

7. Email Integration for Invites and Mailbox
- Invite email sender must be abstraction-driven and provider-pluggable.
- Local default invite sender should simulate SendGrid Mail Send API through MailHog wrapper for integration testing.
- Provider compatibility target: SendGrid Mail Send contract (`/v3/mail/send`, Bearer auth, personalizations/content payload).

8. Checkpointing and Idempotency
- Store per-tenant + per-source checkpoint marker in MongoDB.
- Update checkpoint after each processed file.
- Crash-safe resume from last checkpoint.
- Avoid duplicate processing across runs.

9. Infra
- Terraform-based AWS provisioning.
- Spot-instance worker pattern for periodic processing.
- Provision a production Mongo-compatible DB module (DocumentDB) and use that connection for worker runtime in deployed environments.
- Use reusable IAM, worker, and DB modules with app-level manifest overrides (`app_manifest`) for future app onboarding.
- Use `tfvars` for deploy-time configuration and credentials.

10. Testing
- Unit tests for parser, confidence, exporter, mapping, and helpers.
- End-to-end tests for folder ingestion, checkpointing, resume behavior, and OCR engine/extraction-source consistency.
- End-to-end tests for invite delivery formatting through simulated SendGrid->MailHog path.
- End-to-end tests for platform-admin authorization and tenant-usage-only visibility.
- Enforced quality gate: no dead code (Knip) and 100% branch coverage for covered logic modules.

## 5. Non-Functional Requirements

- Backend: Node.js
- Frontend: React
- Database: MongoDB
- Infra: Terraform (modular, extensible)
- Keep code minimal and maintainable.
- Runtime wiring must be composable through a manifest file (`APP_MANIFEST_PATH`) with env fallback.
- Runtime mode switch must be a single variable: `ENV=local|stg|prod`.
- In `ENV=local`, run OCR/SLM locally on host macOS and use `docker compose up` for backend, frontend, database, local STS, and MailHog.
- Backend readiness must be blocked until required OCR + SLM capabilities are healthy.
- Prepare for multitenancy by partitioning data and ingestion workload lanes (`standard` vs `heavy`) to protect low-usage tenants from heavy-usage impact.

## 6. Out of Scope (Current Phase)

- Multi-tenant auth/authorization
- Full accounting reconciliation workflows
- Advanced line-item intelligence beyond current extraction scope
