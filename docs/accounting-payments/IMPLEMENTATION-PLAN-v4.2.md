# Accounting-Payments Implementation Plan — v4.2 (execution baseline)

**Status**: execution baseline. Supersedes v4 and v4.1 (kept as review artefacts).

**Changelog from v4.1** (driven by Round-2 RICE review from two Senior Node.js SWEs, 2026-04-23):
- **Re-sequenced around RICE** — waves replaced by 12 phases ordered by customer-value / dependency.
- **TDS thin slice lands Week 5** (vs Week 7+ in v4). Archival, chaos, audit-query deferred to post-demo hardening phase.
- **Manual-payment thin slice lands Week 12** (no bridge dep) behind `payments_manual` flag. Bridge-coupled payment vouchers are a separate later phase.
- **Bridge security docs / CA / chaos / obs** pulled in-line with binary ship, not pre-staged 8 weeks early.
- **Navigation sidebar (FE-22/23) moved Wave 13 → Phase 1** — avoids IA whiplash when TDS dashboard ships.
- **BE-OAR002 (backdated TDS recompute)** co-located with TDS cumulative ledger (SWE-1 adjudication).
- **BE-31 (194Q + 206C(1H))** moved Wave 11 → Phase 4 — invoice-side cumulative pairs naturally with Payments.
- **BE-33 + FE-27 (Form 16A)** moved Wave 11 → Phase 8 — statutory deadline (15 days post-26Q) is deliverable sooner.
- **Effort corrections** (SWE-1): BE-10 6d→9d, BE-3 5d→7d, BE-31 5d→8d, BRIDGE-6 4d→6d, BE-7b 4d→6d (+13d).
- **Cuts from MVP** (deferred post-MVP): FE-16b reconciliation split-pane redesign, FE-17a/b split/aggregate UI, FE-4b Portal extract, BE-29 payment advice, FE-25 payment advice UI, FE-26 tax calendar.
- **Totals**: 103 → 97 MVP PRs. 260d → 273d base effort. ~382d with 40% risk buffer. ~38 calendar weeks.

---

## Source documents
- `docs/accounting-payments/MASTER-SYNTHESIS.md`
- `docs/accounting-payments/RFC-BACKEND.md`, `RFC-FRONTEND.md`
- `docs/accounting-payments/TALLY-INTEGRATION-DEEP-DIVE.md`
- Review artefacts: `IMPLEMENTATION-PLAN-v3.md`, `v4.md`, `v4.md` (Round 1 & 2 reviewer outputs in conversation history)

## Operating constraints (v4.2 — updated)

1. Main thread writes zero code. Every PR via senior-engineer subagent in an isolated git worktree.
2. **≤10 files per PR**; test-dominant PRs (>70% LOC in tests) may reach 15 files with justification.
3. Backend ↔ Frontend alternate; BE lands first (additive, backward-compatible).
4. Additive schemas, dual-writes, feature flags, deprecation cycles — never breaking renames.
5. Code reuse strict; rule-of-3 for extraction refactors.
6. Agent opens PR via `gh pr create` → stops. User reviews + merges manually. Next dependent PR not spawned until the prior merges.
7. **WIP cap: 3 in-flight PRs.** Main thread refuses #4.
8. **Pair-review gate** on `TdsCalculationService`, `TdsVendorLedgerService`, `PaymentService`, `TallyClient`, `VendorSyncService`, `BridgeAgent`. Main thread auto-spawns Claude review-specialist subagent after the author agent opens the PR; review comments append before user's merge review.
9. **Compliance gate** (Mahir sign-off) on PRs touching TDS / GST / MSME / Form 26Q/16A / 194Q / AuditLog. Main thread includes the checkbox in PR description.
10. **Staging dry-run gate** on all backfills: BE-7b, BE-15, BE-31 backfill, BE-33 backfill. Separate dry-run PR + rehearsal report before prod migration.
11. **4-state UX contract** (empty / loading / error / zero-result) mandatory on every FE PR.
12. VKL grounding cited in every PR description (D-### / C-###).
13. 100% branch coverage on TDS cumulative, payment allocation, Tally XML (D-040).

## Infra facts (resolved)

- **Prod DB**: MongoDB Atlas on AWS. Full Mongo semantics: `$jsonSchema`, unconstrained multi-doc transactions, all aggregation operators.
- **Bridge signing**: stub path for design-partner rollout (self-signed MSI + SmartScreen walkthrough); public EV cert deferred post-MVP.
- **People**: user = primary engineer + Go/Windows specialist; Mahir (CA) = compliance gate; Claude = second-reviewer subagent for pair-gated PRs.

## Tally integration rules (11 rules — unchanged from v4)
GSTIN-first matching • dual-tag emission (ERP9/Prime) • `SVCURRENTCOMPANY` per request • no client-supplied ledger GUIDs • F12 "Overwrite by GUID" verified at onboarding • batch default 25 • LINEERROR ordinal correlation • AlterID cursor drift • settlement precheck before payment voucher • `ALLOWCREATION=Yes` banned • localhost-only (desktop bridge required).

---

## Phase 0 — Foundation (weeks 0-2)

Hard gate. Nothing downstream starts without these.

| # | PR | B/F/Ops | E | Pair-gate |
|---|----|---------|---|-----------|
| 0.1 | STUB-SIGN Self-signed MSI cert + SmartScreen walkthrough copy + install video | Ops | 1 | — |
| 0.2 | INFRA-1 Test harness: testcontainers-for-Mongo w/ replica-set init matching Atlas, fixture generator, prod-scale sample dataset | B | 5 | — |
| 0.3 | INFRA-2 Feature-flag framework (runtime eval, cohort targeting, flag registry, hot-toggle) | B/F | 3 | — |
| 0.4 | INFRA-3 CI perf/bundle-size gates | Ops | 2 | — |
| 0.5 | BE-0 `$jsonSchema` DB-level validators on `*Minor` fields | B | 3 | — |
| 0.6 | FE-0a DS scaffold: tokens + `components/ds/` + Storybook + first stories | F | 3 | — |
| 0.7 | FE-0b State/data-fetching scaffold: react-query + MSW + URL-as-state helpers | F | 2 | — |

**Phase 0: 19 days.**

---

## Phase 1 — Tally hygiene + UX quick wins + IA shell (weeks 2-4)

RICE-highest cluster (RICE 211 for Tally XML). IA shell pulled in early to avoid later whiplash.

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 1 | BE-1 Tally XML core fixes + dual ERP9/Prime tag emission | B | 2.5 | |
| 2 | BE-2 PLACEOFSUPPLY + GUID + UTF-8 + batch-default 25 + Alter-on-re-export | B | 2 | |
| 3 | RUNBOOK-1 Tally exporter runbook | Ops | 1 | |
| 4 | FE-1 Hook extraction (`useInvoiceTableState`, `useInvoiceFilters`) | F | 2 | |
| 5 | FE-2 QW-1/2/3 (risk default, risk-dot column, PAN labels) | F | 2 | 4-state; color+shape |
| 6 | FE-3 QW-4/5 (action-hint badges, ARIA) | F | 1.5 | |
| 7 | FE-4 `SlideOverPanel` primitive | F | 0.5 | In DS folder |
| 8 | FE-5a Action-Required queue | F | 1.5 | 4-state |
| 9 | FE-5b Pre-export validation modal (deep-links to broken invoice) | F | 1.5 | |
| 10 | FE-22 Navigation sidebar (8-item) + `TenantSidebar` | F | 3 | **MOVED from Wave 13** |
| 11 | FE-23 App-shell restructure (sidebar, hash routing) + URL-migration banner | F | 3 | |

**Phase 1: 20.5 days.**

---

## Phase 2 — TDS thin slice + Bridge BE services (weeks 4-6)

RICE 180 thin slice → design-partner demo Week 5. Bridge BE services run in parallel (no Go binary dep yet).

| # | PR | B/F | E | Pair-gate |
|---|----|-----|---|-----------|
| 12 | BE-3 (thin) `TdsVendorLedger` model + service (atomic `$inc`, FY/quarter utils) — **archival split deferred to Phase 3** | B | 5 | ✓ |
| 13 | BE-4 `TdsCalculationService` pure-fn refactor + cumulative integration (inject `{invoiceDate, cumulativeData, rateTable, certs, tenantConfig}`) | B | 4 | ✓ |
| 14 | BE-5 Rate hierarchy (197, 206AA, tenant override) + GST-separated base + quarter-by-deduction-date + `deducteeType` on VendorMaster | B | 3.5 | |
| 15 | BE-6 (thin) `AuditLog` (4 entity types) + fire-and-forget service + write-failure counter + audit-drop alert — **query API deferred to Phase 7** | B | 2 | |
| 16 | BE-13 `/api/reports/tds-liability` endpoint | B | 1.5 | |
| 17 | FE-10 TDS Dashboard (FY switcher, quarter drill-down, KPIs, liability table, cumulative chart) | F | 4 | 4-state |
| 18 | BRIDGE-1 `TallyClient` backend (envelope builders, LINEERROR ordinal parser, per-tenant mutex + circuit breaker + exponential backoff, always-on `SVCURRENTCOMPANY`) | B | 5 | ✓ |
| 19 | BRIDGE-2 `TenantTallyCompany` model | B | 1.5 | |
| 20 | BRIDGE-3a `BridgeAgent` model + pairing API + liveness + command queue w/ replay dedup | B | 3 | ✓ |

**Phase 2: 29.5 days.**

---

## Phase 3 — Vendor CRUD + TDS hardening (weeks 6-9)

| # | PR | B/F | E | Pair-gate |
|---|----|-----|---|-----------|
| 21 | BE-8a VendorMaster fields + Tenant `tan` + `tallyLedgerGuid` + `deducteeType` + `msmeClassificationHistory[]` | B | 2 | |
| 22 | BE-8b `VendorService` CRUD + merge (Mongo txns) + Section-197 cert + `/api/vendors` + GSTIN-first matching (priority order documented) | B | 3.5 | ✓ |
| 23 | RUNBOOK-4 Vendor operations runbook | Ops | 1 | |
| 24 | FE-11a Vendor list (search, filter, sort, pagination, virtualised ≥500 rows) | F | 3 | 4-state |
| 25 | FE-11b Vendor detail — invoices + TDS sub-tabs + `VendorMergeDialog` | F | 3 | |
| 26 | BE-3-HARDEN `TdsVendorLedger` FY archival + 16MB subdoc split | B | 2 | ✓ |
| 27 | BE-3-CHAOS Concurrency chaos harness (50 concurrent writes, invariant check) | B | 2 | |
| 28 | BE-OAR002 Backdated-invoice TDS recompute: ledger-entry reversal + rerun flow (addresses OAR-002) | B | 4 | ✓ |
| 29 | RUNBOOK-2 TDS + AuditLog runbook | Ops | 1 | |

**Phase 3: 21.5 days.**

---

## Phase 4 — Payments manual thin slice + 194Q (weeks 9-12)

Payments ships behind `payments_manual` flag — no bridge dependency. Customer value by Week 12.

| # | PR | B/F | E | Pair-gate |
|---|----|-----|---|-----------|
| 30 | BE-9 `Payment` model + invoice `paymentStatus`/`paidAmountMinor`/`gstTreatment` | B | 1.5 | |
| 31 | BE-10 `PaymentService` + routes + allocation + duplicate-UTR + Mongo multi-doc txns + post-`$inc` status recompute | B | 9 | ✓ |
| 32 | BE-11 Reversal flow + cash-limit risk signal (`CASH_PAYMENT_ABOVE_LIMIT`) | B | 2 | |
| 33 | RUNBOOK-5 Payment operations runbook | Ops | 1 | |
| 34 | FE-12 Payment recording UI (single + multi-invoice, progress bar, status badge, live-region announcements, unsaved-changes guard) | F | 5 | 4-state |
| 35 | FE-13 Payment/aging columns + history panel | F | 3 | |
| 36 | BE-31 Section 194Q buyer-TDS cumulative + Section 206C(1H) TCS cumulative (parallel ledger to TdsVendorLedger, invoice-side triggers) | B | 8 | ✓ |

**Phase 4: 29.5 days.**

---

## Phase 5 — Bridge security + binary (weeks 11-18, long-running parallel track)

Bridge security docs land just-in-time before the binary. Go/Windows work is long-running on a solo engineer — assume 6-7 weeks of parallel effort.

| # | PR | B/F/Bridge/Ops | E |
|---|----|----------------|---|
| 37 | BRIDGE-THREAT Threat model + security review | Docs | 3 |
| 38 | BRIDGE-CA Internal CA for mTLS (step-CA) + cert lifecycle policy | Ops | 3 |
| 39 | BRIDGE-3b mTLS cert issuance + rotation (dual-cert overlap, offline grace, revocation) | B | 3 |
| 40 | BRIDGE-4a Go core: long-poll client, command dispatcher, replay dedup | Bridge | 5 |
| 41 | BRIDGE-4b Windows service wrapper + tray UI + credential store (DPAPI) | Bridge | 4 |
| 42 | BRIDGE-4c Self-signed MSI installer + uninstall cleanup + install doc | Bridge | 3 |
| 43 | BRIDGE-4d Auto-update channel (Squirrel.Windows) | Bridge | 4 |
| 44 | BRIDGE-4e Telemetry + crash reports | Bridge | 3 |
| 45 | BRIDGE-4f Startup checks: NTP skew, Tally reachability, credential health, version probe cache | Bridge | 2 |
| 46 | BRIDGE-4g Multi-machine pairing (Tally-on-shared-server) | Bridge | 3 |
| 47 | BRIDGE-5 Bridge Tally connector: local `:9000` client, retry/timeout, version branch | Bridge | 3 |
| 48 | BRIDGE-CHAOS Chaos harness (Tally kill mid-batch, network drop, clock skew, disk-full, AV quarantine) | Bridge | 3 |
| 49 | BRIDGE-OBS Metrics + dashboards + alerts | Ops | 2.5 |
| 50 | RUNBOOK-3 Bridge operations runbook | Ops | 1.5 |

**Phase 5: 43 days.** Calendar-long but overlaps Phases 3-6.

---

## Phase 6 — Payment vouchers + Vendor sync E2E (weeks 17-21)

Gated on Phase 5 bridge reaching functional state.

| # | PR | B/F | E | Pair-gate |
|---|----|-----|---|-----------|
| 51 | BRIDGE-11 Onboarding wizard: connect Tally → verify company GUID → **F12 hard-gate** → initial ledger pull progress | F | 4.5 | |
| 52 | BRIDGE-6 `VendorSyncService`: onboarding ledger pull, GSTIN-first, Tally GUID persistence, idempotent upsert (at 10k-ledger scale) | B | 6 | ✓ |
| 53 | BRIDGE-7 AlterID drift reconciliation + rollback detection + diff → AuditLog | B | 4 | |
| 54 | BRIDGE-12 Tally connection health panel | F | 2 | 4-state |
| 55 | BRIDGE-10 Ledger conflict resolution UI | F | 2.5 | |
| 56 | BE-30 Tally TDS statutory tags (`TDSAPPLICABLE`, `TDSDEDUCTEETYPE`, `TDSPAYMENTTYPE`) on purchase vouchers | B | 2 | |
| 57 | BRIDGE-8 Pre-export vendor-existence check (fail-fast or auto-create) | B | 2 | |
| 58 | BRIDGE-9 Settlement precheck: Bills Outstanding w/ per-tenant TTL cache + batching + latency SLO | B | 4 | ✓ |
| 59 | BE-12 Payment voucher XML + export endpoint + BRIDGE-8/9 integration | B | 2.5 | |
| 60 | BE-12-FALLBACK File-only export path when bridge offline (explicit UX, not a banner) | B | 2 | |
| 61 | FE-14 Payment-voucher export panel + bridge-offline fallback UX | F | 2 | |
| 62 | FE-11c Vendor detail — payments sub-tab | F | 1.5 | |

**Phase 6: 35 days.**

---

## Phase 7 — Recon v2 + Reports + audit query (weeks 21-26)

Junction table + audit query defer until now — they unblock recon v2.

| # | PR | B/F | E | Pair-gate |
|---|----|-----|---|-----------|
| 63 | BE-7a `ReconciliationMapping` model + repository (explicit index set) | B | 1.5 | |
| 64 | BE-7b Dual-write shim + cursor-based backfill w/ dry-run, resumability, progress telemetry | B | 6 | ✓ |
| 65 | BE-7-CONSIST Nightly dual-write consistency check + alert | B | 1.5 | |
| 66 | BE-6-QUERY AuditLog search API (by user / date-range / entity / action) | B | 2 | |
| 67 | BE-14a TDS-adjusted scoring + ±2 business-day tolerance + junction-table read cutover | B | 2.5 | |
| 68 | FE-16a Surface TDS-adjusted expected-debit in existing `BankStatementsTab` | F | 1 | |
| 69 | RUNBOOK-6 Reconciliation runbook | Ops | 1 | |
| 70 | BE-15 Cleanup inline `matchedInvoiceId` (gated on 2-week stability + BE-7-CONSIST green) | B | 2 | |
| 71 | BE-16 Aging endpoint (`GET /api/reports/payment-aging`) | B | 1 | |
| 72 | FE-15a Aging-report view | F | 1.5 | 4-state |
| 73 | BE-17 Refactor: extract `ReportService` (rule-of-3 trigger) | B | 1.5 | |

**Phase 7: 21.5 days.**

---

## Phase 8 — Form 16A + Payment runs (weeks 25-28)

Form 16A pulled forward — statutory 15-day deadline after Form 26Q.

| # | PR | B/F | E |
|---|----|-----|---|
| 74 | BE-33 Form 16A generation (vendor-facing TDS certificate) + email delivery | B | 4 |
| 75 | FE-27 Form 16A send UI (single + bulk, preview, delivery status) | F | 2 |
| 76 | BE-19 `PaymentRun` model + service + `/api/payment-runs` | B | 3 |
| 77 | BE-20 Bank payment-instruction file generator (NEFT/RTGS formats) | B | 3 |
| 78 | FE-18 Payment Run UI (create, review, approve, download) | F | 4 |

**Phase 8: 16 days.**

---

## Phase 9 — MSME + TDS filing depth (weeks 28-33)

| # | PR | B/F | E |
|---|----|-----|---|
| 79 | BE-21 MSME tracking (uses `msmeClassificationHistory`) + `MSME_PAYMENT_OVERDUE`/`_APPROACHING` risk signals | B | 2 |
| 80 | BE-22 MSME interest calculator (3× bank rate, monthly compounding) | B | 2 |
| 81 | FE-11d Vendor detail — bank sub-tab | F | 1.5 |
| 82 | FE-11e Vendor detail — MSME sub-tab + interest display | F | 2 |
| 83 | FE-19 Refactor: extract `useRovingTabIndex` (rule-of-3 trigger) | F | 1 |
| 84 | BE-24 Form 26Q FVU export (leverages BE-30 tags) | B | 4 |
| 85 | BE-25 TDS challan tracking model + service | B | 3 |
| 86 | FE-20 TDS filing dashboard (challan status, 26Q download, 194Q cumulative) | F | 3.5 |

**Phase 9: 19 days.**

---

## Phase 10 — GSTR-2B / ITC + auditor audit viewer (weeks 33-37)

| # | PR | B/F | E |
|---|----|-----|---|
| 87 | BE-26 `Invoice.itcEligible` field + enum extension | B | 1 |
| 88 | BE-27 GSTR-2B JSON import + matching service | B | 4 |
| 89 | FE-21 GSTR-2B matching UI (matched / unmatched / excess-ITC tabs) | F | 3 |
| 90 | BE-34 AuditLog CSV/PDF export API + regulator-style filters | B | 3 |
| 91 | FE-28 Audit log viewer: searchable, filterable, exportable | F | 3 |
| 92 | BE-28 `GET /api/tenant/setup-progress` endpoint | B | 1 |
| 93 | FE-24 Setup wizard / onboarding flow | F | 4 |

**Phase 10: 19 days.**

---

## Phase 11 — Recon split/aggregate (BE-only, MVP-stretch, weeks 36-38)

BE-only. FE UI (split-pane redesign, split/aggregate panels) deferred post-MVP.

| # | PR | B/F | E |
|---|----|-----|---|
| 94 | BE-14b Split-detection algorithm (subset-sum ≤10 invoices, greedy pre-filter) | B | 4 |
| 95 | BE-14c Aggregate-detection algorithm (inverse subset-sum) | B | 3 |
| 96 | BE-18 Reconciliation summary endpoint | B | 1 |
| 97 | FE-15b Reconciliation summary view (minimal, existing layout) | F | 1.5 |

**Phase 11: 9.5 days.**

---

## Totals

- **97 MVP PRs** (down from 103; cuts listed below)
- **273 eng-days base effort**
- **~382 eng-days with 40% risk buffer** · **~38 calendar weeks**
- Solo Go engineer (user) on Phase 5 is a staffing risk — pair-review via Claude mitigates review quality, not continuity

## Deferred / cut from MVP (post-MVP backlog)

| PR | Reason | Re-consider when |
|----|--------|-------------------|
| FE-16b Reconciliation split-pane redesign | RICE 5.5, narrow audience | Post-MVP OR design-partner explicitly requests |
| FE-17a `SplitMatchPanel` UI | Depends on FE-16b | With FE-16b |
| FE-17b `AggregateMatchPanel` UI | Depends on FE-16b | With FE-16b |
| FE-4b `Portal` extraction | Rule-of-3 not yet triggered with MVP cuts | When 3rd consumer appears |
| BE-29 Payment advice generation | RICE 13.8, value-add | Customer request |
| FE-25 Payment advice send UI | Depends on BE-29 | With BE-29 |
| FE-26 Tax calendar | Static-data; partner-ownable | Post-MVP |
| BE-23 Section 206AB stub | CUT in v4 — real CBDT integration required before meaningful | When CBDT API is reachable |

## Critical path

```
Phase 0 (foundation) ─► Phase 1 (Tally hygiene + IA)
                       ├─► Phase 2 TDS thin slice ─► first demo Week 5
                       └─► Phase 2 Bridge BE services
                                   │
Phase 3 (Vendor CRUD + TDS harden) ─┤
                                   │
Phase 4 (Payments manual + 194Q) ──┤ (no bridge dep)
                                   │
Phase 5 Bridge binary ─────────────┤ (long parallel)
                                   ↓
Phase 6 (Payment vouchers + Vendor sync E2E) ─► first Tally-live export Week 18
                                   ↓
Phase 7 (Recon v2 + Reports + audit query)
                                   ↓
Phase 8 (Form 16A + Payment runs)
                                   ↓
Phase 9 (MSME + TDS filing depth)
                                   ↓
Phase 10 (GSTR-2B + audit viewer)
                                   ↓
Phase 11 (Recon split/aggregate BE)
```

## First-visible-customer-value milestones

| Week | What ships |
|------|-----------|
| 3 | Tally XML correctness (all existing customers benefit) |
| 4 | UX quick wins + new navigation |
| 5 | TDS cumulative dashboard (design-partner demo) |
| 8 | Vendor CRUD UI usable |
| 12 | Manual payment recording w/ history (no Tally dep) |
| 18 | First end-to-end Tally payment voucher export via bridge |
| 26 | Form 16A delivery to vendors (statutory-deadline safe) |
| 38 | MVP complete (recon v2 + GSTR-2B + audit viewer) |

## Known unresolved (OAR carry-over)

- OAR-001 Section 197 cert authenticity (TRACES API) — deferred
- OAR-002 Backdated TDS recompute — **ADDRESSED Phase 3 (BE-OAR002)**
- OAR-006 Payment reversal auto-detection from bank patterns — deferred
- OAR-007 Tally statutory TDS vs manual 26Q — **addressed Phase 6 (BE-30) + Phase 9 (BE-24)**
- OAR-009 Multi-currency Tally export — deferred
- OAR-010 TDS challan tracking — addressed Phase 9 (BE-25)
- OAR-015 GSTR-2B matching — addressed Phase 10

## Memory entries active for every agent

- `feedback_pr_workflow.md` (v4.2 constraints: WIP cap, pair-gate, test-heavy exception, staging dry-run)
- `feedback_code_reuse.md`
- `feedback_main_thread_no_code.md`
- `project_accounting_payments.md` (scope + grounding docs)
- `project_org_and_infra.md` (Atlas + stub signing + people)
- `reference_agent_briefing.md` (pre-amble including 4-state UX contract)
- `reference_tally_integration.md` (11 Tally rules — to write before Phase 2 spawns)
