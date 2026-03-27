# Architecture Decisions: BillForge

> Last updated: 2026-03-27

---

## 1. Why These Decisions Matter

Every architectural choice in BillForge serves one of three product outcomes: (1) the reviewer verifies invoices faster, (2) the system gets more accurate over time, or (3) a new integration can be added without rewriting the pipeline. This document records what was decided, why, and what we'd need to revisit if circumstances change.

---

## 2. Interface-Driven Boundaries

### 2.1 Ingestion Sources

**Decision:** Every source of invoices — Gmail, S3 upload, folder, future Outlook — implements a single `IngestionSource` interface. Sources carry `tenantId` and `workloadTier` for isolation.

**Why it matters:** The first adopter uses Gmail. The second might use Outlook or an ERP inbox. If Gmail were hardcoded, adding Outlook would mean rewriting the ingestion pipeline. With the interface, it's an adapter implementation — the checkpointing, dedup, and status tracking come for free.

**Current implementations:** `EmailIngestionSource` (IMAP), `FolderIngestionSource` (local dev), `S3UploadIngestionSource` (manual upload).

**What would change this:** If a source required fundamentally different lifecycle semantics (e.g., a streaming webhook that doesn't fit the poll-and-process model), the interface would need extension.

### 2.2 OCR and ML Providers

**Decision:** OCR is behind `OcrProvider`, field extraction behind `FieldVerifier`. Local dev uses Apple Silicon MLX models; production uses the same interfaces via HTTP endpoints.

**Why it matters:** ML models evolve fast. When a better OCR model arrives, swapping it is a provider configuration change — the pipeline, confidence scoring, and crop generation are untouched. The reviewer's experience doesn't change; only the accuracy improves.

**Current providers:** DeepSeek MLX (OCR, local), DeepSeek R1 (SLM, local), `prod_http` (remote endpoint for staging/production), `mock` (testing).

**Environment switch:** `ENV=local|stg|prod` — one variable controls whether ML runs on the host or routes to remote APIs. Same abstraction contracts throughout.

### 2.3 Export Adapters

**Decision:** Accounting export is behind `AccountingExporter`. Tally XML is the first implementation. The interface accepts mapped invoice fields and returns an export result.

**Why it matters:** Tally is the India go-to-market wedge, but the second adopter may use QuickBooks or Zoho Books. The approval workflow, batch tracking, audit trail, and download infrastructure are shared — adding a new export target is a mapping and XML/API adapter, not a pipeline rewrite.

**Current implementation:** `tallyExporter.ts` with India GST support (CGST/SGST/IGST/Cess as separate ledger entries, configurable ledger names). 100% branch coverage enforced.

### 2.4 File Storage

**Decision:** All file storage uses `S3FileStore` — MinIO locally, AWS S3 in production. No local disk storage. `LocalDiskFileStore` has been removed.

**Why it matters:** The app runs in Docker containers. Local disk storage creates container escape issues, ephemeral `/tmp` data loss, and divergent behavior between dev and prod. S3-only ensures that crops, overlays, previews, and uploads work identically in every environment.

### 2.5 Email Transport

**Decision:** Invite emails are behind `InviteEmailSender` with SMTP and SendGrid providers. Local dev routes SendGrid API calls through a MailHog wrapper for deterministic testing.

**Why it matters:** Production uses SendGrid for deliverability. Tests need deterministic email verification without external dependencies. The boundary lets both work with the same calling code.

---

## 3. Extraction Pipeline

### 3.1 SLM-Direct Extraction

**Decision:** OCR blocks and page images go directly to the SLM for field extraction. The heuristic regex parser is bypassed and retained only as a utility module.

**Why it matters to the reviewer:** The SLM understands spatial layout — it sees that "Invoice Number" is a label in one block and ": INV-FY2526-939" is the value in the adjacent block. Regex parsers fail on this split structure. Better extraction means fewer corrections, which means the reviewer spends less time fixing and more time approving.

**How it works:** Pipeline sets `metadata.ocrGate = "slm-direct"`. The SLM returns block indices for each extracted field, enabling the source crop and bounding box overlay that powers the core review UX. Spatial label-value proximity matching maps fields back to OCR blocks for crop generation.

**What changed:** Prior to m19, a heuristic parser attempted regex extraction first, with SLM as verification. Apple Vision OCR's block structure (labels and values in separate entries) made the regex approach unreliable. Quality over cost — accuracy is the top priority because every extraction error becomes a manual correction the reviewer must make.

### 3.2 Confidence Scoring

**Decision:** Confidence combines OCR quality (65%), field completeness (35%), minus warning penalties and risk flag penalties. Three bands: red (0-79), yellow (80-90), green (91+).

**Why it matters to the reviewer:** Green invoices can be batch-approved with a quick scan. Yellow invoices deserve a closer look. Red invoices need the source crops — that's where the core differentiator earns its keep. The bands map directly to reviewer behavior, not just system confidence.

**Hard constraint:** Green does not mean auto-approved. Green invoices are pre-selected for batch approval, but the reviewer must click "Approve." The system never approves on behalf of the human. This is a trust and liability decision for AP workflows.

**Risk flags:** Amounts above a configurable threshold trigger `TOTAL_AMOUNT_ABOVE_EXPECTED`. Due dates unreasonably far in the future trigger `DUE_DATE_TOO_FAR`. Both reduce the confidence score and surface a risk message.

### 3.3 Invoice Type Classification

**Decision:** The SLM classifies each invoice into one of 10 categories during its existing verification pass — no extra ML call. Classification is stored in `metadata.invoiceType` and displayed in the review UI.

**Categories:** `standard`, `gst-tax-invoice`, `vat-invoice`, `receipt`, `utility-bill`, `professional-service`, `purchase-order`, `credit-note`, `proforma`, `other`.

**Why it matters:** Classification keys the extraction learning store — corrections for "GST tax invoices from vendor X" are different from corrections for "receipts from vendor X." It also helps the reviewer understand what kind of document they're looking at before diving into the fields.

**Open risk:** If >15% of real invoices land in "other," the taxonomy needs expansion. This requires production telemetry to validate.

### 3.4 Extraction Learning Feedback Loop

**Decision:** Every reviewer correction is recorded per-tenant, grouped by invoice type and vendor fingerprint. On future extractions, prior corrections are fed to the SLM as `priorCorrections` hints.

**Why it matters to the business:** This is the retention moat. BillForge gets more accurate the longer a tenant uses it. Switching to a competitor means losing all the learned vendor patterns. The switching cost works in the customer's favor — not against them.

**How it works:**
1. Reviewer edits a parsed field → `invoiceService.updateInvoiceParsedFields()` compares old vs new values
2. Changed fields are recorded via `learningStore.recordCorrections()` — once by vendor fingerprint, once by invoice type
3. On next extraction, `pipeline.extract()` calls `learningStore.findCorrections()` and passes results as `priorCorrections` in the SLM hints
4. Vendor-specific corrections override type-level corrections for the same field

**Constraints:**
- Capped at 6 corrections per grouping key to bound SLM token footprint (~50-100 tokens)
- 90-day TTL via MongoDB index auto-prunes stale corrections
- Both thresholds are initial engineering constraints — validation needed with production data

**Active vs assistive:** The current implementation is active — corrections influence extraction directly. The risk: if a vendor changes their invoice format, stale corrections could degrade accuracy instead of improving it. The decision trigger for switching to assistive mode: if correction rate for returning vendors increases (instead of decreasing) after the learning store is active for that vendor.

**Instrumentation needed (not yet built):**
- Log when a prior correction hint was available but the SLM still got the field wrong
- Track correction rate per vendor over time (the leading indicator of whether the moat is forming)
- Surface in the review UI when a field was influenced by a learned correction (showing the work builds trust)

### 3.5 LLM-Assisted Re-Extraction

**Decision:** When confidence is below a configurable threshold (default 85%) and page images are available, the pipeline can trigger a second SLM call in strict mode with vision and up to 3 page images.

**Why it matters:** Low-confidence documents are where reviewers spend the most time. Vision-based re-extraction can rescue fields that text-only extraction missed, reducing the manual correction burden on exactly the invoices that need the most help.

**Cost control:** Only triggered when confidence is low (not on every invoice). Capped at 3 page images. Graceful failure — if the call fails, the pipeline continues with the original extraction. Controlled by `LLM_ASSIST_CONFIDENCE_THRESHOLD` env var (0 disables entirely).

---

## 4. Data Model

### 4.1 Integer Minor Units for Currency

**Decision:** All monetary values stored and transmitted as integer minor units (`totalAmountMinor` in cents/paise). Decimal formatting happens only at display and export boundaries.

**Why it matters:** Float precision issues across JavaScript, MongoDB, and accounting XML would cause silent rounding errors that accumulate across thousands of invoices. For a finance product, a 1-paisa discrepancy is a bug report. Integer arithmetic eliminates this class of error entirely.

### 4.2 Invoice Lifecycle States

**Decision:** Eight statuses: `PENDING` → `PARSED` / `NEEDS_REVIEW` / `FAILED_OCR` / `FAILED_PARSE` → `APPROVED` → `EXPORTED`. Plus `AWAITING_APPROVAL` for workflow-gated invoices.

**Key constraints:**
- `FAILED_PARSE` invoices cannot be approved (enforced in both frontend and backend)
- `EXPORTED` invoices cannot be edited (enforced at service layer with HTTP 403)
- `PENDING` is the re-entry state after retry/reingest
- Row actions (approve, retry, delete) are derived per-status — the UI never shows an action the backend would reject

**State diagram:** [docs/images/invoice-lifecycle.drawio](images/invoice-lifecycle.drawio)

### 4.3 Checkpoint and Idempotency

**Decision:** Per-source checkpoint marker in MongoDB, updated after each processed file. Unique compound index prevents duplicate invoice persistence.

**Why it matters:** Ingestion runs on schedule or manual trigger. If the process crashes mid-batch, the next run resumes from the last checkpoint — no duplicates, no re-processing. This is table stakes for a system that processes financial documents.

---

## 5. Authentication and Access Control

### 5.1 Keycloak-Only Authentication

**Decision:** All authentication uses Keycloak OIDC — both local development and production. The previous `local-sts` service is retired. No separate auth provider per environment.

**Why it matters:** Auth behavior drift between dev and prod creates bugs that only surface in production — the worst kind. Keycloak runs everywhere, which means login flows, token refresh, password policies, and session management work identically in dev and prod.

**Key details:**
- `OIDC_CLIENT_ID=billforge-app`, `KEYCLOAK_REALM=billforge`
- Token introspection with `client_id` + `client_secret`
- ROPC flow for programmatic access (E2E tests, seed scripts)
- `AuthService.changePassword` uses Keycloak admin API
- `AUTH_AUTO_PROVISION_USERS=true` auto-creates MongoDB user on first Keycloak login
- Onboarding creates Keycloak user with `temporary=true` password
- Invites create Keycloak user (if new) + trigger `executeActionsEmail(["UPDATE_PASSWORD"])`

### 5.2 RBAC with Four Roles

**Decision:** `PLATFORM_ADMIN`, `TENANT_ADMIN`, `MEMBER`, `VIEWER`. All write routes guarded by `requireNotViewer`. Admin routes guarded by `requireTenantAdmin`. Platform routes guarded by `requirePlatformAdmin`.

**Why it matters to the product:**
- **MEMBER** is the AP reviewer — can see invoices, approve within value limits, but can't configure the tenant or manage users
- **VIEWER** is the auditor — read-only access with configurable data scope, can see but never modify
- **TENANT_ADMIN** is the operations lead — manages team, configures workflows, connects Gmail
- **PLATFORM_ADMIN** is the platform operator — onboards tenants, monitors health, never sees invoice content

**Data boundary:** Platform admin API returns tenant metadata, user counts, document lifecycle counts, Gmail connection status, and token usage. No invoice rows, OCR text, or extracted values are returned at platform scope. This is a privacy and trust boundary, not just a permission check.

### 5.3 Auth Middleware Architecture

**Decision:** All Express route handlers guarded by `requireAuth` middleware. Auth failures propagate through Express error handling via `next(error)`. Token resolution supports both `Authorization: Bearer` header and `query.authToken` fallback (for SSE connections).

---

## 6. Approval Workflows

**Decision:** Two modes: `simple` (checkbox toggles) and `advanced` (multi-step builder with amount conditions).

**Why it matters:** The first adopter has a flat team with value-based escalation — invoices above a threshold require admin approval. Simple mode covers this. When the second adopter arrives with a three-level approval chain, advanced mode handles it without code changes.

**Advanced mode capabilities:** Ordered steps, approver types (`any_member` / `role` / `specific_users`), approval rules (`any` / `all`), amount-based conditions (`gt` / `gte` / `lt` / `lte`). Per-step tracking with approval/rejection state, timestamp, and user identity.

**Open question:** The advanced workflow builder is built but not validated with a real second adopter. This is an intentional bet, not a validated requirement.

---

## 7. Gmail Integration

**Decision:** Per-tenant Gmail OAuth2 connection with encrypted refresh token storage and configurable polling intervals (1/2/4/8 hours).

**Why it matters:** Gmail is the primary production ingestion source. Each staff member at the first adopter handles a specific client's inbox. The tenant admin connects inboxes and assigns them to team members — this is the operational model that makes the one-person-one-client-one-inbox workflow work.

**Key details:**
- OAuth2 flow with popup window (connect → Google consent → callback)
- Refresh tokens encrypted at rest
- Tenant-wide messageId dedup prevents processing the same email twice
- Re-auth notification when tokens expire
- Per-tenant isolation — one tenant's token issues don't affect others

---

## 8. Bank Connection (Anumati)

**Decision:** Account Aggregator bank connection behind `IBankConnectionService` interface with Anumati (production) and Mock (testing) implementations.

**Why it matters (stated):** Payment reconciliation with bank statements is a core finance team need. Account Aggregator is India's consent-based data sharing framework.

**Current status:** Infrastructure built — consent flow, AES encryption, JWS signing, webhook handlers, `BankAccount` model. Payment reconciliation logic is not yet implemented; this is a forward investment.

**Open question:** Is payment reconciliation in scope for adopter one? If not, this infrastructure carries maintenance cost ahead of validated need. The decision to build it early was a bet on the India-first strategy, but it should be explicitly validated before becoming a roadmap priority.

---

## 9. Infrastructure and Operations

### 9.1 Runtime Composition

Backend supports `APP_MANIFEST_PATH` to load adapter configuration from JSON — database, OCR, verifier, ingestion sources, export, tenant defaults. Environment variables serve as fallbacks. The same Docker image serves local, staging, and production — only the manifest differs.

### 9.2 AWS Runtime Pattern

Terraform provisions Spot-backed workers via Launch Template + ASG schedules. Workers pull the container image, run once, update the database, and shut down. Optional DocumentDB module for managed production MongoDB. Reusable modules: IAM, EC2 worker, DocumentDB, S3, STS access role.

### 9.3 Startup Readiness

Backend blocks until OCR and SLM services are healthy. Health endpoints validate MongoDB, OCR `/v1/models` + `/health`, and SLM `/health`. This prevents the API from accepting ingestion requests before the ML pipeline is ready.

### 9.4 Docker Compose

Project explicitly named `billforge` via top-level `name` field — deterministic container, volume, and network names across environments regardless of clone path.

### 9.5 Quality Gates

Pre-commit hook runs dead-code analysis (Knip) and coverage checks. 100% branch coverage enforced on tracked modules (tallyExporter, confidenceAssessment, currency utilities). CI pipeline: typecheck → test → knip → Docker build → Trivy scan.

**Tracked module selection criteria:** Modules where bugs cause direct financial harm to customers — export formatting, confidence scoring, amount conversion. The extraction pipeline and invoice service are covered by E2E tests rather than per-module coverage thresholds.

---

## 10. Frontend Architecture

### 10.1 Source-Verified Review (Core UX Decision)

**Decision:** Every extracted field is displayed alongside its source crop — a zoomed image of the exact document region where the value was found. The reviewer also has access to bounding box overlays on the full invoice page.

**Why this is an architecture decision, not just a UI feature:** The entire extraction pipeline — OCR block coordinates, SLM block indices, spatial proximity matching, crop generation, overlay rendering — exists to enable this single interaction pattern. If the crops are wrong, blurry, or misaligned, the core value proposition fails. This is why the pipeline stores `bboxNormalized` coordinates and the SLM returns block indices — so the frontend can render accurate proof of where every value came from.

### 10.2 State-Based Routing

No router library — navigation is state-driven in `App.tsx`. Session state determines auth vs. dashboard. `activeTab` determines which view renders (persisted to localStorage). Role determines which tabs are visible.

### 10.3 Server-Side Pagination and Filtering

Invoice list uses server-side pagination (default 20), sorting, and status filter counts. The frontend fetches pages until the backend `total` is reached, preventing hidden data from page size limits.

---

## 11. Consequences

**Positive:**
- Deterministic monetary handling eliminates rounding-error class of bugs
- Interface boundaries enable adapter-based extensibility without pipeline rewrites
- Source-verified review creates a defensible differentiation that competitors must replicate end-to-end
- Extraction learning compounds accuracy over time, creating a retention moat
- Same Docker image serves all environments, reducing deployment-specific bugs

**Tradeoffs:**
- Spot worker model adds cold start latency (acceptable for batch processing, not for real-time)
- OCR accuracy still depends on document quality — handwritten invoices remain the hardest case
- SLM-direct extraction trades cost (every extraction requires an ML call) for accuracy (no regex fallback)
- Active learning mode risks applying stale corrections until instrumented and validated
- 100% branch coverage enforcement on tracked modules adds commit friction

**Risks to monitor:**
- "Other" invoice classification rate — if >15%, taxonomy needs expansion
- Correction rate for returning vendors — should decrease, not increase, after learning loop activation
- GST header-level extraction sufficiency — line-item detail may be required for input tax credit reconciliation
- Advanced workflow builder — built but unvalidated by a real second adopter

---

## 12. Migration Notes

- Float amount usage (`totalAmount`) replaced with integer minor-unit field (`totalAmountMinor`) across backend, API contracts, UI renderers, and tests
- `StsBoundary` → `OidcProvider`, `HttpStsProvider` → `HttpOidcProvider` — old wrappers deleted
- `STS_*` env vars → `OIDC_*` across all configuration files
- `local-sts/` service deleted — Keycloak is the sole auth provider
- `LocalDiskFileStore` removed — S3/MinIO only
