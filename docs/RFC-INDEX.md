# RFC Index (Normalized)

> Generated: 2026-03-27 | Source: `docs/RFC.md`, codebase verification, commit history, project memory

---

## RFC-01: Backend and Frontend Stack

- **Status:** Active
- **Summary:** Node.js + Express backend, React frontend, MongoDB database.
- **Decision:** Minimal stack for fast iteration. TypeScript (strict mode) across both.
- **Rationale:** Strong ecosystem, fast iteration, team familiarity.
- **Related Code:** `backend/src/app.ts`, `backend/src/server.ts`, `frontend/src/main.tsx`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-02: Ingestion Extensibility

- **Status:** Active
- **Summary:** `IngestionSource` interface with pluggable implementations.
- **Decision:** Sources carry `tenantId` + `workloadTier` for partition-aware processing. Current implementations: email, folder, S3 upload.
- **Rationale:** New sources can be added without changing core pipeline logic.
- **Related Code:** `backend/src/core/interfaces/IngestionSource.ts`, `backend/src/sources/EmailIngestionSource.ts`, `backend/src/sources/FolderIngestionSource.ts`, `backend/src/sources/S3UploadIngestionSource.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-03: OCR Extensibility + SLM-Direct Extraction

- **Status:** Active (Updated from original — see note)
- **Summary:** `OcrProvider` abstraction with pluggable providers. SLM is the sole field extractor.
- **Decision:** OCR blocks + page images go directly to SLM for field extraction. Heuristic parser bypassed since m19.
- **Rationale (from project memory, 2026-03-25):** Apple Vision OCR returns per-block text with bounding boxes, but labels and values appear in separate blocks. The heuristic regex parser can't handle this split structure. SLM understands spatial layout from blocks + page images. Quality > cost.
- **Related Code:** `backend/src/services/extraction/InvoiceExtractionPipeline.ts` (sets `ocrGate = "slm-direct"`), `backend/src/ocr/DeepSeekOcrProvider.ts`, `backend/src/verifier/HttpFieldVerifier.ts`
- **Note:** The existing RFC.md (Decision 3) still references "agentic selection" and "multiple text candidates/strategies." This language is outdated — the current pipeline is deterministic: OCR → SLM → parsed fields. The parser (`invoiceParser.ts`) is retained as a utility module with its own tests, but is not in the ingestion critical path.
- **Recommended Action:** Update RFC.md to reflect SLM-direct architecture
- **Confidence:** High

---

## RFC-04: Amount Data Model

- **Status:** Active
- **Summary:** All monetary values stored as integer minor units (`totalAmountMinor`).
- **Decision:** Decimal formatting only at display/export boundaries. INR lakh formatting added in m19.
- **Rationale:** Avoids float precision issues across systems and languages.
- **Related Code:** `backend/src/utils/currency.ts`, `frontend/src/currency.ts`, `backend/src/services/tallyExporter.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-05: Confidence and Risk

- **Status:** Active
- **Summary:** Confidence scoring combines OCR confidence + parse completeness - warnings - risk penalties.
- **Decision:** Color bands: red (0-79), yellow (80-90), green (91+). Auto-select at 91+.
- **Rationale:** Enables tiered review — high-confidence invoices can be batch-approved.
- **Related Code:** `backend/src/services/confidenceAssessment.ts`, `frontend/src/components/ConfidenceBadge.tsx`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-06: Workflow State Model

- **Status:** Active
- **Summary:** Invoice lifecycle: PENDING → PARSED/NEEDS_REVIEW/FAILED_OCR/FAILED_PARSE → APPROVED → EXPORTED.
- **Decision:** FAILED_PARSE not approvable. Exported invoices non-selectable. Inline row actions per status.
- **Rationale:** Explicit lifecycle with predictable UI behavior.
- **Related Code:** `backend/src/types/invoice.ts`, `backend/src/services/invoiceService.ts`, `frontend/src/components/tenantAdmin/TenantInvoicesView.tsx`
- **Diagram:** `docs/images/invoice-lifecycle.drawio`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-07: Checkpoint and Idempotency

- **Status:** Active
- **Summary:** Per-source checkpoint in MongoDB. Updated after each file. Unique index prevents duplicates.
- **Decision:** Crash-safe resume with dedup via `sourceDocumentId`.
- **Rationale:** Reliable scheduled/batch processing.
- **Related Code:** `backend/src/models/Checkpoint.ts`, `backend/src/services/ingestionService.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-08: Tally Export Contract

- **Status:** Active (Enhanced)
- **Summary:** Export approved invoices as Tally XML purchase vouchers with India GST support.
- **Decision:** Minor-unit → major-unit conversion only in XML payload. CGST/SGST/IGST/Cess as separate ledger entries.
- **Rationale:** Strict accounting format with internal numeric safety. India GST compliance.
- **Related Code:** `backend/src/services/tallyExporter.ts` (100% branch coverage), `backend/src/services/exportService.ts`
- **Note:** GST support added in m19v (commit `bfedd36`). Not covered in original RFC.md.
- **Recommended Action:** Update RFC.md to document GST ledger breakdown
- **Confidence:** High

---

## RFC-09: AWS Runtime Pattern

- **Status:** Active
- **Summary:** Spot-backed worker via Launch Template + ASG. Optional DocumentDB. Reusable Terraform modules.
- **Decision:** Worker pulls image, runs once, updates DB, shuts down. Cost-optimized with scheduled ASG.
- **Rationale:** Low-cost periodic processing with managed production database.
- **Related Code:** `infra/modules/aws_scheduled_ec2_service/`, `infra/modules/aws_documentdb_cluster/`, `infra/terraform/`, `scripts/deploy-aws.sh`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-10: Runtime Composition Manifest

- **Status:** Active
- **Summary:** `APP_MANIFEST_PATH` loads runtime config from JSON. Env vars as fallback.
- **Decision:** Manifest defines: database, OCR, verifier, ingestion sources, export, tenant/workload defaults.
- **Rationale:** Local/prod adapter switching without code changes.
- **Related Code:** `backend/src/core/runtimeManifest.ts`, `backend/src/core/dependencies.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-11: Runtime Environment Switch

- **Status:** Active
- **Summary:** `ENV=local|stg|prod` for environment mode.
- **Decision:** Local: OCR/SLM as host MLX services + Docker for everything else. Stg/prod: remote OCR/SLM.
- **Rationale:** One-switch operational mode.
- **Related Code:** `backend/src/config/env.ts`, `docker-compose.yml`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-12: Startup Readiness Guarantees

- **Status:** Active
- **Summary:** Backend validates OCR + SLM health before accepting requests.
- **Decision:** Blocks on `/v1/models` + `/health` for OCR and `/health` for SLM.
- **Rationale:** Prevent endpoints from becoming available before ML dependencies are ready.
- **Related Code:** `backend/src/routes/health.ts`, `backend/src/core/dependencies.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-13: Quality Gate

- **Status:** Active
- **Summary:** Pre-commit hook runs dead-code analysis (Knip) + coverage checks.
- **Decision:** 100% branch coverage on tracked modules (e.g., `tallyExporter.ts`).
- **Rationale:** Prevent regressions as extraction/export logic evolves.
- **Related Code:** `knip.json`, `.husky/`, `package.json` scripts
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-14: Dashboard Data Loading

- **Status:** Active
- **Summary:** Frontend fetches pages until backend `total` is reached.
- **Decision:** Server-side pagination with default page size 20. Server-side column sorting and status filter counts added in m19.
- **Rationale:** Prevent hidden data from backend max page size.
- **Related Code:** `frontend/src/components/tenantAdmin/TenantInvoicesView.tsx`, `backend/src/routes/invoices.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-15: Detail Panel Layout

- **Status:** Active
- **Summary:** Collapsible right-side detail panel. Field-level source highlights and crop inspection.
- **Decision:** Panel hides to give invoice list full width.
- **Rationale:** Improve review throughput for list-level operations.
- **Related Code:** `frontend/src/components/tenantAdmin/TenantInvoicesView.tsx`, `frontend/src/sourceHighlights.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-16: Tenant Isolation Groundwork

- **Status:** Active
- **Summary:** All data carries `tenantId`. Sources carry `workloadTier`.
- **Decision:** Standard tier prioritized over heavy during ingestion.
- **Rationale:** Clean path to tenant-level isolation and predictable performance.
- **Related Code:** All models include `tenantId`, `backend/src/services/ingestionService.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-17: Invite Email Sender Abstraction

- **Status:** Active
- **Summary:** Pluggable invite email transport with SendGrid and SMTP providers.
- **Decision:** Local dev uses SendGrid-compatible relay → MailHog for integration testing.
- **Rationale:** Production compatibility with offline local testing.
- **Related Code:** `backend/src/providers/email/`, `backend/src/core/boundaries/InviteEmailSenderBoundary.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-18: Platform Admin Usage Scope

- **Status:** Active
- **Summary:** Platform admin sees tenant usage aggregates only — never invoice content.
- **Decision:** API returns: tenant metadata, user counts, document lifecycle counts, Gmail status, last ingestion.
- **Rationale:** Preserve tenant data boundaries for central oversight.
- **Related Code:** `backend/src/services/platformAdminService.ts`, `backend/src/services/analyticsService.ts`, `frontend/src/components/platformAdmin/`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-19: Auth Middleware on All API Routes

- **Status:** Active
- **Summary:** All routes guarded by `requireAuth` middleware.
- **Decision:** JWT validation + user context attachment. Auth failures propagate through Express error handling.
- **Rationale:** Consistent enforcement with centralized error handling.
- **Related Code:** `backend/src/auth/requireAuth.ts`, `backend/src/auth/middleware.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-20: Compose Project Naming

- **Status:** Active
- **Summary:** Docker Compose project named `billforge` explicitly.
- **Decision:** All containers/volumes/networks use `billforge` prefix.
- **Rationale:** Deterministic names across environments, avoids directory-derived naming.
- **Related Code:** `docker-compose.yml` (line 1: `name: billforge`)
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-21: Invoice Type Classification

- **Status:** Active
- **Summary:** SLM classifies invoice type during verification (no extra LLM call).
- **Decision:** 10-category closed set. Stored in metadata. Used as grouping key for extraction learnings.
- **Rationale:** Type-specific correction learnings without additional inference cost.
- **Related Code:** `backend/src/verifier/HttpFieldVerifier.ts`, `backend/src/services/extraction/extractionLearningStore.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-22: LLM-Assisted Re-Extraction

- **Status:** Active
- **Summary:** When confidence < threshold (default 85%) and page images available, trigger SLM strict mode with vision.
- **Decision:** Only fills empty/incorrect fields. OCR confidence floored at 0.88 after success. `LLM_ASSIST_CONFIDENCE_THRESHOLD` env var (0 disables).
- **Rationale:** Cost-bounded quality improvement for low-confidence documents.
- **Related Code:** `backend/src/services/extraction/InvoiceExtractionPipeline.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-23: Extraction Learning Feedback Loop

- **Status:** Active
- **Summary:** Per-tenant correction learnings keyed by invoice type + vendor fingerprint.
- **Decision:** Max 6 corrections per document. Vendor-specific overrides type-level. 90-day TTL.
- **Rationale:** Reduces repeated errors, decreasing need for expensive LLM-assist.
- **Related Code:** `backend/src/services/extraction/extractionLearningStore.ts`, `backend/src/models/ExtractionLearning.ts`
- **Recommended Action:** Keep
- **Confidence:** High

---

## RFC-MISSING-01: RBAC and VIEWER Role

- **Status:** Missing (implemented but undocumented in RFC.md)
- **Summary:** 4-role RBAC: PLATFORM_ADMIN, TENANT_ADMIN, MEMBER, VIEWER. VIEWER role is read-only with configurable data scope.
- **Decision:** `requireNotViewer` middleware on all write routes. `ViewerScope` model for configurable visibility.
- **Rationale:** Auditors and observers need read-only access without accidentally modifying data.
- **Related Code:** `backend/src/auth/middleware.ts` (lines 88-101), `backend/src/models/TenantUserRole.ts`, `backend/src/models/ViewerScope.ts`
- **Evidence:** Commit `b0e2e13` (m15), memory "m12b Changes"
- **Recommended Action:** Create — add as RFC-24 in RFC.md
- **Confidence:** High

---

## RFC-MISSING-02: Keycloak-Only Authentication

- **Status:** Missing (implemented but undocumented in RFC.md)
- **Summary:** All auth via Keycloak OIDC. Local-STS retired. ROPC for programmatic access. Admin client for user management.
- **Decision:** `OIDC_CLIENT_ID=billforge-app`, `KEYCLOAK_REALM=billforge`. Token introspection with client credentials. Password change via KC admin API.
- **Rationale:** Single identity provider for dev and prod. Eliminates drift between local-sts and production auth behavior.
- **Related Code:** `backend/src/sts/OidcProvider.ts`, `backend/src/sts/HttpOidcProvider.ts`, `backend/src/keycloak/KeycloakAdminClient.ts`, `backend/src/auth/AuthService.ts`
- **Evidence:** Commit `7b58271` (m13), memory "Auth: Keycloak-only"
- **Recommended Action:** Create — add as RFC-25 in RFC.md
- **Confidence:** High

---

## RFC-MISSING-03: S3-Only Storage Policy

- **Status:** Missing (enforced but undocumented in RFC.md)
- **Summary:** All file storage must use S3/MinIO. No local disk storage. App fully confined to Docker containers.
- **Decision:** `S3FileStore` is the sole `FileStore` implementation. `LocalDiskFileStore` source removed.
- **Rationale:** Container escape prevention. Eliminates ephemeral /tmp issues. Ensures local/prod parity.
- **Related Code:** `backend/src/storage/S3FileStore.ts`, `backend/src/core/interfaces/FileStore.ts`
- **Evidence:** Memory `feedback_s3_only_storage.md`, commit `1506d3e` (m19)
- **Recommended Action:** Create — add as RFC-26 in RFC.md
- **Confidence:** High

---

## RFC-MISSING-04: Approval Workflow Engine

- **Status:** Missing (implemented but undocumented in RFC.md)
- **Summary:** Configurable approval workflows — simple (checkbox) or advanced (multi-step builder with role/user approvers, amount conditions).
- **Decision:** Two modes: simple and advanced. Steps have approver type (any_member/role/specific_users), rule (any/all), and optional amount conditions.
- **Rationale:** Different tenants have different approval complexity needs.
- **Related Code:** `backend/src/models/ApprovalWorkflow.ts`, `backend/src/services/approvalWorkflowService.ts`, `frontend/src/components/tenantAdmin/ApprovalWorkflowSection.tsx`
- **Evidence:** Commit `b0e2e13` (m15)
- **Recommended Action:** Create — add as RFC-27 in RFC.md
- **Confidence:** High

---

## RFC-MISSING-05: Bank Connection (Anumati Account Aggregator)

- **Status:** Missing (implemented but undocumented in RFC.md)
- **Summary:** India Account Aggregator integration for bank connection and consent-based data access.
- **Decision:** `IBankConnectionService` interface with Anumati + Mock implementations. AES encryption + JWS signing for AA protocol.
- **Rationale:** Payment reconciliation with bank statements.
- **Related Code:** `backend/src/services/anumati/`, `backend/src/routes/bankAccounts.ts`, `backend/src/routes/bankWebhooks.ts`, `backend/src/models/BankAccount.ts`
- **Evidence:** Commit `681bcf9` (m14)
- **Recommended Action:** Create — add as RFC-28 in RFC.md
- **Confidence:** High

---

## RFC-MISSING-06: GST Tax Breakdown in Export

- **Status:** Missing (implemented but undocumented in RFC.md)
- **Summary:** Tally XML export includes separate ledger entries for CGST, SGST, IGST, and Cess.
- **Decision:** Configurable ledger names via env vars (`TALLY_CGST_LEDGER`, etc.). Tax amounts extracted by SLM. Each positive component gets its own `LEDGERENTRIES.LIST` in XML.
- **Rationale:** India GST compliance requires itemized tax components in accounting entries.
- **Related Code:** `backend/src/services/tallyExporter.ts` (GstAmounts interface, TallyGstLedgerConfig)
- **Evidence:** Commit `bfedd36` (m19v)
- **Recommended Action:** Create — fold into RFC-08 update
- **Confidence:** High

---

## RFC-MISSING-07: Gmail OAuth Integration

- **Status:** Missing (implemented but undocumented in RFC.md)
- **Summary:** Per-tenant Gmail OAuth2 connection for inbox-based invoice ingestion with encrypted token storage and configurable polling.
- **Decision:** OAuth2 flow via Google. Refresh tokens encrypted at rest. Polling at 1/2/4/8h intervals. Re-auth notification on expiry.
- **Rationale:** Primary production ingestion source for finance teams.
- **Related Code:** `backend/src/routes/gmailConnection.ts`, `backend/src/services/tenantGmailIntegrationService.ts`, `backend/src/models/TenantIntegration.ts`
- **Evidence:** Commit `a98b3d0` (m5), `9857233` (m17)
- **Recommended Action:** Create — add as RFC-29 in RFC.md
- **Confidence:** High
