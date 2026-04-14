# Invoice State Machine & FE/BE Contracts

> Last updated: 2026-04-14
>
> This document is the source of truth for invoice lifecycle states, all API endpoints,
> FE/BE contracts, compliance enrichment, bank reconciliation, persona capabilities,
> and the extraction pipeline. Any change to state transitions or API contracts
> MUST be reflected here first.
>
> **Key invariant:** FAILED_PARSE invoices are never approvable. They can only be retried
> (re-enters PENDING) or deleted. This is enforced in both the backend `approveInvoices`
> query filter and the frontend `isInvoiceApprovable` guard.

---

## 1. Invoice Lifecycle State Machine

### 1.1 States

| State | Description | Editable | Approvable | Exportable | Deletable |
|-------|-------------|----------|------------|------------|-----------|
| `PENDING` | Ingested, awaiting OCR + SLM extraction | No | No | No | Yes |
| `PARSED` | Extraction succeeded, all required fields present, no risk flags | Yes | Yes | No | Yes |
| `NEEDS_REVIEW` | Extraction succeeded but warnings/risk flags present or fields incomplete | Yes | Yes | No | Yes |
| `AWAITING_APPROVAL` | Entered multi-step approval workflow | Yes | Via workflow | No | Yes |
| `FAILED_OCR` | OCR stage returned no text | No | No | No | Yes |
| `FAILED_PARSE` | SLM extraction stage failed | No | No | No | Yes |
| `APPROVED` | Human (or workflow) approved | No | N/A | Yes | Yes |
| `EXPORTED` | Exported to Tally XML or CSV | No (locked) | N/A | N/A | No |

### 1.2 State Diagram

```
                                 ┌──────────────┐
                                 │   PENDING     │
                                 └──────┬───────┘
                                        │ ingestion pipeline
                          ┌─────────────┼──────────────┐
                          │             │              │
                          v             v              v
                    ┌──────────┐ ┌────────────┐ ┌───────────┐
                    │FAILED_OCR│ │FAILED_PARSE│ │  PARSED   │
                    └──────────┘ └────────────┘ └─────┬─────┘
                          │             │              │
                          │             │       (if warnings or risk
                          │             │        flags or incomplete)
                          │             │              │
                          │             │              v
                          │             │       ┌─────────────┐
                          │             │       │NEEDS_REVIEW │
                          │             │       └──────┬──────┘
                          │             │              │
                          │             │     approve  │  approve
                          │             │  (no workflow)│  (no workflow)
                          │             │              v
                          │             │        ┌──────────┐
                          │             │        │ APPROVED  │
                          │             │        └─────┬────┘
                          │             │              │ export
                          │             │              v
                          │             │        ┌──────────┐
                          │             │        │ EXPORTED  │
                          │             │        └──────────┘
                          │             │
                          └──────┬──────┘
                                 │ retry
                                 v
                          ┌──────────┐
                          │ PENDING  │ (re-enters pipeline)
                          └──────────┘
```

**Workflow-gated path:**
```
PARSED / NEEDS_REVIEW ─── approve (workflow enabled) ──> AWAITING_APPROVAL
AWAITING_APPROVAL ─── all workflow steps pass ──> APPROVED
AWAITING_APPROVAL ─── step rejected ──> NEEDS_REVIEW
AWAITING_APPROVAL ─── field edit (PATCH) ──> NEEDS_REVIEW (workflow reset)
```

**Edit-triggered re-evaluation (PATCH /invoices/:id with parsed fields):**
```
AWAITING_APPROVAL ─── field edit ──> NEEDS_REVIEW (workflowState cleared)
PARSED ─── field edit ──> PARSED or NEEDS_REVIEW (re-assessed)
NEEDS_REVIEW ─── field edit ──> PARSED or NEEDS_REVIEW (re-assessed)
```

### 1.3 Transition Rules

| From | To | Trigger | Guard | Actor |
|------|----|---------|-------|-------|
| `PENDING` | `PARSED` | Pipeline: extraction succeeds, all required fields present, no risk flags | -- | System |
| `PENDING` | `NEEDS_REVIEW` | Pipeline: extraction succeeds but warnings or risk flags present | -- | System |
| `PENDING` | `FAILED_OCR` | Pipeline: OCR stage fails (no text extracted) | -- | System |
| `PENDING` | `FAILED_PARSE` | Pipeline: SLM extraction stage fails | -- | System |
| `PARSED` | `APPROVED` | `POST /invoices/approve` | Workflow disabled | canApproveInvoices |
| `PARSED` | `AWAITING_APPROVAL` | `POST /invoices/approve` | Workflow enabled, initiateWorkflow succeeds | canApproveInvoices |
| `NEEDS_REVIEW` | `APPROVED` | `POST /invoices/approve` | Workflow disabled | canApproveInvoices |
| `NEEDS_REVIEW` | `AWAITING_APPROVAL` | `POST /invoices/approve` | Workflow enabled, initiateWorkflow succeeds | canApproveInvoices |
| `AWAITING_APPROVAL` | `APPROVED` | `POST /invoices/:id/workflow-approve` | All workflow steps pass | canApproveInvoices |
| `AWAITING_APPROVAL` | `NEEDS_REVIEW` | `POST /invoices/:id/workflow-reject` | Step rejected (reason required) | canApproveInvoices |
| `AWAITING_APPROVAL` | `NEEDS_REVIEW` | `PATCH /invoices/:id` (field edit) | -- | canEditInvoiceFields |
| `PARSED` | `PARSED` or `NEEDS_REVIEW` | `PATCH /invoices/:id` (field edit) | Re-assessed by confidence scorer | canEditInvoiceFields |
| `NEEDS_REVIEW` | `PARSED` or `NEEDS_REVIEW` | `PATCH /invoices/:id` (field edit) | Re-assessed by confidence scorer | canEditInvoiceFields |
| `APPROVED` | `EXPORTED` | `POST /exports/tally` or `POST /exports/tally/download` or `POST /exports/csv` | Export succeeds | canExportToTally / canExportToCsv |
| `FAILED_OCR` | `PENDING` | `POST /invoices/retry` | -- | canRetryInvoices |
| `FAILED_PARSE` | `PENDING` | `POST /invoices/retry` | -- | canRetryInvoices |
| `NEEDS_REVIEW` | `PENDING` | `POST /invoices/retry` | -- | canRetryInvoices |
| `PARSED` | `PENDING` | `POST /invoices/retry` | -- | canRetryInvoices |
| Any except `EXPORTED` | deleted | `POST /invoices/delete` | -- | canDeleteInvoices |

### 1.4 Status Determination Logic

After extraction, status is determined by:
```
status = (warnings.length > 0 || confidence.riskFlags.length > 0) ? "NEEDS_REVIEW" : "PARSED"
```

After field edit (PATCH), status is re-determined by:
```
if (currentStatus === "AWAITING_APPROVAL") -> "NEEDS_REVIEW" (workflow cleared)
else if (currentStatus !== "APPROVED") ->
  isCompleteParsedData(parsed) && confidence.riskFlags.length === 0 ? "PARSED" : "NEEDS_REVIEW"
```

`isCompleteParsedData` requires: `invoiceNumber`, `vendorName`, `invoiceDate`, `currency`, and `totalAmountMinor > 0` (integer).

---

## 2. Extraction Pipeline (PENDING Processing)

The extraction pipeline runs during ingestion. It is the sole path from `PENDING` to `PARSED`/`NEEDS_REVIEW`/`FAILED_*`.

### 2.1 Pipeline Steps (in order)

```
1. Vendor Fingerprint Generation
   - Computes fingerprint key + layout signature from file buffer, mimeType, sourceKey, attachmentName
   - Used for vendor template matching and compliance enrichment

2. Vendor Template Lookup
   - Checks MongoDB for an existing VendorTemplateSnapshot matching this fingerprint
   - If found, template fields (vendorName, currency, invoicePrefix) can be applied

3. Language Detection (pre-OCR)
   - Examines filename, sourceKey, and file buffer for language signals
   - Determines language hint for OCR provider

4. OCR (via OcrProvider)
   - Sends file buffer to OCR service (DeepSeek MLX local or mock)
   - Returns: raw text, blocks (with bbox, bboxNormalized, bboxModel, page), page images, confidence
   - Failure here -> FAILED_OCR
   - Empty text -> FAILED_OCR

5. Language Detection (post-OCR)
   - Analyzes extracted text for language classification

6. Layout Graph Construction
   - Builds spatial graph from OCR blocks (nodes + edges + signature)

7. Extraction Text Candidate Assembly
   - Assembles up to 3 text representations:
     a. ocr-blocks: concatenated block text
     b. ocr-key-value-grounding: structured key-value pairs from block layout
     c. ocr-key-value-augmented: augmented grounding text with context

8. SLM Field Extraction (via FieldVerifier)
   - Sends best text + OCR blocks + page images to SLM
   - SLM returns: selected fields, block indices, GST breakdown, line items, PAN, bank details, Udyam number
   - Prior learning corrections provided as hints (assistive mode)
   - Failure here -> FAILED_PARSE

9. Deterministic Validation
   - Validates extracted fields (PAN format, GSTIN format, date ranges, amount sanity)

10. Compliance Enrichment (non-fatal)
    - See Section 6 for detailed pipeline
    - Failure here does NOT cause FAILED_PARSE; errors logged to processingIssues

11. Confidence Scoring
    - Formula: score = round(ocrScore * 0.65 + completenessScore * 0.35 - warningsPenalty - riskPenalty - compliancePenalty)
    - compliancePenalty = sum of risk signal confidencePenalty values (capped at 30)
    - Tone: green (>= 91), yellow (>= 60), red (< 60)
    - autoSelectForApproval: true if score >= autoSelectMin

12. Artifact Persistence (to S3/MinIO)
    - Preview page images (per-page PNG)
    - OCR block crop images (per-block PNG, cropped from page image using bbox)
    - Field overlay images (highlighted region on page for vendorName, invoiceNumber, etc.)

13. Invoice Document Persist
    - Upserts from PENDING status to PARSED or NEEDS_REVIEW
    - Stores: parsed fields, ocrBlocks, confidence, compliance, metadata, processingIssues
```

### 2.2 Bounding Box Generation Flow

OCR blocks carry three coordinate systems:

| Field | Range | Description |
|-------|-------|-------------|
| `bbox` | Absolute pixels or 0-1 normalized | Raw from OCR provider |
| `bboxNormalized` | 0.0 - 1.0 | Normalized coordinates (x1 < x2, y1 < y2) |
| `bboxModel` | 0 - 999 | Model-space coordinates (integer grid) |

Resolution order for cropping:
1. `bboxNormalized` (if valid 0-1 range)
2. `bboxModel` (divided by 999 to get normalized)
3. `bbox` as unit box (if values are 0-1)
4. `bbox` as absolute pixels (divided by page dimensions)

Crop generation uses `sharp` to extract the region from the page image buffer.

### 2.3 Line Item Extraction Flow

Line items are extracted by the SLM as part of field extraction (step 8):

1. SLM returns `lineItems` array in its selected output
2. Each item is validated: `description` (required string), `amountMinor` (required positive integer)
3. Optional fields: `hsnSac`, `quantity`, `rate`, `taxRate`, `cgstMinor`, `sgstMinor`, `igstMinor`
4. Amount strings are parsed via `parse_minor_units()` (handles commas, decimals, currency symbols)
5. Line items are stored in `parsed.lineItems` on the Invoice document

---

## 3. Complete API Endpoint Reference

### 3.1 Health (no auth)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/health` | Full health check (mongo + OCR + SLM) | None |
| `GET` | `/health/ready` | Readiness probe | None |

### 3.2 Auth (no auth required)

| Method | Path | Description | Auth | Request | Response |
|--------|------|-------------|------|---------|----------|
| `POST` | `/api/auth/token` | Login with email/password (ROPC) | None | `{ email, password }` | `{ token }` |
| `GET` | `/api/auth/login` | Redirect to Keycloak OIDC login | None | `?next=&login_hint=` | 302 redirect |
| `GET` | `/api/auth/callback` | OIDC callback handler | None | `?code=&state=` | 302 redirect to frontend with token |
| `POST` | `/api/auth/change-password` | Change password via Keycloak admin | Bearer token | `{ currentPassword, newPassword }` | `{ success: true }` |
| `GET` | `/api/auth/verify-email` | Email verification link handler | None | `?token=` | 302 redirect |

### 3.3 Bank Webhooks (no auth, pre-authenticate)

| Method | Path | Description | Auth | Response |
|--------|------|-------------|------|----------|
| `GET` | `/api/bank/aa-callback` | Account Aggregator consent callback | None | 302 redirect to `/` or `/?bank=error` |
| `GET` | `/api/bank/mock-callback` | Mock bank consent callback (dev) | None | 302 redirect |
| `POST` | `/api/bank/consent-notify` | AA consent notification webhook | None | `{ status: "ok" }` |
| `POST` | `/api/bank/fi-notify` | AA FI data notification webhook | None | `{ status: "ok" }` |

### 3.4 Gmail Public (no auth, pre-authenticate)

| Method | Path | Description | Auth | Response |
|--------|------|-------------|------|----------|
| `GET` | `/api/connect/gmail` | Initiate Gmail OAuth (uses `?token=` query param) | Token in query | 302 redirect to Google |
| `GET` | `/api/connect/gmail/callback` | Google OAuth callback | None | 302 redirect to frontend |

### 3.5 Session (authenticated)

| Method | Path | Guard | Request | Response |
|--------|------|-------|---------|----------|
| `GET` | `/api/session` | Authenticated | -- | `SessionContextResponse` (see below) |

```
SessionContextResponse {
  user: {
    id: string
    email: string
    role:
      | "PLATFORM_ADMIN"
      | "TENANT_ADMIN"
      | "ap_clerk"
      | "senior_accountant"
      | "ca"
      | "tax_specialist"
      | "firm_partner"
      | "ops_admin"
      | "audit_clerk"
    isPlatformAdmin: boolean
    capabilities: UserCapabilities
  }
  tenant: {
    id: string
    name: string
    onboarding_status: "pending" | "completed"
    mode: "test" | "live"
  }
  flags: {
    requires_tenant_setup: boolean
    requires_reauth: boolean
    requires_admin_action: boolean
    requires_email_confirmation: boolean
  }
}
```

### 3.6 Platform Admin

All routes require `requirePlatformAdmin` middleware.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `POST` | `/api/platform/tenants/onboard-admin` | `{ tenantName, adminEmail, adminDisplayName?, mode? }` | `{ tenantId, tenantName, adminUserId, adminEmail, tempPassword? }` (201) |
| `PATCH` | `/api/platform/tenants/:tenantId/enabled` | `{ enabled: boolean }` | `{ tenantId, enabled }` |
| `GET` | `/api/platform/tenants/usage` | -- | `{ items: PlatformTenantUsageSummary[] }` |

### 3.7 Tenant Lifecycle

All routes require `requireNonPlatformAdmin`.

| Method | Path | Guard | Request | Response |
|--------|------|-------|---------|----------|
| `POST` | `/api/tenant/onboarding/complete` | requireTenantAdmin | `{ tenantName, adminEmail? }` | 204 |
| `POST` | `/api/tenant/invites/accept` | Authenticated | `{ token }` | 204 |

### 3.8 Tenant Admin (User Management)

All routes require `requireNonPlatformAdmin` + `requireCap("canManageUsers")`.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `GET` | `/api/admin/users` | -- | `{ items: TenantUserSummary[] }` |
| `POST` | `/api/admin/users/invite` | `{ email }` | Invite object (201) |
| `POST` | `/api/admin/users/:userId/role` | `{ role: "TENANT_ADMIN" | "ap_clerk" | "senior_accountant" | "ca" | "tax_specialist" | "firm_partner" | "ops_admin" | "audit_clerk" }` | 204 |
| `PATCH` | `/api/admin/users/:userId/enabled` | `{ enabled: boolean }` | `{ userId, enabled }` |
| `DELETE` | `/api/admin/users/:userId` | -- | 204 |
| `GET` | `/api/admin/mailboxes` | -- | `{ items: TenantMailbox[] }` |
| `POST` | `/api/admin/mailboxes/:id/assign` | `{ userId }` | 204 |
| `DELETE` | `/api/admin/mailboxes/:id/assign/:userId` | -- | 204 |
| `DELETE` | `/api/admin/mailboxes/:id` | -- | 204 |
| `GET` | `/api/admin/users/:userId/viewer-scope` | -- | ViewerScope object |
| `PUT` | `/api/admin/users/:userId/viewer-scope` | `{ visibleUserIds: string[] }` | ViewerScope object |

### 3.9 Invoices

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `GET` | `/api/invoices` | -- | Query: `page, limit, status, workloadTier, from, to, approvedBy, sortBy, sortDir` | `InvoiceListResponse` |
| `GET` | `/api/invoices/:id` | -- | -- | `Invoice` (full, with ocrText/ocrBlocks) |
| `POST` | `/api/invoices/approve` | canApproveInvoices | `{ ids: string[], approvedBy? }` | `{ modifiedCount }` |
| `POST` | `/api/invoices/retry` | canRetryInvoices | `{ ids: string[] }` | `{ modifiedCount }` |
| `POST` | `/api/invoices/delete` | canDeleteInvoices | `{ ids: string[] }` | `{ deletedCount }` |
| `PATCH` | `/api/invoices/:id` | canEditInvoiceFields | See Section 3.9.1 | Updated `Invoice` |
| `GET` | `/api/invoices/:id/document` | -- | -- | Binary file (original document) |
| `GET` | `/api/invoices/:id/preview` | -- | `?page=` | Binary image (preview) |
| `GET` | `/api/invoices/:id/ocr-blocks/:index/crop` | -- | -- | Binary image (block crop) |
| `GET` | `/api/invoices/:id/source-overlays/:field` | -- | field in: vendorName, invoiceNumber, invoiceDate, dueDate, totalAmountMinor, currency | Binary image (field overlay) |

#### 3.9.1 PATCH /api/invoices/:id

This endpoint handles three distinct mutation types based on request body shape:

**A. Rename attachment:**
```
{ attachmentName: string }
```

**B. Edit parsed fields:**
```
{
  parsed: {
    invoiceNumber?: string | null
    vendorName?: string | null
    invoiceDate?: string | null
    dueDate?: string | null
    currency?: string | null
    totalAmountMinor?: number | null
    totalAmountMajor?: string | number | null
    notes?: string[] | null
  }
  updatedBy?: string
}
```

**C. Compliance override (any of these fields present):**
```
{
  glCode?: string              // GL code override -> compliance.glCode.source = "manual"
  tdsSection?: string          // TDS section override -> compliance.tds.source = "manual"
  vendorBankVerified?: boolean  // Verify bank change -> clears VENDOR_BANK_CHANGED signal
  dismissRiskSignal?: string   // Signal code to dismiss -> signal.status = "dismissed"
}
```

Guards: 403 if invoice is `EXPORTED`. 404 if not found or wrong tenant.

Side effects:
- Field edits trigger extraction learning correction recording
- Field edits re-assess confidence score, tone, riskFlags
- GL code override records usage in VendorGlMapping
- Compliance overrides update the compliance subdocument in-place

### 3.10 Approval Workflow

Requires `requireNonPlatformAdmin` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `GET` | `/api/admin/approval-workflow` | canConfigureWorkflow | -- | `ApprovalWorkflowConfig` |
| `PUT` | `/api/admin/approval-workflow` | canConfigureWorkflow | `ApprovalWorkflowConfig` | `ApprovalWorkflowConfig` |
| `POST` | `/api/invoices/:id/workflow-approve` | canApproveInvoices | -- | `{ advanced: boolean, ... }` |
| `POST` | `/api/invoices/:id/workflow-reject` | canApproveInvoices | `{ reason: string }` | `{ rejected: true }` |

```
ApprovalWorkflowConfig {
  enabled: boolean
  mode: "simple" | "advanced"
  simpleConfig: {
    requireManagerReview: boolean
    requireFinalSignoff: boolean
  }
  steps: WorkflowStep[]
}

WorkflowStep {
  order: number
  name: string
  approverType: "any_member" | "role" | "specific_users"
  approverRole?: string
  approverUserIds?: string[]
  rule: "any" | "all"
  condition?: {
    field: string
    operator: "gt" | "gte" | "lt" | "lte"
    value: number
  } | null
}
```

### 3.11 Jobs (Ingestion)

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `GET` | `/api/jobs/ingest/status` | -- | -- | `IngestionJobStatus` |
| `GET` | `/api/jobs/ingest/sse` | -- | -- | SSE stream of `IngestionJobStatus` |
| `POST` | `/api/jobs/ingest` | canStartIngestion | -- | `IngestionJobStatus` (202) |
| `POST` | `/api/jobs/ingest/pause` | requireNotViewer | -- | `IngestionJobStatus` |
| `POST` | `/api/jobs/ingest/email-simulate` | requireNotViewer | -- | `IngestionJobStatus` (202) |
| `POST` | `/api/jobs/upload` | canUploadFiles | multipart/form-data `files` (max 50 files, 20MB each, .pdf/.jpg/.jpeg/.png) | `{ uploaded: string[], count }` (201) |

```
IngestionJobStatus {
  state: "idle" | "running" | "completed" | "failed" | "paused"
  running: boolean
  totalFiles: number
  processedFiles: number
  newInvoices: number
  duplicates: number
  failures: number
  startedAt?: string
  completedAt?: string
  error?: string
  correlationId?: string
  lastUpdatedAt: string
}
```

### 3.12 Exports

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `POST` | `/api/exports/tally` | canExportToTally | `{ ids?: string[] }` | Export result |
| `POST` | `/api/exports/tally/download` | canExportToTally | `{ ids?: string[] }` | `TallyFileExportResponse` |
| `GET` | `/api/exports/tally/download/:batchId` | -- | -- | Binary XML file |
| `GET` | `/api/exports/tally/history` | -- | `?page=&limit=` | `ExportHistoryResponse` |
| `POST` | `/api/exports/csv` | canExportToCsv | `{ ids?: string[], columns?: string[] }` | CSV file download |

```
TallyFileExportResponse {
  batchId?: string
  fileKey?: string
  filename?: string
  total: number
  includedCount: number
  skippedCount: number
  skippedItems: Array<{ invoiceId, success, externalReference?, error? }>
}

ExportHistoryResponse {
  items: ExportBatchSummary[]
  page: number
  limit: number
  total: number
}
```

### 3.13 Analytics

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `GET` | `/api/analytics/overview` | `?from=&to=&scope=mine|all` | `AnalyticsOverview` |

```
AnalyticsOverview {
  kpis: {
    totalInvoices, approvedCount, approvedAmountMinor,
    pendingAmountMinor, exportedCount, needsReviewCount
  }
  dailyApprovals: DailyStat[]
  dailyIngestion: DailyStat[]
  dailyExports: DailyStat[]
  statusBreakdown: StatusStat[]
  topVendorsByApproved: VendorStat[]
  topVendorsByPending: VendorStat[]
}
```

### 3.14 Gmail Integration

| Method | Path | Guard | Request | Response |
|--------|------|-------|---------|----------|
| `GET` | `/api/integrations/gmail` | Authenticated, non-platform-admin | -- | `GmailConnectionStatus` |
| `GET` | `/api/mailbox/gmail/connection` | Authenticated, non-platform-admin | -- | `GmailConnectionStatus` (duplicate endpoint) |
| `GET` | `/api/integrations/gmail/connect-url` | requireTenantAdmin | -- | `{ connectUrl, tenantId }` |
| `PUT` | `/api/integrations/gmail/:id/polling` | requireTenantAdmin | `{ enabled, intervalHours }` | `{ enabled, intervalHours }` |

```
GmailConnectionStatus {
  provider: "gmail"
  connectionState: "CONNECTED" | "NEEDS_REAUTH" | "DISCONNECTED"
  emailAddress?: string
  lastErrorReason?: string
  lastSyncedAt?: string
}
```

### 3.15 Bank Accounts

Requires `requireNonPlatformAdmin` + `requireTenantAdmin`.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `GET` | `/api/bank/accounts` | -- | `{ items: BankAccount[] }` |
| `POST` | `/api/bank/accounts` | `{ aaAddress, displayName? }` | `{ _id, redirectUrl }` (201) |
| `DELETE` | `/api/bank/accounts/:id` | -- | 204 |
| `POST` | `/api/bank/accounts/:id/refresh` | -- | `{ balanceMinor, bankName, maskedAccNumber, balanceFetchedAt }` |

```
BankAccount {
  _id: string
  tenantId: string
  status: "pending_consent" | "active" | "paused" | "revoked" | "expired" | "error"
  aaAddress: string
  displayName?: string
  bankName?: string
  maskedAccNumber?: string
  balanceMinor?: number
  currency: string       // default "INR"
  balanceFetchedAt?: string
  lastErrorReason?: string
  createdAt: string
}
```

### 3.16 GL Codes

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `GET` | `/api/admin/gl-codes` | -- | `?search=&category=&active=&page=&limit=` | `{ items: GlCode[], page, limit, total }` |
| `POST` | `/api/admin/gl-codes` | canConfigureGlCodes | `{ code, name, category, linkedTdsSection?, parentCode? }` | `GlCode` (201) |
| `PUT` | `/api/admin/gl-codes/:code` | canConfigureGlCodes | `Partial<{ name, category, linkedTdsSection, parentCode, isActive }>` | `GlCode` |
| `DELETE` | `/api/admin/gl-codes/:code` | canConfigureGlCodes | -- | `GlCode` (soft-delete: isActive=false) |

### 3.17 TDS Rates

Requires `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `GET` | `/api/compliance/tds-rates` | -- | -- | `{ items: TdsRate[] }` |
| `PUT` | `/api/compliance/tds-rates/:section` | canConfigureTdsMappings | `Partial<{ rateCompanyBps, rateIndividualBps, rateNoPanBps, thresholdSingleMinor, thresholdAnnualMinor }>` | New `TdsRate` record |

### 3.18 Vendors

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Guard | Request | Response |
|--------|------|-------|---------|----------|
| `GET` | `/api/vendors` | -- | `?search=&hasPan=&hasMsme=&page=&limit=` | `{ items: VendorSummary[], page, limit, total }` |
| `GET` | `/api/vendors/:id` | requireTenantAdmin | -- | Full `VendorMaster` document |

### 3.19 Tenant Compliance Config

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `GET` | `/api/admin/compliance-config` | canConfigureCompliance | -- | `TenantComplianceConfig` |
| `PUT` | `/api/admin/compliance-config` | canConfigureCompliance | `Partial<TenantComplianceConfig>` | `TenantComplianceConfig` |

```
TenantComplianceConfig {
  complianceEnabled: boolean
  autoSuggestGlCodes: boolean
  autoDetectTds: boolean
  disabledSignals: string[]
  enabledSignals: string[]
  signalSeverityOverrides: Record<string, "info" | "warning" | "critical">
  defaultTdsSection: string | null
}
```

### 3.20 Cost Centers

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `GET` | `/api/admin/cost-centers` | -- | `?active=` | `{ items: CostCenter[], total }` |
| `POST` | `/api/admin/cost-centers` | canManageCostCenters | `{ code, name, department?, linkedGlCodes? }` | `CostCenter` (201) |
| `PUT` | `/api/admin/cost-centers/:code` | canManageCostCenters | `Partial<{ name, department, linkedGlCodes, isActive }>` | `CostCenter` |
| `DELETE` | `/api/admin/cost-centers/:code` | canManageCostCenters | -- | `CostCenter` (soft-delete: isActive=false) |

### 3.21 Compliance Reports

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `GET` | `/api/reports/tds-summary` | canDownloadComplianceReports | `?from=&to=&format=csv` | JSON `{ items, total }` or CSV file |
| `GET` | `/api/reports/vendor-health` | canDownloadComplianceReports | `?format=csv` | JSON `{ totalVendors, missingPan, recentBankChanges, msmeVendors }` or CSV file |

### 3.22 Compliance Analytics

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `GET` | `/api/analytics/compliance` | `?from=&to=` | `ComplianceAnalytics` |

```
ComplianceAnalytics {
  tdsSummary: {
    totalAmountMinor: number
    bySection: Array<{ section, count, amountMinor }>
    overrideRate: number
  }
  glDistribution: Array<{ code, name, count, amountMinor }>
  riskSignalFrequency: Array<{ code, count, actionRate }>
  panCoverage: { total, withValidPan, percentage }
  vendorHealth: { missingPan, recentBankChanges, msmeVendors }
}
```

### 3.23 Vendor Communication

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `POST` | `/api/invoices/:id/vendor-email` | canSendVendorEmails | `{ trigger, vendorEmail }` | Email draft object |
| `GET` | `/api/admin/vendor-email-templates` | -- | -- | `{ triggers: string[] }` |

### 3.24 CSV Export

Requires `requireNonPlatformAdmin` + `requireTenantSetupCompleted` + `requireAuth`.

| Method | Path | Capability Guard | Request | Response |
|--------|------|-----------------|---------|----------|
| `POST` | `/api/exports/csv` | canExportToCsv | `{ ids?: string[], columns?: string[] }` | CSV file (Content-Type: text/csv) |

---

## 4. Invoice Document Shape

### 4.1 Full Invoice (detail endpoint)

Backend source: `InvoiceModel` -> `sanitizeForApi()` (strips nulls) -> JSON.
Frontend type: `frontend/src/types.ts` -> `Invoice` interface.

```
Invoice {
  _id: string
  tenantId: string
  workloadTier: "standard" | "heavy"
  sourceType: string
  sourceKey: string
  sourceDocumentId: string
  attachmentName: string
  contentHash?: string
  mimeType: string
  receivedAt: string

  ocrProvider?: string
  ocrText?: string
  ocrConfidence?: number
  ocrBlocks?: Array<{
    text: string
    page: number
    bbox: [number, number, number, number]
    bboxNormalized?: [number, number, number, number]
    bboxModel?: [number, number, number, number]
    blockType?: string
    cropPath?: string
  }>
  ocrTokens?: number
  slmTokens?: number

  confidenceScore: number
  confidenceTone: "red" | "yellow" | "green"
  autoSelectForApproval: boolean
  riskFlags: Array<"TOTAL_AMOUNT_ABOVE_EXPECTED" | "DUE_DATE_TOO_FAR">
  riskMessages: string[]

  parsed?: {
    invoiceNumber?: string
    vendorName?: string
    invoiceDate?: string
    dueDate?: string
    totalAmountMinor?: number       // integer minor units (cents/paise)
    currency?: string
    notes?: string[]
    gst?: {
      gstin?: string
      subtotalMinor?: number
      cgstMinor?: number
      sgstMinor?: number
      igstMinor?: number
      cessMinor?: number
      totalTaxMinor?: number
    }
    pan?: string
    bankAccountNumber?: string
    bankIfsc?: string
    lineItems?: Array<{
      description: string
      hsnSac?: string
      quantity?: number
      rate?: number
      amountMinor: number
      taxRate?: number
      cgstMinor?: number
      sgstMinor?: number
      igstMinor?: number
    }>
  }

  status: InvoiceStatus
  processingIssues: string[]

  approval?: {
    approvedBy?: string
    approvedAt?: string
    userId?: string
    email?: string
    role?: string
  }

  workflowState?: {
    workflowId?: string
    currentStep?: number
    status?: "in_progress" | "approved" | "rejected"
    stepResults?: Array<{
      step: number
      name: string
      action: "approved" | "rejected" | "skipped"
      userId?: string
      email?: string
      role?: string
      timestamp: string
      note?: string
    }>
  }

  export?: {
    system?: string
    batchId?: string
    exportedAt?: string
    externalReference?: string
    error?: string
  }

  compliance?: InvoiceCompliance    // full on detail, absent on list
  complianceSummary?: {             // present on list items only
    tdsSection: string | null
    glCode: string | null
    riskSignalCount: number
    riskSignalMaxSeverity: "info" | "warning" | "critical" | null
  }

  metadata?: Record<string, string>
  gmailMessageId?: string
  possibleDuplicate?: boolean       // injected at list time if contentHash matches another

  createdAt: string
  updatedAt: string
}
```

### 4.2 InvoiceCompliance Subdocument

```
InvoiceCompliance {
  pan?: {
    value: string | null
    source: "extracted" | "vendor-master" | "manual"
    validationLevel: "L1" | "L2" | "L3" | null
    validationResult: "valid" | "format-invalid" | "gstin-mismatch" | "struck-off" | null
    gstinCrossRef: boolean
  }
  tds?: {
    section: string | null
    rate: number | null                 // basis points
    amountMinor: number | null          // TDS amount in minor units
    netPayableMinor: number | null      // totalAmount - tdsAmount
    source: "auto" | "manual"
    confidence: "high" | "medium" | "low"
  }
  tcs?: {
    rate: number | null
    amountMinor: number | null
    source: "extracted" | "configured" | "manual"
  }
  glCode?: {
    code: string | null
    name: string | null
    source: "vendor-default" | "description-match" | "category-default" | "manual"
    confidence: number | null           // 0-100
    suggestedAlternatives?: Array<{ code: string, name: string, score: number }>
  }
  costCenter?: {
    code: string | null
    name: string | null
    source: "vendor-default" | "gl-linked" | "manual"
    confidence: number | null
  }
  irn?: {
    value: string | null
    valid: boolean | null
  }
  msme?: {
    udyamNumber: string | null
    classification: "micro" | "small" | "medium" | null
    paymentDeadline: Date | null
  }
  vendorBank?: {
    accountHash: string | null
    ifsc: string | null
    bankName: string | null
    isChanged: boolean
    verifiedChange: boolean
  }
  riskSignals?: Array<{
    code: string
    category: "financial" | "compliance" | "fraud" | "data-quality"
    severity: "info" | "warning" | "critical"
    message: string
    confidencePenalty: number
    status: "open" | "dismissed" | "acted-on"
    resolvedBy: string | null
    resolvedAt: string | null
  }>
  reconciliation?: {
    bankTransactionId: string | null
    verifiedByStatement: boolean
    matchedAt: Date | null
  }
}
```

### 4.3 Invoice List Response

```
InvoiceListResponse {
  items: Invoice[]          // stripped: no ocrText, no ocrBlocks, no compliance (replaced by complianceSummary)
  page: number
  limit: number
  total: number             // count matching current status filter
  totalAll?: number
  approvedAll?: number
  pendingAll?: number       // PARSED + NEEDS_REVIEW
  failedAll?: number        // FAILED_OCR + FAILED_PARSE
  needsReviewAll?: number
  parsedAll?: number
  awaitingApprovalAll?: number
  failedOcrAll?: number
  failedParseAll?: number
  exportedAll?: number
}
```

---

## 5. Role & Capability System

### 5.1 Roles

| Role | Scope | Description |
|------|-------|-------------|
| `PLATFORM_ADMIN` | Cross-tenant | Can onboard tenants, enable/disable tenants, view usage. Cannot access any tenant-level features. |
| `TENANT_ADMIN` | Single tenant | Full access to all tenant features. All capabilities set to true. |
| `ap_clerk` | Single tenant | AP execution role for invoice handling and operational approval. |
| `senior_accountant` | Single tenant | Extended AP role with higher limits and finance controls. |
| `ca` | Single tenant | Compliance authority with broad permissions except user and connection admin. |
| `tax_specialist` | Single tenant | Compliance-focused role with no invoice approval permission. |
| `firm_partner` | Single tenant | Business sign-off role with broad permissions except connection admin. |
| `ops_admin` | Single tenant | Infra/operator role for user + connection administration. |
| `audit_clerk` | Single tenant | Read-only compliance and audit visibility role. |

### 5.2 Role Defaults

Role name is the source of capability defaults. There is no separate `persona` overlay field.
Defaults are resolved by `getRoleDefaults(role)` and merged with stored capability overrides.

| Role | Description | Key Permissions |
|------|-------------|-----------------|
| `ap_clerk` | Accounts Payable clerk | Approve (up to 1L), edit, delete, retry, upload, ingest, GL override, export (Tally + CSV), vendor email |
| `senior_accountant` | Senior accountant | Approve (up to 10L), all of ap_clerk + TDS override, GL config, compliance reports, cost centers |
| `ca` | Chartered Accountant | All permissions except manage users and manage connections |
| `tax_specialist` | Tax specialist | Edit fields, TDS/GL override, TDS config, GL config, compliance reports, compliance config, cost centers, view all |
| `firm_partner` | Firm partner | All permissions except manage connections |
| `ops_admin` | Operations admin | Manage users, manage connections, start ingestion only |
| `audit_clerk` | Audit clerk | Read-only: compliance reports and view all invoices |

### 5.3 All 22 Capabilities

| Capability | Type | Description |
|------------|------|-------------|
| `approvalLimitMinor` | `number | null` | Max invoice amount (minor units) this user can approve. `null` = unlimited. `0` = cannot approve. |
| `canApproveInvoices` | boolean | Approve invoices (simple or workflow step) |
| `canEditInvoiceFields` | boolean | Edit parsed fields, compliance overrides |
| `canDeleteInvoices` | boolean | Delete invoices |
| `canRetryInvoices` | boolean | Retry failed invoices |
| `canUploadFiles` | boolean | Upload invoice files |
| `canStartIngestion` | boolean | Trigger ingestion run |
| `canOverrideTds` | boolean | Override TDS section on invoice |
| `canOverrideGlCode` | boolean | Override GL code on invoice |
| `canSignOffCompliance` | boolean | Sign off compliance for approval |
| `canConfigureTdsMappings` | boolean | Edit TDS rate table |
| `canConfigureGlCodes` | boolean | Create/edit/delete GL codes |
| `canManageUsers` | boolean | Invite, assign roles, enable/disable, remove users; manage mailboxes; manage viewer scopes |
| `canManageConnections` | boolean | Gmail connection, bank account management |
| `canExportToTally` | boolean | Export to Tally XML |
| `canExportToCsv` | boolean | Export to CSV |
| `canDownloadComplianceReports` | boolean | Download TDS summary, vendor health reports |
| `canViewAllInvoices` | boolean | View all invoices (not just own) |
| `canConfigureWorkflow` | boolean | Read/write approval workflow config |
| `canConfigureCompliance` | boolean | Read/write tenant compliance config |
| `canManageCostCenters` | boolean | Create/edit/delete cost centers |
| `canSendVendorEmails` | boolean | Generate vendor communication drafts |

### 5.4 Default Capability Summary by Role

| Role | approvalLimitMinor | Key enabled capabilities |
|------|--------------------|--------------------------|
| `TENANT_ADMIN` | null | All capabilities enabled |
| `ap_clerk` | 10,000,000 | approve, edit, delete, retry, upload, ingest, GL override, export, vendor email |
| `senior_accountant` | 100,000,000 | ap_clerk + TDS override, GL config, reports, cost centers |
| `ca` | null | All except `canManageUsers`, `canManageConnections` |
| `tax_specialist` | 0 | edit + compliance controls; no approval |
| `firm_partner` | null | All except `canManageConnections` |
| `ops_admin` | 0 | `canManageUsers`, `canManageConnections`, `canStartIngestion` |
| `audit_clerk` | 0 | `canDownloadComplianceReports`, `canViewAllInvoices` |

Exact per-flag values are defined in `backend/src/auth/personaDefaults.ts`.

### 5.5 Capability Resolution

1. Load `TenantUserRole` document for `(tenantId, userId)`
2. Get role defaults from `getRoleDefaults(role)`
3. If stored capabilities exist, merge: `{ ...defaults, ...storedCaps }` (stored values override defaults)
4. If no stored capabilities, use role defaults directly
5. Cached per-request via `WeakMap<Request, UserCapabilities>`

---

## 6. Compliance Enrichment Pipeline

### 6.1 Trigger

Compliance enrichment runs as step 10 of the extraction pipeline (Section 2.1), within the `PENDING -> PARSED/NEEDS_REVIEW` transition.

**Pre-condition:** `TenantComplianceConfig.complianceEnabled === true` for the tenant. If disabled, returns empty result.

**Failure behavior:** Non-fatal. Errors are logged to `processingIssues`. The invoice proceeds without compliance data.

### 6.2 Pipeline Steps (in order)

```
1. PAN Validation (PanValidationService)
   - Input: extracted PAN, GSTIN
   - L1: regex format validation (AAAAA0000A)
   - L2: PAN-GSTIN cross-reference (characters 3-12 of GSTIN should match PAN)
   - Output: CompliancePanResult
   - Risk signals: PAN_MISSING, PAN_FORMAT_INVALID, PAN_GSTIN_MISMATCH

2. Vendor Master Upsert (VendorMasterService)
   - Input: vendor name, PAN, GSTIN, bank account, bank IFSC, email domain
   - Upserts VendorMaster document by tenant + vendor fingerprint
   - Tracks bank history, email domains, aliases

3. Bank Change Detection (VendorMasterService)
   - Input: current bank account number + IFSC
   - Compares against vendor's stored bank details
   - Output: ComplianceVendorBankResult (accountHash, ifsc, bankName, isChanged)
   - Risk signal: VENDOR_BANK_CHANGED (severity: critical, penalty: 10)

4. GL Code Suggestion (GlCodeSuggestionService)
   - Input: vendor fingerprint, invoice parsed data
   - Strategy: frequency-based lookup from VendorGlMapping, then description match fallback
   - Only runs if config.autoSuggestGlCodes !== false
   - Output: ComplianceGlCodeResult with suggestedAlternatives

5. Cost Center Suggestion (CostCenterService)
   - Input: vendor fingerprint, GL code
   - Strategy: vendor default -> GL-linked fallback
   - Output: ComplianceCostCenterResult

6. TDS Detection + Calculation (TdsCalculationService)
   - Input: invoice parsed data, GL category
   - Only runs if config.autoDetectTds !== false
   - Looks up TDS section from GL code linkedTdsSection or config.defaultTdsSection
   - Calculates: rate (basis points), amountMinor, netPayableMinor
   - netPayableMinor = totalAmountMinor - tdsAmountMinor
   - Output: ComplianceTdsResult
   - Risk signals: TDS_HIGH_AMOUNT, etc.

7. IRN Validation (IrnValidationService)
   - Input: IRN value (if extracted), GSTIN, total amount
   - Format check + presence check (threshold: INR 5 Crore)
   - Output: ComplianceIrnResult

8. MSME Tracking (MsmeTrackingService)
   - Input: Udyam number (if extracted), invoice date
   - Updates vendor master MSME classification
   - Calculates payment deadline (30 days micro/small, 45 days medium)
   - Output: ComplianceMsmeResult
   - Risk signals: MSME payment deadline alerts

9. Email Sender Detection
   - Input: context.emailFrom (from ingestion metadata)
   - Checks sender domain against vendor's known email domains
   - Risk signals:
     - SENDER_FREEMAIL: Freemail provider when vendor used corporate email
     - SENDER_DOMAIN_MISMATCH: Unknown domain for this vendor
     - SENDER_FIRST_TIME: First invoice from this email domain (info)

10. Duplicate Invoice Detection (DuplicateInvoiceDetector)
    - Input: vendor name, invoice number, content hash
    - Checks for same vendor + invoice number + different content
    - Risk signals: DUPLICATE_INVOICE_NUMBER

11. Signal Filtering
    - Removes signals in config.disabledSignals
    - Applies severity overrides from config.signalSeverityOverrides
```

### 6.3 Compliance Risk Signals Reference

| Code | Category | Default Severity | Penalty | Trigger |
|------|----------|-----------------|---------|---------|
| `PAN_MISSING` | compliance | warning | varies | No PAN extracted or in vendor master |
| `PAN_FORMAT_INVALID` | compliance | warning | varies | PAN fails regex validation |
| `PAN_GSTIN_MISMATCH` | compliance | critical | varies | PAN does not match GSTIN characters |
| `VENDOR_BANK_CHANGED` | fraud | critical | 10 | Bank details differ from previous invoice |
| `SENDER_FREEMAIL` | fraud | warning | 4 | Freemail sender when vendor used corporate |
| `SENDER_DOMAIN_MISMATCH` | fraud | warning | 4 | Unknown email domain for vendor |
| `SENDER_FIRST_TIME` | fraud | info | 0 | First email domain for vendor |
| `DUPLICATE_INVOICE_NUMBER` | data-quality | warning | varies | Same vendor + invoice number seen before |
| `TDS_HIGH_AMOUNT` | financial | warning | varies | TDS amount exceeds expected threshold |

Confidence penalty cap: 30 points maximum (applied via `RiskSignalEvaluator.sumPenalties()`).

---

## 7. Bank Statement Reconciliation

### 7.1 Data Models

**BankStatement:**
```
{
  tenantId: string
  fileName: string
  bankName: string | null
  accountNumberMasked: string | null
  periodFrom: string | null
  periodTo: string | null
  transactionCount: number
  matchedCount: number
  unmatchedCount: number
  source: "pdf-parsed" | "csv-import"
  uploadedBy: string
  createdAt, updatedAt
}
```

**BankTransaction:**
```
{
  tenantId: string
  statementId: string
  date: string
  description: string
  reference: string | null
  debitMinor: number | null
  creditMinor: number | null
  balanceMinor: number | null
  matchedInvoiceId: string | null
  matchConfidence: number | null
  matchStatus: "matched" | "suggested" | "unmatched" | "manual"
  source: "parsed" | "csv-import"
  createdAt, updatedAt
}
```

### 7.2 Reconciliation Flow

```
1. Bank Statement Upload
   - Statement file (PDF or CSV) is uploaded
   - BankStatement record created
   - Transactions are parsed and BankTransaction records created

2. Auto-Reconcile (ReconciliationService.reconcileStatement)
   - For each unmatched debit transaction:
     a. Find candidate invoices where:
        - status is APPROVED or EXPORTED
        - compliance.tds.netPayableMinor is within +/- 100 of transaction debitMinor
     b. Score each candidate:
        - Exact amount match (within 1 unit): +50 points
        - Near amount match: +30 points
        - Invoice number found in description: +30 points
        - Vendor name found in description: +20 points
        - Approval date within 3 days of txn date: +10 points
        - Approval date within 7 days: +5 points
     c. Best candidate with score > 50: auto-match
        Best candidate with score 30-50: mark as "suggested"
        Otherwise: "unmatched"

3. Apply Match
   - BankTransaction: matchedInvoiceId, matchConfidence, matchStatus="matched"
   - Invoice: compliance.reconciliation = {
       bankTransactionId, verifiedByStatement: true, matchedAt
     }
   - processingIssues: "Bank payment verified: matched to transaction {id} (confidence {score})"

4. Manual Match (ReconciliationService.manualMatch)
   - Same as applyMatch but confidence=100 and matchStatus="manual"
```

### 7.3 Bank Statement API Endpoints

| Method | Path | Capability | Description |
|--------|------|-----------|-------------|
| GET | `/api/bank-statements` | Any authenticated | List bank statements for tenant |
| GET | `/api/bank-statements/:id/transactions` | Any authenticated | List transactions with pagination + status filter |
| POST | `/api/bank-statements/upload-csv` | `canManageConnections` | Upload CSV file + auto-reconcile. Request: multipart with `file` + optional `columnMapping` JSON. Response: `{ statementId, transactionCount, matched, suggested, unmatched }` |
| POST | `/api/bank-statements/:id/reconcile` | `canManageConnections` | Re-run auto-reconciliation on existing statement |
| POST | `/api/bank-statements/transactions/:txnId/match` | `canApproveInvoices` | Manual match transaction to invoice. Request: `{ invoiceId }` |

### 7.4 TCS in Reconciliation Math

The reconciliation matching uses `compliance.tds.netPayableMinor` as the expected payment amount:

```
netPayableMinor = totalAmountMinor - tdsAmountMinor
```

When TCS (Tax Collected at Source) is present on the invoice:
```
ComplianceTcsResult {
  rate: number | null           // TCS rate
  amountMinor: number | null    // TCS amount in minor units
  source: "extracted" | "configured" | "manual"
}
```

The TCS type is defined in `backend/src/types/invoice.ts` as `ComplianceTcsResult` and is stored in the compliance subdocument at `compliance.tcs`. The Invoice Mongoose schema includes the `tcs` field on the compliance subdocument (though the enrichment pipeline does not currently auto-populate it; it is available for manual override or future extraction).

The reconciliation service matches on `compliance.tds.netPayableMinor`. If TCS is applied, the actual bank debit would be:

```
actualPayment = totalAmountMinor - tdsAmountMinor + tcsAmountMinor
```

TCS must be factored in when comparing against bank debits for accurate matching.

---

## 8. Type Sharing Strategy

Types are duplicated, not shared. Backend types live in `backend/src/types/invoice.ts`. Frontend types live in `frontend/src/types.ts`. Frontend API calls live in `frontend/src/api.ts`. There is no shared package or code generation.

**Risk:** A backend field addition that is not mirrored in `frontend/src/types.ts` is silently available but not type-checked. A backend field removal or rename causes a runtime error.

**Key files for any contract change:**
- Backend types: `backend/src/types/invoice.ts`
- Backend model: `backend/src/models/Invoice.ts`
- Backend routes: `backend/src/routes/*.ts`
- Backend services: `backend/src/services/invoiceService.ts`, `backend/src/services/ingestionService.ts`
- Frontend types: `frontend/src/types.ts`
- Frontend API: `frontend/src/api.ts`
- Frontend views: `frontend/src/components/tenantAdmin/TenantInvoicesView.tsx`

---

## 9. Sync Checklist

When modifying any contract, update ALL of these:

| Change | Backend | Frontend | This Document |
|--------|---------|----------|---------------|
| New field on Invoice | `models/Invoice.ts` schema + `types/invoice.ts` interface | `types.ts` Invoice interface | Section 4 |
| New API endpoint | `routes/*.ts` + `app.ts` registration | API call in `api.ts` + response type in `types.ts` | Section 3 |
| New risk signal code | `ComplianceEnrichmentService.ts` or sub-service | `types.ts` riskSignals type | Section 6.3 |
| State transition change | `invoiceService.ts` query conditions | UI action guards | Section 1.3 |
| New invoice status | `types/invoice.ts` InvoiceStatuses array | `types.ts` InvoiceStatus union | Section 1.1 |
| SSE event shape change | `IngestionJobOrchestrator.ts` | `types.ts` IngestionJobStatus | Section 3.11 |
| New capability | `personaDefaults.ts` UserCapabilities interface + ROLE_DEFAULTS | `types.ts` UserCapabilities | Section 5.3 |
| New tenant role | `TenantUserRole.ts` role enums + `personaDefaults.ts` ROLE_DEFAULTS | `types.ts` TenantRole union + `TENANT_ROLE_OPTIONS` | Section 5.1 |

Pre-PR verification: After any contract change, grep the frontend for the changed field name to find all consumers. Frontend API functions are centralized in `frontend/src/api.ts`.
