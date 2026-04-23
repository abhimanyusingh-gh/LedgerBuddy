# Accounting-Payments Implementation Plan — v4.3 (execution baseline)

**Status**: execution baseline. Supersedes all prior plan revisions (v3, v4, v4.1, v4.2).

**Changelog from v4.2** (driven by 2026-04-23 architecture pivot + PRD cross-check):

## Architecture pivot
- **Desktop Windows/Go bridge agent removed from MVP.** Replaced by a cloud **jumpbox** inside our VPC. Customer allowlists the jumpbox's static EIP; backend reaches Tally's HTTP-XML endpoint via the jumpbox over TCP:9000 (Tally's existing port). Matches PRD's stated connectivity model ("only TCP connectivity from BillForge server to Tally port 9000 required").
- **Option A chosen**: jumpbox ships in Phase 2 alongside `TallyClient`, so customers allowlist the IP once and never re-whitelist.
- **PRs cut** (moved to post-MVP "on-prem desktop agent" backlog): STUB-SIGN, BRIDGE-3a (BridgeAgent model/pairing), BRIDGE-3b (bridge cert rotation), BRIDGE-CA, BRIDGE-4a..g (Go core, Windows service, MSI, auto-update, telemetry, startup-checks, multi-machine), BRIDGE-CHAOS (desktop failure chaos), RUNBOOK-3. **~38.5d cut.**

## PRD-driven additions
- **JUMPBOX track**: VPC-confined service with static EIP, IAM-gated inbound, per-tenant Tally creds vault, outbound-only to customer Tally. 5 PRs, ~17.5d.
- **FE-3b Vim-style keyboard shortcuts** (`j/k`, Space, `a`, `e`, `?`) — PRD UX non-negotiable. +1d in Phase 1.
- **BENCH-1 Reconciliation accuracy benchmark** on anonymised ground-truth dataset; CI gate before any scoring-algorithm change. +2d.
- **Dead-letter cron retry** for AuditLog (1h/2h/4h/8h exponential backoff) folded into BE-6 (FR-AUDIT-004a). +0.5d.
- **TDS compute p95 < 200ms** perf gate added to INFRA-3 CI (NFR-001).
- **Reconciliation split/aggregate FE restored to MVP** (lighter scope — works inside existing `BankStatementsTab`, no split-pane redesign). +6d (was 12.5d in v4.2 before cut).
- **30-minute onboarding ceiling** added as acceptance criterion to TALLY-ONBOARD PR (PRD §3.1).

## Totals
- 97 MVP PRs → **~92 MVP PRs**
- 273d base → **262d base** / **~367d with 40% risk buffer** / **~36 calendar weeks**
- Critical path no longer gated on sole Go engineer; throughput risk drops
- Customer onboarding friction drops massively (no MSI install, no SmartScreen warning, no tray app)

---

## Source documents
- `docs/accounting-payments/MASTER-SYNTHESIS.md`
- `docs/accounting-payments/PRD.md` (primary) + `docs/accounting-payments/input/PRD-REFINED.md`
- `docs/PRD-CA-FIRMS-INDIA.md`
- `docs/accounting-payments/RFC-BACKEND.md`, `RFC-FRONTEND.md`
- `docs/accounting-payments/input/TALLY-INTEGRATION-DEEP-DIVE.md`
- `docs/accounting-payments/input/UX-AUDIT-REPORT.md`

---

## Operating constraints (unchanged from v4.2)

1. Main thread writes zero code; every PR via senior-engineer subagent in an isolated git worktree.
2. **≤10 files per PR**; test-dominant PRs (>70% LOC in tests) may reach 15 files with justification.
3. Backend ↔ Frontend alternate; BE lands first (additive, backward-compatible).
4. Additive schemas, dual-writes, feature flags, deprecation cycles — never breaking renames.
5. Code reuse strict; rule-of-3 for extraction refactors.
6. Agent opens PR via `gh pr create` → stops. User reviews + merges manually; next dependent PR not spawned until prior merges.
7. **WIP cap: 3 in-flight PRs.**
8. **Pair-review gate** on `TdsCalculationService`, `TdsVendorLedgerService`, `PaymentService`, `TallyClient`, `VendorSyncService`, **`JumpboxClient`** (added). Main thread auto-spawns Claude review-specialist subagent after author agent opens PR.
9. **Compliance gate** (Mahir sign-off) on PRs touching TDS / GST / MSME / Form 26Q/16A / 194Q / AuditLog. Checkbox mandated in PR description.
10. **Staging dry-run gate** on all backfills (BE-7b, BE-15, BE-31 backfill, BE-33 backfill).
11. **4-state UX contract** (empty / loading / error / zero-result) on every FE PR.
12. VKL grounding cited in every PR description (D-### / C-###).
13. 100% branch coverage on TDS cumulative, payment allocation, Tally XML (D-040).

## Infra facts (resolved)
- **Prod DB**: MongoDB Atlas on AWS. Full Mongo semantics.
- **Tally connectivity**: cloud backend → our **jumpbox** (VPC, static EIP, IAM-gated) → customer-hosted Tally over TCP:9000. Customer allowlists jumpbox EIP once.
- **Desktop agent**: POST-MVP only (for on-prem Tally customers without cloud-accessible Tally).
- **People**: user = primary engineer; Mahir (CA) = compliance gate; Claude = second-reviewer subagent.

## Tally integration rules (updated for jumpbox topology)
1. **GSTIN-first vendor matching** (priority: GSTIN → stored Tally ledger GUID → normalised name → canonicalised abbreviations → Jaccard never auto-merges)
2. **Dual-tag emission** (ERP9 + Prime aliases on writes; tolerant on reads)
3. **`SVCURRENTCOMPANY` on every request** — never assume sticky company selection
4. **No client-supplied ledger GUIDs** — persist Tally's server-issued GUID after first sighting
5. **F12 "Overwrite by GUID"** verified at onboarding; re-exports use `ACTION="Alter"`
6. **Batch default: 25 vouchers** (tight blast radius)
7. **LINEERROR ordinal correlation** — deterministic batch order, per-item retry fallback
8. **AlterID cursors** for drift detection (`$AlterID > lastSeen` per collection; rollback-aware)
9. **Settlement precheck** before payment voucher export (fetch vendor Bills Outstanding)
10. **`ALLOWCREATION=Yes` banned** — our precheck path handles vendor creation
11. **Customer Tally must be reachable over TCP:9000 from our jumpbox EIP** (replaces old "localhost-only" rule). Allowlist documented in onboarding.

## Architecture diagram (jumpbox topology)

```
┌─────────────────┐     IAM-gated      ┌──────────────────┐   TCP:9000   ┌──────────────────┐
│ Backend (ECS)   │◄─────────────────► │ Jumpbox (VPC)    │◄────────────►│ Customer Tally   │
│ TallyClient     │  private subnet    │ static EIP       │   HTTPS/HTTP │ (cloud or on-prem │
│ VendorSyncSvc   │                    │ per-tenant creds │   XML Envelop│  with public IP) │
└─────────────────┘                    └──────────────────┘              └──────────────────┘
                                              ▲
                                              │ allowlist: EIP only
                                              │
                                        Customer firewall
```

---

## Phase 0 — Foundation (weeks 0-2)
Hard gate; nothing downstream starts without these.

| # | PR | B/F/Ops | E | Pair-gate |
|---|----|---------|---|-----------|
| 0.1 | INFRA-1 Test harness: testcontainers-for-Mongo w/ replica-set init matching Atlas, fixture generator, prod-scale sample dataset | B | 5 | — |
| 0.2 | INFRA-2 Feature-flag framework (runtime eval, cohort targeting, flag registry, hot-toggle) | B/F | 3 | — |
| 0.3 | INFRA-3 CI perf/bundle-size gates + **TDS compute p95 < 200ms** + **payment recording p95 < 500ms** benchmarks (NFR-001, NFR-002) | Ops | 2.5 | — |
| 0.4 | BE-0 `$jsonSchema` DB-level validators on `*Minor` fields | B | 3 | — |
| 0.5 | FE-0a DS scaffold: tokens + `components/ds/` + Storybook + first stories | F | 3 | — |
| 0.6 | FE-0b State/data-fetching scaffold: react-query + MSW + URL-as-state helpers | F | 2 | — |

**Phase 0: 18.5 days** (STUB-SIGN removed; INFRA-3 +0.5d for perf benchmarks).

---

## Phase 1 — Tally hygiene + UX quick wins + IA shell (weeks 2-4)
RICE-highest cluster. IA shell pulled early to avoid whiplash. **Action-Required queue is demo-gate**.

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 1 | BE-1 Tally XML core fixes + dual ERP9/Prime tag emission | B | 2.5 | |
| 2 | BE-2 PLACEOFSUPPLY + GUID + UTF-8 + batch-default 25 + Alter-on-re-export | B | 2 | |
| 3 | RUNBOOK-1 Tally exporter runbook | Ops | 1 | |
| 4 | FE-1 Hook extraction (`useInvoiceTableState`, `useInvoiceFilters`) | F | 2 | |
| 5 | FE-2 QW-1/2/3 (risk-signal default expand, risk-dot column, PAN labels) | F | 2 | 4-state; color+shape |
| 6 | FE-3a QW-4/5 (action-hint badges, ARIA) | F | 1.5 | |
| 7 | **FE-3b Vim-style keyboard shortcuts** (`j/k`, Space, `a`, `e`, `?` help overlay) | F | 1 | PRD UX non-negotiable |
| 8 | FE-4 `SlideOverPanel` primitive (in DS folder) | F | 0.5 | |
| 9 | FE-5a **Action-Required queue** (demo-gate; addresses "biggest UX risk" per UX-AUDIT) | F | 1.5 | 4-state |
| 10 | FE-5b Pre-export validation modal (deep-links to broken invoice) | F | 1.5 | |
| 11 | FE-22 Navigation sidebar (8-item) + `TenantSidebar` | F | 3 | |
| 12 | FE-23 App-shell restructure (sidebar, hash routing) + URL-migration banner | F | 3 | |

**Phase 1: 21.5 days** (+1d Vim keys).

---

## Phase 2 — TDS thin slice + Tally client + Jumpbox (weeks 4-7)
RICE 180 TDS thin slice → design-partner demo Week 5. Jumpbox ships alongside so customers allowlist our EIP from day-1.

| # | PR | B/F/Jump | E | Pair-gate |
|---|----|---------|---|-----------|
| 13 | BE-3 (thin) `TdsVendorLedger` model + service (atomic `$inc`, FY/quarter utils) — archival split deferred to Phase 3 | B | 5 | ✓ |
| 14 | BE-4 `TdsCalculationService` pure-fn refactor + cumulative integration (inject `{invoiceDate, cumulativeData, rateTable, certs, tenantConfig}`) | B | 4 | ✓ |
| 15 | BE-5 Rate hierarchy (197, 206AA, tenant override) + GST-separated base + quarter-by-deduction-date + `deducteeType` on VendorMaster | B | 3.5 | |
| 16 | BE-6 `AuditLog` (4 entity types) + fire-and-forget + write-failure counter + audit-drop alert + **dead-letter cron retry** (1h/2h/4h/8h) — query API deferred to Phase 7 | B | 2.5 | |
| 17 | BE-13 `/api/reports/tds-liability` endpoint | B | 1.5 | |
| 18 | FE-10 TDS Dashboard (FY switcher, quarter drill-down, KPIs, liability table, cumulative chart) | F | 4 | 4-state |
| 19 | **JUMPBOX-1** VPC service (Node/Go, small) w/ static EIP, IAM-gated inbound, per-tenant Tally creds vault (AWS Secrets Manager), outbound-only TCP:9000 to customer Tally | Jump | 5 | ✓ |
| 20 | **JUMPBOX-THREAT** Threat model (cloud-to-cloud, creds blast radius, tenant isolation, IAM policy review) | Docs | 2 | |
| 21 | **JUMPBOX-OBS** Observability: reachability SLO, per-tenant latency, allowlist-blocked alerts, creds-rotation telemetry | Ops | 2 | |
| 22 | BRIDGE-1 → **TALLY-CLIENT** `TallyClient` backend (envelope builders, LINEERROR ordinal parser, per-tenant mutex + circuit breaker + exponential backoff, always-on `SVCURRENTCOMPANY`, **routes via JumpboxClient adapter**) | B | 5 | ✓ |
| 23 | **JUMPBOX-2** `JumpboxClient` adapter in backend: auth (IAM sig v4), retry, CB, connects `TallyClient` ↔ jumpbox | B | 2 | ✓ |
| 24 | **TALLY-NETCONF** `TenantTallyCompany` model (replaces v4.2 BRIDGE-2): `companyGuid`, `tallyBaseUrl`, `tallyPort`, `tallyAuthJson`, `f12OverwriteByGuidVerified`, `allowlistVerifiedAt`, AlterID cursors | B | 1.5 | |

**Phase 2: 38 days** (jumpbox ships here). Parallelisable with Phase 3.

---

## Phase 3 — Vendor CRUD + TDS hardening (weeks 6-10, parallel)

| # | PR | B/F | E | Pair-gate |
|---|----|-----|---|-----------|
| 25 | BE-8a VendorMaster fields + Tenant `tan` + `tallyLedgerGuid` + `deducteeType` + `msmeClassificationHistory[]` | B | 2 | |
| 26 | BE-8b `VendorService` CRUD + merge (Mongo txns, **atomic TdsVendorLedger consolidation** per FR-VENDOR-014a) + Section-197 cert upload + `/api/vendors` + GSTIN-first matching | B | 3.5 | ✓ |
| 27 | RUNBOOK-4 Vendor operations runbook | Ops | 1 | |
| 28 | FE-11a Vendor list (search, filter, sort, pagination, virtualised ≥500 rows) | F | 3 | 4-state |
| 29 | FE-11b Vendor detail — invoices + TDS sub-tabs + `VendorMergeDialog` | F | 3 | |
| 30 | BE-3-HARDEN `TdsVendorLedger` FY archival + 16MB subdoc split | B | 2 | ✓ |
| 31 | BE-3-CHAOS Concurrency chaos harness (50 concurrent writes, invariant check) | B | 2 | |
| 32 | BE-OAR002 Backdated-invoice TDS recompute: ledger-entry reversal + rerun flow (OAR-002) | B | 4 | ✓ |
| 33 | RUNBOOK-2 TDS + AuditLog runbook | Ops | 1 | |

**Phase 3: 21.5 days.**

---

## Phase 4 — Payments manual thin slice + 194Q (weeks 9-13)
Payments behind `payments_manual` flag — no Tally/jumpbox dependency. Customer value Week 12.

| # | PR | B/F | E | Pair-gate |
|---|----|-----|---|-----------|
| 34 | BE-9 `Payment` model + invoice `paymentStatus`/`paidAmountMinor`/`gstTreatment` | B | 1.5 | |
| 35 | BE-10 `PaymentService` + routes + allocation + duplicate-UTR + Mongo multi-doc txns + post-`$inc` status recompute | B | 9 | ✓ |
| 36 | BE-11 Reversal flow + cash-limit risk signal (`CASH_PAYMENT_ABOVE_LIMIT`) | B | 2 | |
| 37 | RUNBOOK-5 Payment operations runbook | Ops | 1 | |
| 38 | FE-12 Payment recording UI (single + multi-invoice, progress bar, status badge, live-region announcements, unsaved-changes guard) | F | 5 | 4-state |
| 39 | FE-13 Payment/aging columns + history panel | F | 3 | |
| 40 | BE-31 Section 194Q buyer-TDS cumulative + Section 206C(1H) TCS cumulative (parallel ledger to TdsVendorLedger, invoice-side triggers) | B | 8 | ✓ |

**Phase 4: 29.5 days.**

---

## Phase 5 — Tally payment vouchers + Vendor sync E2E (weeks 13-17)
Formerly bridge-binary phase; now pure integration work via jumpbox.

| # | PR | B/F | E | Pair-gate |
|---|----|-----|---|-----------|
| 41 | **TALLY-ONBOARD** Onboarding wizard: enter Tally URL/port/auth → "allowlist our jumpbox IP `X.X.X.X`" → verify F12 "Overwrite by GUID" → test connection via jumpbox → initial ledger pull progress. **AC**: completable within 30 min per PRD §3.1 | F | 3 | |
| 42 | BRIDGE-6 → **VENDOR-SYNC-1** `VendorSyncService`: onboarding ledger pull via TallyClient → jumpbox → Tally, GSTIN-first matching, Tally GUID persistence, idempotent VendorMaster upsert (at 10k-ledger scale) | B | 6 | ✓ |
| 43 | BRIDGE-7 → **VENDOR-SYNC-2** AlterID drift reconciliation + rollback detection + diff → AuditLog (scheduled job in backend, not a desktop agent) | B | 4 | |
| 44 | **TALLY-HEALTH** Connection health panel (FE): jumpbox reachability, last Tally ping, cursor state, F12 status, allowlist status, force-resync | F | 1.5 | 4-state |
| 45 | BRIDGE-10 → **VENDOR-CONFLICT-UI** Ledger conflict resolution UI: GSTIN-match-but-name-differs → user confirms before merge | F | 2.5 | |
| 46 | BE-30 Tally TDS statutory tags (`TDSAPPLICABLE`, `TDSDEDUCTEETYPE`, `TDSPAYMENTTYPE`) on purchase voucher export | B | 2 | |
| 47 | BRIDGE-8 → **TALLY-VENDOR-PRECHECK** Pre-export vendor-existence check (fail-fast or auto-create) | B | 2 | |
| 48 | BRIDGE-9 → **TALLY-SETTLEMENT-PRECHECK** Settlement precheck: Bills Outstanding w/ per-tenant TTL cache + batching + latency SLO | B | 4 | ✓ |
| 49 | BE-12 Payment voucher XML + export endpoint + pre-check integration | B | 2.5 | |
| 50 | BE-12-FALLBACK File-only export path when jumpbox/Tally unreachable (explicit UX, audit-trail of unverified vouchers) | B | 2 | |
| 51 | FE-14 Payment-voucher export panel + jumpbox-offline fallback UX | F | 2 | |
| 52 | FE-11c Vendor detail — payments sub-tab | F | 1.5 | |
| 53 | RUNBOOK-Tally Jumpbox + Tally connectivity runbook (replaces RUNBOOK-3 bridge runbook) | Ops | 1 | |

**Phase 5: 34 days.**

---

## Phase 6 — Recon v2 + Reports + audit query (weeks 17-22)

| # | PR | B/F | E | Pair-gate |
|---|----|-----|---|-----------|
| 54 | BE-7a `ReconciliationMapping` model + repository (explicit index set) | B | 1.5 | |
| 55 | BE-7b Dual-write shim + cursor-based backfill (dry-run, resumability, progress telemetry) | B | 6 | ✓ |
| 56 | BE-7-CONSIST Nightly dual-write consistency check + alert | B | 1.5 | |
| 57 | BE-6-QUERY AuditLog search API (by user / date-range / entity / action) | B | 2 | |
| 58 | **BENCH-1** Reconciliation accuracy benchmark: anonymised ground-truth dataset (3 pilot-firm statements) + CI gate blocking scoring-algorithm changes on regression (PRD §4.8) | B | 2 | |
| 59 | BE-14a TDS-adjusted scoring + ±2 business-day tolerance + junction-table read cutover | B | 2.5 | |
| 60 | FE-16a Surface TDS-adjusted expected-debit in existing `BankStatementsTab` | F | 1 | |
| 61 | RUNBOOK-6 Reconciliation runbook | Ops | 1 | |
| 62 | BE-15 Cleanup inline `matchedInvoiceId` (gated on 2-wk stability + BE-7-CONSIST green) | B | 2 | |
| 63 | BE-16 Aging endpoint (`GET /api/reports/payment-aging`) | B | 1 | |
| 64 | FE-15a Aging-report view | F | 1.5 | 4-state |
| 65 | BE-17 Refactor: extract `ReportService` (rule-of-3 trigger) | B | 1.5 | |

**Phase 6: 23.5 days** (+2d BENCH-1).

---

## Phase 7 — Split/aggregate recon (lighter FE) + Form 16A + Payment runs (weeks 22-27)
Split/aggregate FE back in MVP per PRD (FR-REC-001..012), lighter than v4.2 spec — works inside current UI, no split-pane redesign.

| # | PR | B/F | E |
|---|----|-----|---|
| 66 | BE-14b Split-detection algorithm (subset-sum ≤10 invoices, greedy pre-filter) | B | 4 |
| 67 | BE-14c Aggregate-detection algorithm (inverse subset-sum) | B | 3 |
| 68 | BE-18 Reconciliation summary endpoint | B | 1 |
| 69 | **FE-17-light** Split-match inline panel + aggregate-match inline panel (inside existing `BankStatementsTab`; no split-pane redesign) + live sum check + unmatch | F | 6 |
| 70 | FE-15b Reconciliation summary view | F | 1.5 |
| 71 | BE-33 Form 16A generation (vendor-facing TDS certificate) + email delivery | B | 4 |
| 72 | FE-27 Form 16A send UI (single + bulk, preview, delivery status) | F | 2 |
| 73 | BE-19 `PaymentRun` model + service + `/api/payment-runs` | B | 3 |
| 74 | BE-20 Bank payment-instruction file generator (NEFT/RTGS formats) | B | 3 |
| 75 | FE-18 Payment Run UI (create, review, approve, download) | F | 4 |

**Phase 7: 31.5 days.**

---

## Phase 8 — MSME + TDS filing depth (weeks 27-32)

| # | PR | B/F | E |
|---|----|-----|---|
| 76 | BE-21 MSME tracking (uses `msmeClassificationHistory`) + `MSME_PAYMENT_OVERDUE`/`_APPROACHING` risk signals | B | 2 |
| 77 | BE-22 MSME interest calculator (3× bank rate, monthly compounding) | B | 2 |
| 78 | FE-11d Vendor detail — bank sub-tab | F | 1.5 |
| 79 | FE-11e Vendor detail — MSME sub-tab + interest display | F | 2 |
| 80 | FE-19 Refactor: extract `useRovingTabIndex` (rule-of-3) | F | 1 |
| 81 | BE-24 Form 26Q FVU export (leverages BE-30 tags) | B | 4 |
| 82 | BE-25 TDS challan tracking model + service | B | 3 |
| 83 | FE-20 TDS filing dashboard (challan status, 26Q download, 194Q cumulative) | F | 3.5 |

**Phase 8: 19 days.**

---

## Phase 9 — GSTR-2B / ITC + auditor audit viewer (weeks 32-36)

| # | PR | B/F | E |
|---|----|-----|---|
| 84 | BE-26 `Invoice.itcEligible` field + enum extension | B | 1 |
| 85 | BE-27 GSTR-2B JSON import + matching service | B | 4 |
| 86 | FE-21 GSTR-2B matching UI (matched / unmatched / excess-ITC tabs) | F | 3 |
| 87 | BE-34 AuditLog CSV/PDF export API + regulator-style filters | B | 3 |
| 88 | FE-28 Audit log viewer: searchable, filterable, exportable | F | 3 |
| 89 | BE-28 `GET /api/tenant/setup-progress` endpoint | B | 1 |
| 90 | FE-24 Setup wizard / onboarding flow | F | 4 |

**Phase 9: 19 days.**

---

## Totals

- **90 MVP PRs** (v4.2 had 97; −13 bridge PRs, +6 new: jumpbox ×5, keyboard, bench-1, recon-light)
- **~258 eng-days base** (v4.2: 273d)
- **~362 eng-days with 40% buffer / ~36 weeks**

---

## Deferred / cut from MVP (post-MVP backlog)

| Item | Reason | Re-consider when |
|------|--------|-------------------|
| **Windows/Go desktop bridge agent** (old BRIDGE-4a..g, BRIDGE-CA, BRIDGE-3b, CHAOS, RUNBOOK-3) | MVP targets cloud-Tally via jumpbox; desktop agent only needed for on-prem Tally customers without cloud-reachable Tally | Customer demand for strict-on-prem Tally |
| STUB-SIGN self-signed MSI | N/A without desktop agent | With desktop agent |
| FE-16b full reconciliation split-pane redesign | MVP lighter inline panels suffice | Post-MVP UX polish wave |
| FE-4b `Portal` primitive extraction | Rule-of-3 not triggered by MVP cuts | When 3rd consumer appears |
| BE-29 Payment advice PDF/email | Value-add, not compliance-critical | Customer request |
| FE-25 Payment advice send UI | Depends on BE-29 | With BE-29 |
| FE-26 Tax calendar | Static-data; partner-ownable | Post-MVP |
| BE-23 Section 206AB stub | CBDT list integration required | When CBDT API reachable |

---

## Critical path v4.3

```
Phase 0 (foundation) ─► Phase 1 (Tally hygiene + IA + keyboard)
                       ├─► Phase 2 TDS thin slice + Jumpbox + TallyClient ─► first demo Week 5
                       │
Phase 3 (Vendor CRUD + TDS harden) ─┤  (parallel)
                                   │
Phase 4 (Payments manual + 194Q) ──┤  (no Tally dep)
                                   │
Phase 5 (Tally payment vouchers + Vendor sync E2E via jumpbox) ─► first Tally-live export Week 15
                                   ↓
Phase 6 (Recon v2 + Reports + audit query)
                                   ↓
Phase 7 (Split/aggregate + Form 16A + Payment runs)
                                   ↓
Phase 8 (MSME + TDS filing depth)
                                   ↓
Phase 9 (GSTR-2B + audit viewer + setup wizard)
```

## First-visible-customer-value milestones (v4.3)

| Week | What ships | Addresses |
|------|-----------|-----------|
| 3 | Tally XML correctness (all existing customers) | Finance Controller pain: "bill refs don't settle in Tally" |
| 4 | UX quick wins + Vim keys + nav + **Action-Required queue** | UX-AUDIT "biggest demo risk" resolved |
| **5** | **TDS cumulative dashboard + jumpbox connectivity test** (design-partner demo) | CA firm pain: "misses TDS threshold crossings 2-3×/qtr" |
| 8 | Vendor CRUD UI + Section 197 cert lifecycle | Tax Specialist pain: "spreadsheet cert tracking" |
| **12** | **Manual payment recording + 194Q tracking** (no Tally dep) | AP Clerk pain: "outstanding balance visibility" |
| **15** | **End-to-end Tally payment voucher via jumpbox** | Full procure-to-pay cycle working |
| 20 | Reconciliation v2 with TDS-adjusted matching + benchmark gate | Finance Controller pain: "month-end close takes days" |
| 25 | Split/aggregate reconciliation + Form 16A + Payment runs | Full PRD MVP scope landed |
| 32 | MSME interest + Form 26Q FVU + TDS challan | Compliance deliverables complete |
| 36 | MVP complete: GSTR-2B + audit viewer + setup wizard | GA-ready |

---

## PRD alignment check (v4.3)

| PRD requirement | v4.3 phase | Status |
|-----------------|-----------|--------|
| TDS cumulative threshold + catch-up | Phase 2 | ✓ |
| Section 197 cert auto-apply | Phase 2-3 | ✓ |
| GST auto-split (CGST/SGST/IGST) | Phase 2 (BE-5) | ✓ |
| PAN+GSTIN cross-reference | Phase 1 (FE-2 QW-3) | ✓ |
| MSME 45-day deadline + interest | Phase 8 | ✓ |
| Tally XML bill references | Phase 1 (BE-1) | ✓ |
| Payment recording + reversal + advance | Phase 4 | ✓ |
| Reconciliation TDS-adjusted + split/agg | Phase 6-7 | ✓ (split/agg restored) |
| Vendor master w/ PAN/GSTIN/TDS section | Phase 3 | ✓ |
| Audit trail 8-yr retention | Phase 2 (BE-6) | ✓ |
| Form 26Q quarterly aggregation | Phase 2 (BE-13) + Phase 8 (BE-24) | ✓ |
| **Action-Required queue (UX non-neg)** | **Phase 1 (FE-5a)** | ✓ demo-gate |
| **Vim keyboard shortcuts** | **Phase 1 (FE-3b)** | ✓ new in v4.3 |
| **Recon accuracy benchmark CI gate** | **Phase 6 (BENCH-1)** | ✓ new in v4.3 |
| **TDS compute p95 < 200ms** | **Phase 0 (INFRA-3)** | ✓ new in v4.3 |
| **AuditLog dead-letter retry** | **Phase 2 (BE-6)** | ✓ new in v4.3 |
| **30-min onboarding ceiling** | **Phase 5 (TALLY-ONBOARD AC)** | ✓ new in v4.3 |

All PRD P0 and P1 items scheduled. No customer need unaddressed.

## Known unresolved (OAR carry-over)
- OAR-001 Section 197 cert authenticity (TRACES API) — deferred
- OAR-002 Backdated TDS recompute — ADDRESSED Phase 3 (BE-OAR002)
- OAR-006 Payment reversal auto-detection from bank patterns — deferred
- OAR-007 Tally statutory TDS vs manual 26Q — addressed Phase 5 (BE-30) + Phase 8 (BE-24)
- OAR-009 Multi-currency Tally export — deferred
- OAR-010 TDS challan tracking — addressed Phase 8 (BE-25)
- OAR-015 GSTR-2B matching — addressed Phase 9

## Memory entries active for every agent
- `feedback_pr_workflow.md` (v4.2+ constraints)
- `feedback_code_reuse.md`
- `feedback_main_thread_no_code.md`
- `project_accounting_payments.md` (scope + grounding docs)
- `project_org_and_infra.md` (Atlas + jumpbox + no desktop agent + people)
- `reference_agent_briefing.md` (pre-amble including 4-state UX contract)
- `reference_tally_integration.md` (11 Tally rules — to write before Phase 2 spawns)
