# RFC: BillForge Architecture

## 1. Status

Accepted

## 2. Context

The system must ingest invoices from configurable sources, extract data from mixed-quality documents, support human review, and export approved invoices to Tally with operational reliability.

## 3. Decisions

1. Backend and Frontend Stack
- Backend: Node.js + Express
- Frontend: React
- DB: MongoDB
- Reason: minimal implementation with fast iteration and strong ecosystem support.

2. Ingestion Extensibility
- Use an `IngestionSource` abstraction.
- Current implementations: email source and folder source.
- Sources carry `tenantId` + `workloadTier` (`standard`, `heavy`) for partition-aware processing.
- Reason: new sources can be added without changing core pipeline logic.

3. OCR Extensibility + Agentic Selection
- Use `OcrProvider` abstraction.
- Current providers: `deepseek` and `mock`.
- Local OCR uses host-run pluggable OCR (`invoice-ocr`) with `POST /v1/ocr/document`:
  - default `local_hybrid` (DeepSeek MLX + Apple Vision arbitration)
  - optional `local_mlx`, `local_apple_vision`, or `prod_http`.
- Local SLM uses MLX verifier (`invoice-slm`) with default `mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit`.
- Production OCR uses the same interface via external OpenAI-compatible OCR endpoint.
- No Tesseract fallback in runtime.
- Agent evaluates multiple text candidates/strategies and chooses best parse.
- Persist OCR engine and extraction source separately (`ocrProvider` and `metadata.extractionSource`).
- Reason: better resilience across invoice layouts and OCR quality variation.

4. Amount Data Model
- Persist and transmit invoice totals only as integer minor units: `parsed.totalAmountMinor`.
- Decimal formatting occurs only at display/export boundaries.
- Reason: avoid float precision issues across systems and languages.

5. Confidence and Risk
- Confidence score combines OCR confidence + parse completeness - warnings - risk penalties.
- Color bands: red (`0-79`), yellow (`80-90`), green (`91+`).
- Auto-select for approval at configured threshold (default `91`).
- Risk flags include high total amount and due-date anomalies.

6. Workflow State Model
- Statuses: `PARSED`, `NEEDS_REVIEW`, `FAILED_OCR`, `FAILED_PARSE`, `APPROVED`, `EXPORTED`.
- Exported invoices are non-selectable in UI.
- Reason: explicit lifecycle and predictable UI behavior.

7. Checkpoint and Idempotency
- Per-source checkpoint marker stored in MongoDB.
- Checkpoint updated after each file.
- Folder source scans all supported files per run; service-level filtering skips already persisted `sourceDocumentId` values.
- Unique index prevents duplicate invoice persistence.
- Reason: crash-safe resume and duplicate avoidance in scheduled runs.

8. Tally Export Contract
- Export only approved invoices.
- Build Tally XML purchase voucher payload with mapped fields.
- Use parsed minor-unit amount converted to major-unit string only in XML payload.
- Reason: strict accounting payload format with internal numeric safety.

9. AWS Runtime Pattern
- Terraform provisions:
  - Spot-backed worker via Launch Template + ASG schedules.
  - Reusable worker IAM module.
  - Optional production DocumentDB module.
- When DocumentDB provisioning is enabled, worker `MONGO_URI` is auto-resolved from module output.
- Worker pulls container image, runs once, updates DB, and shuts down.
- Reason: low-cost periodic processing model with managed production database support.

10. Runtime Composition Manifest
- Backend supports `APP_MANIFEST_PATH` to load runtime composition from JSON:
  - database adapter config
  - OCR adapter config
  - field verifier adapter config
  - ingestion source adapter list
  - export defaults
  - tenant/workload defaults
- Env vars remain fallback defaults.
- Reason: local/prod adapter switching without code changes.

11. Runtime Environment Switch
- Introduce `ENV=local|stg|prod`.
- `ENV=local`: OCR/SLM run as host macOS MLX services, while compose runs backend/frontend/db.
- `ENV=stg|prod`: backend routes to remote OCR/SLM providers using the same abstraction contracts.
- Reason: one-switch operational mode without caller/API changes.

12. Startup Readiness Guarantees
- Backend startup validates OCR `/v1/models` + `/health` and verifier `/health`.
- Backend is considered ready only after required ML capabilities are reachable and healthy.
- Reason: prevent ingest/export endpoints from becoming available before ML dependencies are ready.

13. Quality Gate
- Pre-commit hook runs dead-code analysis (`knip`) and coverage checks.
- Backend and frontend logic modules are enforced at 100% branch coverage.
- Reason: prevent regressions and test drift as extraction/export logic evolves.

14. Dashboard Data Loading
- Frontend fetches invoice lists page-by-page until backend `total` is reached.
- Reason: prevent hidden data caused by backend max page size.

15. Detail Panel Layout
- UI supports hiding the right-side Invoice Details panel so the Invoice list occupies full width.
- UI exposes field-level source highlights (bbox overlays) and an inspect action for persisted OCR crops.
- Reason: improve review throughput when operators focus on list-level actions.

16. Tenant Isolation Groundwork
- Invoices, checkpoints, and ingestion sources carry `tenantId`.
- Sources also carry `workloadTier` (`standard`, `heavy`), and ingestion prioritizes `standard` tier first.
- Reason: establish a clean path to tenant-level isolation and predictable performance as usage scales.

17. Invite Email Sender Abstraction
- Introduce an invite-email boundary with pluggable providers.
- Provider implementations:
  - SMTP provider
  - SendGrid API provider (`/v3/mail/send`)
- Local default uses SendGrid-compatible relay endpoint backed by MailHog for deterministic integration testing.
- Reason: production compatibility with SendGrid while retaining offline local e2e confidence.

18. Platform Admin Usage Scope
- Add OAuth-derived platform-admin capability from configured email allowlist.
- Platform-admin API endpoint returns tenant-level usage aggregates only:
  - tenant metadata
  - user counts
  - document lifecycle counts
  - Gmail connection status
  - last ingestion timestamp
- No invoice rows, OCR text, or extracted values are returned at platform scope.
- Reason: preserve tenant data boundaries while enabling central operational oversight.

19. Auth Middleware on All API Routes
- All Express route handlers are guarded by `requireAuth` middleware.
- Middleware validates JWT session and attaches authenticated user context to the request.
- Auth failures call `next(error)` to propagate through Express error handling rather than sending responses directly.
- Reason: consistent auth enforcement across every endpoint with centralized error handling.

20. Compose Project Naming
- Docker Compose project is explicitly named `billforge` via the top-level `name` field.
- All containers, volumes, and networks use the `billforge` prefix for consistent resource naming.
- Reason: deterministic resource names across environments, avoids directory-derived names that change when the repo is cloned to a different path.

21. Invoice Type Classification
- The SLM classifies the invoice type during its existing verification pass (no extra LLM call).
- Closed set of 10 categories: `standard`, `gst-tax-invoice`, `vat-invoice`, `receipt`, `utility-bill`, `professional-service`, `purchase-order`, `credit-note`, `proforma`, `other`.
- Classification is stored in invoice metadata and used as a grouping key for extraction learnings.
- Reason: enables type-specific correction learnings without an additional inference call.

22. LLM-Assisted Re-Extraction
- When confidence score < configurable threshold (default 85%) and page images are available, the pipeline triggers a second SLM call in `strict` mode with `llmAssist: true` and up to 3 page images.
- Strict mode only fills empty or clearly incorrect fields -- it does not override existing good extractions.
- After successful LLM assist, the effective OCR confidence is floored at 0.88 for confidence recalculation, reflecting that vision-based re-extraction is more reliable than the original OCR confidence suggests.
- Controlled by `LLM_ASSIST_CONFIDENCE_THRESHOLD` env var (0 disables the feature).
- Graceful failure: if the LLM assist call fails, the pipeline continues with the original extraction.
- Reason: improves extraction quality on low-confidence documents while keeping the cost bounded (only triggered when needed, capped at 3 pages).

23. Extraction Learning Feedback Loop
- Correction learnings are stored per-tenant, keyed by invoice type (broad patterns) and vendor fingerprint (vendor-specific patterns).
- Schema: `{ tenantId, groupKey, groupType, corrections[] }` with each correction holding `field`, `hint` (max 80 chars), `count`, `lastSeen`.
- On future SLM verifier calls, prior corrections matching the invoice type and vendor are included as `priorCorrections` in the hints payload.
- Vendor-specific learnings override type-level learnings for the same field.
- Capped at 6 corrections per document to bound token footprint (~50-100 tokens per lookup).
- MongoDB TTL index on `updatedAt` auto-prunes documents not updated within 90 days.
- Reason: reduces repeated extraction errors for known vendor/type patterns, decreasing the need for the expensive LLM-assist stage over time.

## 4. Consequences

Positive:
- Deterministic monetary handling
- Modular ingestion/OCR/export architecture
- Good testability of isolated logic units

Tradeoffs:
- One-run Spot model adds cold start latency
- OCR accuracy still depends on document quality/provider

## 5. Migration Notes

- Replace old float amount usage (`totalAmount`) with integer minor-unit field (`totalAmountMinor`) in backend, API contracts, UI renderers, and tests.
