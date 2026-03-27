# Decision Traceability Matrix

> Generated: 2026-03-27 | Sources: code, RFC.md, commit history, project memory

---

## Legend

- **Evidence strength:** Direct (code + RFC + commit) | Partial (code + commit, no RFC) | Memory-only (project memory, unverified in code)

---

| # | Decision | RFC | Code | Commit Evidence | Confidence |
|---|----------|-----|------|-----------------|------------|
| 1 | SLM-direct extraction (heuristic parser bypassed) | RFC-03 (needs update) | `InvoiceExtractionPipeline.ts` sets `ocrGate = "slm-direct"` | `1506d3e` (m19) | High — Direct |
| 2 | Integer minor units for all currency | RFC-04 | `currency.ts` (both), `tallyExporter.ts` | `c258e1f` (m1) | High — Direct |
| 3 | Keycloak-only auth (local-STS retired) | Missing RFC | `HttpOidcProvider.ts`, `KeycloakAdminClient.ts`, `docker-compose.yml` (no local-sts service) | `7b58271` (m13) | High — Partial |
| 4 | S3-only storage (no LocalDiskFileStore) | Missing RFC | `S3FileStore.ts` sole implementation, no LocalDiskFileStore.ts in src/ | `1506d3e` (m19) | High — Partial |
| 5 | VIEWER role with read-only access | Missing RFC | `requireNotViewer` middleware, `ViewerScope` model, 4 roles in TenantUserRole | `b0e2e13` (m15) | High — Partial |
| 6 | FAILED_PARSE not approvable | RFC-06 (implicit) | Backend `approveInvoices` query excludes FAILED_PARSE; frontend `isInvoiceApprovable` check | Memory m12b | High — Direct |
| 7 | Approval workflows (simple + advanced) | Missing RFC | `ApprovalWorkflow` model, `approvalWorkflowService.ts`, `ApprovalWorkflowSection.tsx` | `b0e2e13` (m15) | High — Partial |
| 8 | GST tax breakdown (CGST/SGST/IGST/Cess) | Missing RFC | `tallyExporter.ts` GstAmounts interface, 4 ledger env vars in docker-compose | `bfedd36` (m19v) | High — Partial |
| 9 | Gmail OAuth per-tenant integration | Missing RFC | `gmailConnection.ts`, `TenantIntegration` model, `tenantGmailIntegrationService.ts` | `a98b3d0` (m5) | High — Partial |
| 10 | Anumati bank connection | Missing RFC | `AnumatiBankConnectionService.ts`, `AnumatiClient.ts`, `BankAccount` model | `681bcf9` (m14) | High — Partial |
| 11 | STS → OIDC rename | Missing RFC | `OidcProvider.ts`, `HttpOidcProvider.ts`, env vars `OIDC_*` | Memory m8-cleanup | High — Partial |
| 12 | Vendor fingerprinting + template matching | RFC-03 (implicit) | `vendorFingerprint.ts`, `vendorTemplateStore.ts`, `VendorTemplate` model | `7227fae` (m3) | High — Partial |
| 13 | Extraction learning feedback loop | RFC-23 | `extractionLearningStore.ts`, `ExtractionLearning` model | `cf6e53d` (m11) | High — Direct |
| 14 | LLM-assisted re-extraction | RFC-22 | `InvoiceExtractionPipeline.ts`, `LLM_ASSIST_CONFIDENCE_THRESHOLD` env var | `cf6e53d` (m11) | High — Direct |
| 15 | Docker Compose project name `billforge` | RFC-20 | `docker-compose.yml` line 1: `name: billforge` | Multiple commits | High — Direct |
| 16 | Invoice type classification (10 categories) | RFC-21 | `HttpFieldVerifier.ts`, `extractionLearningStore.ts` | `cf6e53d` (m11) | High — Direct |
| 17 | Platform admin sees aggregates only | RFC-18 | `platformAdminService.ts`, `analyticsService.ts` | `6184e6f` (m6) | High — Direct |
| 18 | Startup readiness blocks on ML health | RFC-12 | `health.ts`, `dependencies.ts` | `6446856` (m2) | High — Direct |
| 19 | Test tenants: manual ingest only | No RFC | `ingestionService.ts` tenant type check | Memory `feedback_test_tenant_ingestion.md` | Medium — Memory |
| 20 | SLM serial queue + retry on crash | No RFC | `InvoiceExtractionPipeline.ts` | `4be7cf5` (m19g) | High — Partial |
| 21 | Server-side pagination (default 20) | RFC-14 (updated) | `invoices.ts` route, `TenantInvoicesView.tsx` | Memory m12 | High — Partial |
| 22 | Spatial label-value proximity for bbox | No RFC | `InvoiceExtractionPipeline.ts` | `d759429` (m19m) | High — Partial |
| 23 | SLM block indices for field provenance | No RFC | `HttpFieldVerifier.ts` | `3fd7a78` (m19l) | High — Partial |
| 24 | CORS lockdown for stg/prod | No RFC | `app.ts`, `env.ts` FRONTEND_BASE_URL | Memory m12 | High — Partial |
| 25 | Error Boundary in frontend | No RFC | `ErrorBoundary.tsx` | Memory m12 | High — Partial |

---

## Gaps Where Code Deviates from Docs

| # | Issue | Details |
|---|-------|---------|
| 1 | RFC.md still describes "agentic selection" for OCR | Code uses deterministic SLM-direct path since m19. RFC-03 language is outdated. |
| 2 | PRD.md mentions "Tenant RBAC: TENANT_ADMIN and MEMBER" | Code has 4 roles (+ PLATFORM_ADMIN, VIEWER). PRD section 6 is incomplete. |
| 3 | PRD.md says "Initial source: email inbox integration" | Code has 3 sources: email, folder, S3 upload. S3 upload is not mentioned in PRD. |
| 4 | LOCAL_DEEPSEEK_OCR_SETUP.md lists `local-sts` as a service | local-sts was retired in m13 (Keycloak-only). Doc is outdated. |
| 5 | LOCAL_DEEPSEEK_OCR_SETUP.md shows ports 8200/8300/5174 | docker-compose.yml maps OCR to 8202, SLM to 8302, frontend to 5177. Ports don't match. |
| 6 | TROUBLESHOOTING.md references "local-sts" | local-sts no longer exists. Section is outdated. |
| 7 | README.md mentions "React 19" | package.json shows React 18.3.1. |
| 8 | RFC.md mentions "heuristic parsing" in extraction stages | Heuristic parser is bypassed in the pipeline since m19. |
| 9 | PRD.md doesn't mention approval workflows | Configurable approval workflows are a major feature (m15). |
| 10 | PRD.md doesn't mention VIEWER role | Implemented in m12b with ViewerScope. |
| 11 | PRD.md doesn't mention bank connections | Anumati integration implemented in m14. |
| 12 | PRD.md doesn't mention Gmail OAuth integration | Implemented in m5, major production feature. |
| 13 | PRD.md doesn't mention GST tax breakdown | Implemented in m19v for Tally export. |
