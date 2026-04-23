# Accounting-Payments Implementation Plan — v3 (for review)

## Source documents
- `docs/accounting-payments/MASTER-SYNTHESIS.md` — VKL-grounded (44 decisions D-###, 20 constraints C-###, 6 resolved conflicts)
- `docs/accounting-payments/RFC-BACKEND.md` — backend RFC
- `docs/accounting-payments/RFC-FRONTEND.md` — frontend RFC
- `docs/accounting-payments/TALLY-INTEGRATION-DEEP-DIVE.md` — Tally HTTP-XML API deep dive (research agent output, 2026-04-22)

## Operating constraints (non-negotiable)

1. Main Claude thread writes zero code. Every PR is executed by one focused senior-engineer subagent in an isolated git worktree.
2. **≤10 files per PR** (including tests, types, fixtures). Hard cap. If scope overflows, split.
3. Backend ↔ Frontend alternate. When a feature spans both sides, the BE PR lands first (additive, backward-compatible API); the FE PR consumes it.
4. Every PR must leave the system working for all existing callers. Additive schema, dual-writes, feature flags, deprecation cycles — never breaking renames.
5. Code reuse is strict. Before new abstractions, search for existing ones (`grep`, Explore agent). Rule-of-3 for extraction refactors (explicit PR when the 3rd consumer appears).
6. Each PR agent opens a PR via `gh pr create` → **stops**. User reviews and merges manually. Next dependent PR is not spawned until the prior PR merges.
7. VKL grounding: every PR description cites the D-### decisions / C-### constraints it implements.
8. Tests: 100% branch coverage on TDS cumulative, payment allocation, tally XML per D-040.

## Tally integration rules (from deep-dive, 2026-04-22)

1. **GSTIN-first vendor matching**: GSTIN equality → stored Tally ledger GUID → normalised name → canonicalised abbreviations (Pvt Ltd = Private Limited) → token Jaccard (last resort, never auto-merge).
2. **Dual-tag emission**: every write emits both ERP9 and Prime aliases (`PARTYGSTIN`/`GSTIN`, `INCOMETAXNUMBER`/`PANIT`, `STATENAME`/`LEDSTATENAME`). Tolerant on reads.
3. **`SVCURRENTCOMPANY` on every request**. Never assume sticky company selection in the Tally process.
4. **No client-supplied ledger GUIDs** — capture Tally's server-issued GUID after first sighting; persist on VendorMaster.
5. **F12 "Overwrite by GUID" toggle** is a customer-side setting. Onboarding wizard verifies it; re-exports use `ACTION="Alter"` (not `Create`).
6. **Batch default: 25 vouchers** (not the 100 upper bound). Tight batches limit blast radius of partial failures.
7. **LINEERROR correlation**: errors returned by ordinal position — XML batches must be emitted in deterministic order, and a fallback path re-submits failures individually.
8. **AlterID cursors** drive drift detection (`$AlterID > lastSeen` per collection). No full re-pulls after the first.
9. **Settlement precheck** required before payment voucher export: fetch vendor's Bills Outstanding and verify REFERENCE NAME + amount. Silent-orphan on-account credits otherwise.
10. **`ALLOWCREATION=Yes` banned** — Tally would auto-create vendors under Primary with no GSTIN/state. All vendor creation goes via our own precheck path.
11. **Tally connectivity is localhost-only** — desktop bridge (outbound long-poll) is the only path. No cloud-reachable Tally API exists.

## Architecture additions driven by research

- **Desktop Bridge Agent** (new Go Windows service + tray; separate repo). Outbound long-poll to cloud backend; local HTTP client to Tally `:9000`.
- **`TallyClient`** backend service: envelope builders (Export / Import / Object / Collection), LINEERROR ordinal-correlated parser, per-tenant mutex, always emits `SVCURRENTCOMPANY`.
- **`VendorSyncService`**: onboarding pull, drift reconciliation, pre-export existence check, settlement precheck.
- **`TenantTallyCompany`** model: `companyGuid`, `lastFullSyncAt`, `lastLedgerAlterId`, `lastVoucherAlterId`, `f12OverwriteByGuidVerified`.
- **`BridgeAgent`** model: pairing API, mTLS cert issuance/rotation, liveness, outbound command queue.

## Waves and PR ladder (77 PRs, ~180 eng-days)

### Wave 1 — Phase 0 Tally hygiene + UX quick wins (weeks 1-2)

| # | PR | B/F | E |
|---|----|-----|---|
| 1 | BE-1 Tally XML core fixes (ALLLEDGERENTRIES, ISINVOICE=Yes, REFERENCE, EFFECTIVEDATE, BILLALLOCATIONS) + dual ERP9/Prime tag emission | B | 2.5 |
| 2 | BE-2 PLACEOFSUPPLY + GUID dedup + UTF-8 declaration + batch-default 25 + Alter-on-re-export | B | 2 |
| 3 | FE-1 Hook extraction (`useInvoiceTableState`, `useInvoiceFilters`) | F | 2 |
| 4 | FE-2 QW-1/2/3 (risk-signal default expand, risk-dot column, PAN labels) | F | 2 |
| 5 | FE-3 QW-4/5 (action-hint badges, ARIA) | F | 1.5 |
| 6 | FE-4 `SlideOverPanel` primitive only | F | 0.5 |
| 7 | FE-5a Action-Required queue | F | 1.5 |
| 8 | FE-5b Pre-export validation modal | F | 1.5 |

### Wave 2 — TDS cumulative + AuditLog + junction (weeks 3-5)

| # | PR | B/F | E |
|---|----|-----|---|
| 9 | BE-3 `TdsVendorLedger` model + service (atomic `$inc` upsert, FY/quarter utils) | B | 4 |
| 10 | BE-4 `TdsCalculationService` cumulative integration (pure fn refactor) | B | 4 |
| 11 | BE-5 Rate hierarchy (Section 197, 206AA no-PAN, tenant override) + GST-separated base + quarter-by-deduction-date | B | 3 |
| 12 | BE-6 `AuditLog` (4 entity types initially) + fire-and-forget service | B | 1.5 |
| 13 | BE-7a `ReconciliationMapping` model + repository | B | 1.5 |
| 14 | BE-7b Dual-write shim + idempotent backfill script | B | 2 |
| 15 | BE-13 `/api/reports/tds-liability` endpoint | B | 1.5 |
| 16 | FE-10 TDS Dashboard (`TdsDashboard`, `TdsDashboardKpis`, `TdsLiabilityTable`, `TdsCumulativeChart`, context) | F | 4 |

### Wave 2-Tally — Bridge foundations (weeks 3-6, parallel with Wave 2 & 3)

| # | PR | B/F | E |
|---|----|-----|---|
| 17 | BRIDGE-1 `TallyClient` backend service: envelope builders, LINEERROR ordinal-correlated parser, per-tenant mutex, `SVCURRENTCOMPANY` always-on | B | 4 |
| 18 | BRIDGE-2 `TenantTallyCompany` model (companyGuid, AlterID cursors, F12 verified flag) | B | 1.5 |
| 19 | BRIDGE-3 `BridgeAgent` model + pairing API + mTLS cert issuance/rotation + liveness + command queue | B | 4 |
| 20 | BRIDGE-4 Desktop bridge agent core: Go Windows service + tray + credential store + outbound long-poll | Bridge | 6 |
| 21 | BRIDGE-5 Bridge Tally connector: local HTTP client to `:9000`, retry/timeout, version probe | Bridge | 3 |

### Wave 3 — Vendor CRUD (weeks 4-6, parallel)

| # | PR | B/F | E |
|---|----|-----|---|
| 22 | BE-8a VendorMaster field additions (`tallyLedgerName`, `vendorStatus`, `stateCode/Name`, `lowerDeductionCert`, `tallyLedgerGuid`) + Tenant `tan` | B | 1.5 |
| 23 | BE-8b `VendorService` CRUD + merge (transactional) + Section-197 cert upload + `/api/vendors` routes + GSTIN-first matching | B | 3 |
| 24 | FE-11a Vendor list tab (`VendorListView` + search, filter, sort, pagination + `/api/vendors` client) | F | 3 |
| 25 | FE-11b Vendor detail (`VendorDetailView` + invoices + TDS sub-tabs + `VendorMergeDialog`) | F | 2.5 |

### Wave 3-Tally — Vendor sync end-to-end (weeks 6-8)

| # | PR | B/F | E |
|---|----|-----|---|
| 26 | BRIDGE-6 `VendorSyncService`: onboarding ledger pull, GSTIN-first matching, Tally GUID persistence, idempotent VendorMaster upsert | B | 4 |
| 27 | BRIDGE-7 AlterID drift reconciliation: scheduled pull every 15min while bridge online, diff → AuditLog entries, conflict queue | B | 3 |
| 28 | BRIDGE-11 Onboarding wizard (FE): connect Tally → verify company GUID → F12 guidance modal → initial ledger pull progress | F | 4 |
| 29 | BRIDGE-12 Tally connection health panel (FE): bridge liveness, last sync, cursor state, force-resync | F | 2 |
| 30 | BRIDGE-10 Ledger conflict resolution UI (FE): GSTIN-match-but-name-differs → user confirms before merge | F | 2.5 |

### Wave 4 — Payments core (weeks 7-10)

| # | PR | B/F | E |
|---|----|-----|---|
| 31 | BE-9 `Payment` model + invoice `paymentStatus`/`paidAmountMinor`/`gstTreatment` | B | 1.5 |
| 32 | BE-10 `PaymentService` + routes + allocation validation + duplicate-UTR detection + atomic invoice `$inc` | B | 5 |
| 33 | BE-11 Reversal flow + cash-limit risk signal (`CASH_PAYMENT_ABOVE_LIMIT`) | B | 2 |
| 34 | FE-12 Payment recording UI (single + multi-invoice forms, `PaymentProgressBar`, `PaymentStatusBadge`) | F | 5 |
| 35 | FE-13 Payment/aging columns in invoice table + history panel | F | 3 |

### Wave 5 — Tally payment vouchers (weeks 10-12)

| # | PR | B/F | E |
|---|----|-----|---|
| 36 | BRIDGE-8 Pre-export vendor-existence check: fail-fast or auto-create path | B | 2 |
| 37 | BRIDGE-9 Settlement precheck: fetch Bills Outstanding for vendor, validate REFERENCE NAME + amount | B | 3 |
| 38 | BE-12 Payment voucher XML + export endpoint + integrates BRIDGE-8 & BRIDGE-9 | B | 2.5 |
| 39 | FE-14 Payment-voucher export panel + "verify in Tally" banner when bridge offline | F | 1.5 |
| 40 | FE-11c Vendor detail — payments sub-tab | F | 1.5 |

### Wave 6 — Reports + ReportService extraction (weeks 12-13)

| # | PR | B/F | E |
|---|----|-----|---|
| 41 | BE-16 Aging endpoint (`GET /api/reports/payment-aging`) | B | 1 |
| 42 | FE-15a Aging-report view | F | 1.5 |
| 43 | BE-17 Refactor: extract `ReportService` from `tds-liability` + `aging` + reconciliation-summary (rule-of-3 trigger) | B | 1.5 |

### Wave 7 — Reconciliation v2 core (weeks 13-15)

| # | PR | B/F | E |
|---|----|-----|---|
| 44 | BE-14a TDS-adjusted scoring + ±2 business-day tolerance + junction-table read cutover | B | 2.5 |
| 45 | FE-16a Surface TDS-adjusted expected-debit in existing `BankStatementsTab` | F | 1 |
| 46 | BE-15 Cleanup inline `matchedInvoiceId` (after 2-week stability) | B | 1.5 |

### Wave 8 — Split/aggregate reconciliation (weeks 15-17)

| # | PR | B/F | E |
|---|----|-----|---|
| 47 | BE-14b Split-detection algorithm (subset-sum ≤10 invoices, greedy pre-filter) | B | 4 |
| 48 | BE-14c Aggregate-detection algorithm (inverse subset-sum) | B | 3 |
| 49 | BE-18 Reconciliation summary endpoint | B | 1 |
| 50 | FE-16b Reconciliation split-pane redesign (two-column, resizable divider) | F | 5 |
| 51 | FE-17a `SplitMatchPanel` UI + live sum check + unmatch | F | 3 |
| 52 | FE-17b `AggregateMatchPanel` UI + cumulative display | F | 2.5 |
| 53 | FE-15b Reconciliation summary view | F | 1.5 |
| 54 | FE-4b Refactor: extract `Portal` primitive (3rd consumer trigger) | F | 1 |

### Wave 9 — Payment runs + bank files (weeks 18-19)

| # | PR | B/F | E |
|---|----|-----|---|
| 55 | BE-19 `PaymentRun` model + service + `/api/payment-runs` routes | B | 3 |
| 56 | BE-20 Bank payment-instruction file generator (NEFT/RTGS bulk upload formats) | B | 3 |
| 57 | FE-18 Payment Run UI (create, review, approve, download bank file) | F | 4 |

### Wave 10 — MSME + vendor detail expansion (weeks 19-20)

| # | PR | B/F | E |
|---|----|-----|---|
| 58 | BE-21 MSME tracking: agreed-terms on VendorMaster + `MSME_PAYMENT_OVERDUE`/`_APPROACHING` risk signals | B | 2 |
| 59 | BE-22 MSME interest calculator service (3× bank rate compounded monthly) | B | 2 |
| 60 | FE-11d Vendor detail — bank sub-tab | F | 1.5 |
| 61 | FE-11e Vendor detail — MSME sub-tab + interest display | F | 2 |
| 62 | FE-19 Refactor: extract `useRovingTabIndex` (3rd consumer: vendor sub-tabs + nav sidebar) | F | 1 |

### Wave 11 — TDS compliance depth (weeks 20-23)

| # | PR | B/F | E |
|---|----|-----|---|
| 63 | BE-30 Tally TDS statutory module tags (`TDSAPPLICABLE`, `TDSDEDUCTEETYPE`, `TDSPAYMENTTYPE`) on purchase voucher export | B | 2 |
| 64 | BE-23 Section 206AB non-filer check + CBDT list integration stub | B | 2 |
| 65 | BE-24 Form 26Q FVU export | B | 4 |
| 66 | BE-25 TDS challan tracking model + service | B | 3 |
| 67 | FE-20 TDS filing dashboard (challan status, Form 26Q download) | F | 3 |

### Wave 12 — GSTR-2B / ITC (weeks 23-25)

| # | PR | B/F | E |
|---|----|-----|---|
| 68 | BE-26 `Invoice.itcEligible` field + enum extension | B | 1 |
| 69 | BE-27 GSTR-2B JSON import + matching service | B | 4 |
| 70 | FE-21 GSTR-2B matching UI (matched / unmatched / excess-ITC tabs) | F | 3 |

### Wave 13 — Major UX redesign (weeks 25-27)

| # | PR | B/F | E |
|---|----|-----|---|
| 71 | FE-22 Navigation sidebar (8-item) + `TenantSidebar` component | F | 3 |
| 72 | FE-23 App-shell restructure (sidebar replaces top-tabs, hash routing) | F | 2 |
| 73 | BE-28 `GET /api/tenant/setup-progress` endpoint | B | 1 |
| 74 | FE-24 Setup wizard / onboarding flow | F | 4 |

### Wave 14 — Value-adds (weeks 27-29)

| # | PR | B/F | E |
|---|----|-----|---|
| 75 | BE-29 Payment advice generation (PDF + email) | B | 3 |
| 76 | FE-25 Payment advice send UI | F | 1.5 |
| 77 | FE-26 Tax calendar (TDS deposits, GST filings, MSME deadlines) | F | 2 |

## Critical path

- BE-1 → BE-2 (Phase 0 XML fixes) — unblocks all Tally exports
- BE-3 → BE-4 → BE-5 → BE-13 → FE-10 (TDS cumulative end-to-end)
- BE-6 → BE-7a/b → BE-8a/b → FE-11a/b (vendor CRUD)
- BRIDGE-1 through BRIDGE-5 → BRIDGE-6 → BRIDGE-7/8/9/10/11/12 (Tally sync track)
- BE-8b → BE-9 → BE-10 → BE-12 (payment model end-to-end)
- **Hard gate:** BRIDGE-9 (settlement precheck) → BE-12 (payment voucher). If bridge slips, Wave 5 ships file-only with a warning banner.

## Memory entries that propagate to every agent

- `feedback_pr_workflow.md` — PR slicing + merge discipline
- `feedback_code_reuse.md` — reuse-first rule
- `feedback_main_thread_no_code.md` — main-thread-as-orchestrator
- `project_accounting_payments.md` — initiative scope + grounding docs
- `reference_agent_briefing.md` — per-agent preamble
- `reference_tally_integration.md` (planned) — 11 Tally integration rules

## Known unresolved questions (OAR carry-over)

- OAR-001 Section 197 certificate authenticity (TRACES API?)
- OAR-002 Invoice correction → TDS recomputation strategy
- OAR-006 Payment reversal auto-detection from bank statement patterns
- OAR-007 Tally statutory TDS module vs manual Form 26Q (being partially addressed by BE-30)
- OAR-009 Multi-currency Tally export
- OAR-010 TDS challan tracking scope (addressed by BE-25)
- OAR-015 GSTR-2B matching: native vs third-party (addressed by Wave 12)
