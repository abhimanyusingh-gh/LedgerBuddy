# Assumptions & Gaps

> Generated: 2026-03-27

---

## 1. Assumptions Made During Analysis

| # | Assumption | Basis | Confidence |
|---|-----------|-------|------------|
| 1 | Heuristic parser is fully bypassed in production ingestion | `InvoiceExtractionPipeline.ts` sets `ocrGate = "slm-direct"`, project memory confirms (2026-03-25) | High |
| 2 | LocalDiskFileStore has been removed from the codebase | No `.ts` source file found in `backend/src/storage/`; only compiled `.js` in dist | High |
| 3 | local-sts service is fully retired | Not present in `docker-compose.yml`, `local-sts/` directory deleted per memory m10 | High |
| 4 | All 4 roles are production-ready | Code enforces VIEWER restrictions via middleware; RBAC checks present on all write routes | High |
| 5 | Anumati bank integration is feature-complete | Full service + client + crypto + model + routes exist; Mock implementation available | Medium |
| 6 | Gmail polling auto-ingest is production-ready | Service, model, routes, and E2E test exist; memory confirms configurable intervals | Medium |
| 7 | Test tenant vs production tenant distinction is enforced in code | Memory states this as a requirement; not verified against `ingestionService.ts` logic in detail | Medium |
| 8 | Keycloak realm config (`realm-config.json`) is correct and complete | Mounted as read-only volume in docker-compose; not inspected in detail | Medium |

---

## 2. Known Gaps

### 2.1 Documentation Gaps
| # | Gap | Impact |
|---|-----|--------|
| 1 | No API reference documentation (OpenAPI/Swagger) | Developers must read route files to understand API contracts |
| 2 | No onboarding guide for new developers | Quick Start in README is minimal; no walkthrough of architecture or dev workflow |
| 3 | No runbook for production operations | AWS deployment guide exists but no incident response, monitoring, or alerting docs |
| 4 | No changelog or release notes | Commit messages (m1-m19v) serve as implicit changelog but aren't formatted for users |
| 5 | No data model documentation | 17 Mongoose models have no schema documentation outside code |

### 2.2 Feature Gaps
| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 1 | PDF preview/crop generation failing for PDF uploads | Memory `debugging_pdf_previews.md` (2026-03-25): "Zero preview images stored, zero crops generated" for PDFs uploaded via S3 | Medium — affects review UX for PDF invoices |
| 2 | UX improvements planned but not yet implemented (m13 plan) | Memory `ux_gaps_m13_plan.md`: sticky headers, empty states, confirm labels, bulk action bar, density controls, aging buckets | Low — planned work, not a regression |
| 3 | No webhook/event notification system | No outbound webhook capability for external system integration | Low — out of current scope |
| 4 | No audit log | Actions (approve, edit, delete, export) are not logged to a separate audit trail | Medium — compliance concern for finance software |
| 5 | No rate limiting on API endpoints | `requireAuth` protects routes but no rate limiting middleware visible | Low — mitigated by auth requirement |

### 2.3 Testing Gaps
| # | Gap | Evidence |
|---|-----|----------|
| 1 | `folderIngestion.e2e.test.ts` requires live OCR/SLM | Cannot run in CI without ML services; memory confirms this constraint |
| 2 | Frontend E2E tests (Playwright) coverage is narrow | 4 spec files covering source highlights, layout scroll, Tally download, tenant visibility |
| 3 | No load/performance testing | No k6, Artillery, or similar performance test suite |
| 4 | No security scanning beyond Trivy | CI runs Trivy for container scanning; no SAST/DAST tools evident |

### 2.4 Architecture Gaps
| # | Gap | Evidence | Impact |
|---|-----|----------|--------|
| 1 | No message queue / async job processing | Ingestion is synchronous within the request/SSE cycle; no Redis/RabbitMQ/SQS | Medium — limits scalability for high-volume tenants |
| 2 | No caching layer | No Redis or in-memory cache for frequent reads (analytics, invoice lists) | Low — MongoDB handles current load |
| 3 | No observability stack (metrics, traces) | Logging exists but no Prometheus/Grafana/OpenTelemetry integration | Medium — limits production debugging |
| 4 | Single-region deployment only | Terraform provisions in one region; no multi-region or DR documentation | Low — appropriate for current scale |

---

## 3. Uncertain Areas

| # | Area | Uncertainty |
|---|------|-------------|
| 1 | Anumati integration maturity | Full code exists but unclear if tested against real AA ecosystem or only mock |
| 2 | Production Gmail polling reliability | Token refresh, re-auth notification, and error recovery flows exist in code but no production usage evidence |
| 3 | DocumentDB compatibility | Terraform module exists; E2E test uses LocalStack; unclear if all Mongoose features (TTL indexes, unique compound indexes) work identically on DocumentDB |
| 4 | Scale limits of SLM serial queue | m19g added serial queue + retry; unclear at what volume this becomes a bottleneck |
| 5 | Keycloak realm configuration completeness | realm-config.json mounted but not inspected; unclear if all roles/clients/scopes are properly configured |

---

## 4. No JSONL Chat Logs Found

The analysis specification requested processing of JSONL chat history files. **No `.jsonl` files were found** in the repository or adjacent directories. Decision traceability was reconstructed from:
1. Git commit messages (m1 through m19v — 40+ commits)
2. Project memory files (9 markdown files in `.claude/projects/*/memory/`)
3. Code comments and inline documentation (minimal per project convention)
4. RFC.md and PRD.md content

This means some decisions may have rationale that was discussed but never captured in any persistent artifact.
