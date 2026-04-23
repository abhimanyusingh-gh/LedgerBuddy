# Accounting-Payments Implementation Plan — v4.1

**v4.1 deltas vs v4** (resolved infra + procurement):
- **MongoDB Atlas on AWS confirmed** as prod DB → full Mongo semantics. `BE-0` keeps `$jsonSchema` collection-level validators; `INFRA-1` uses testcontainers-for-Mongo as originally planned; `BE-10` uses unconstrained multi-doc transactions.
- **Stub signing path** → `PROCURE-1` CUT; `BRIDGE-4c` simplified (−2d); SmartScreen-warning UX owned by `STUB-SIGN` and the onboarding wizard.
- **Pair-review gate**: Claude-as-second-reviewer approved → main thread auto-spawns review specialist after each pair-gated PR.
- **Compliance gate**: Mahir (CA) signs off compliance-adjacent PRs; main thread flags the checkbox in every such PR's description.

**Changelog vs v3** (driven by Round 1 review: EM-Delivery real agent + 7 in-persona reviews):
- Added **Track 0 foundation wave** (procurement, test infra, feature flags, DS scaffold, $jsonSchema validator, state/data-fetching scaffold).
- Bridge track expanded **6d → ~40d** with MSI signing, auto-update, telemetry, multi-machine, chaos, threat model, internal CA.
- **~30 new PRs** for observability, runbooks, compliance gaps (194Q, Form 16A, backdated recompute), auditor-usable AuditLog, chaos harnesses.
- **Re-sequences**: onboarding wizard BEFORE vendor sync; TDS statutory tags moved Wave 11 → Wave 5; inline-field cleanup Wave 7 → Wave 9; BE-23 (206AB stub) **CUT**.
- **Operating-rule updates**: WIP cap 3; pair-review gate on critical services; test-heavy PR exception to the 10-file cap; staging dry-run gate on all backfills.
- **Effort**: ~180d (v3) → **~260d base, ~365d with 40% risk buffer**.

## Source documents (unchanged)
- `docs/accounting-payments/MASTER-SYNTHESIS.md`
- `docs/accounting-payments/RFC-BACKEND.md`
- `docs/accounting-payments/RFC-FRONTEND.md`
- `docs/accounting-payments/TALLY-INTEGRATION-DEEP-DIVE.md`

## Operating constraints v4 (updated)

1. Main thread writes zero code. Every PR via a senior-engineer subagent in an isolated git worktree.
2. **≤10 files per PR** — **exception**: test-dominant PRs (>70% LOC in tests/fixtures) may reach 15 files with the increase called out in the PR description.
3. Backend ↔ Frontend alternate; BE lands first (additive, backward-compatible).
4. Every PR leaves existing callers functional. Additive schemas, dual-writes, flags, deprecation cycles.
5. Code reuse strict; rule-of-3 for extraction refactors.
6. Each PR agent opens PR via `gh pr create` → **stops**. User reviews + merges.
7. **WIP cap: 3 in-flight PRs at any time.** Applies across all tracks. Exceeding = main thread refuses to spawn.
8. **Pair-review gate** on PRs touching `TdsCalculationService`, `TdsVendorLedgerService`, `PaymentService`, `TallyClient`, `VendorSyncService`, `BridgeAgent`. Second reviewer required before merge (ideally a second engineer; user + Claude-as-second-reviewer acceptable).
9. **Staging dry-run gate** on all backfills (BE-7b, BE-15, BE-31 backfill, BE-33 backfill). Separate dry-run PR lands against staging data; rehearsal report in main PR description.
10. VKL grounding cited in every PR description.
11. Tests: 100% branch coverage on TDS cumulative, payment allocation, Tally XML (D-040).

## Tally integration rules (11 unchanged — see v3)

## Architecture additions (unchanged — see v3)

---

# Track 0 — Foundation (weeks 0-2, must land before any feature PR)

| # | PR | B/F/Ops | E | Notes |
|---|----|---------|---|-------|
| ~~0.1~~ | ~~PROCURE-1 EV cert procurement~~ | — | — | **CUT** — stub signing path chosen. Public EV cert deferred post-MVP. |
| 0.1 | **STUB-SIGN NEW** Self-signed MSI cert + onboarding copy ("Windows SmartScreen warning expected, click 'More info' → 'Run anyway'") + auto-generated install video | Ops | 1 | Replaces PROCURE-1 for design-partner rollout |
| 0.2 | **INFRA-1 NEW** Test infrastructure: real-Mongo integration harness (testcontainers with replica-set init script matching Atlas), fixture generator, prod-scale sample dataset builder | B | 5 | Blocks BE-3, BE-10 integration tests |
| 0.3 | **INFRA-2 NEW** Feature-flag framework: runtime eval, tenant-cohort targeting, flag registry, hot-toggle support | B/F | 3 | |
| 0.4 | **INFRA-3 NEW** CI perf/bundle-size gates | Ops | 2 | |
| 0.5 | **BE-0 NEW** `$jsonSchema` DB-level validator migration for existing `*Minor` fields (defence-in-depth over Mongoose validators) | B | 3 | Unblocks safe schema evolution |
| 0.6 | **FE-0a NEW** Design-system scaffold: tokens (color/spacing/type/focus), `components/ds/` folder, Storybook config + first stories | F | 3 | Blocks FE-1 and every new primitive |
| 0.7 | **FE-0b NEW** State/data-fetching scaffold: react-query client, MSW layer, URL-as-state helpers (`useSearchParamState`), error-boundary root | F | 2 | Blocks every new feature FE |

**Track-0 total: 18.5 days** (plus the EV cert calendar wait, parallel).

---

# Wave 1 — Phase 0 Tally hygiene + UX quick wins (weeks 2-4)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 1 | BE-1 Tally XML core fixes + dual ERP9/Prime tag emission | B | 2.5 | |
| 2 | BE-2 PLACEOFSUPPLY + GUID + UTF-8 + batch-default 25 + Alter-on-re-export | B | 2 | |
| 3 | **RUNBOOK-1 NEW** Tally exporter runbook: failure modes, LINEERROR recovery, re-export procedure | Ops | 1 | Required before BE-1/BE-2 reach prod |
| 4 | FE-1 Hook extraction (`useInvoiceTableState`, `useInvoiceFilters`) | F | 2 | |
| 5 | FE-2 QW-1/2/3 (risk default, risk-dot column, PAN labels) | F | 2 | **MOD**: 4-state contract required; color-only banned |
| 6 | FE-3 QW-4/5 (action-hint, ARIA) | F | 1.5 | |
| 7 | FE-4 `SlideOverPanel` primitive (in DS folder) | F | 0.5 | |
| 8 | FE-5a Action-Required queue | F | 1.5 | **MOD**: empty/loading/error/zero states required |
| 9 | FE-5b Pre-export validation modal | F | 1.5 | **MOD**: each failure deep-links to broken invoice |

---

# Wave 2 — TDS cumulative + AuditLog + junction (weeks 4-7)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 10 | BE-3 `TdsVendorLedger` model + service (atomic `$inc` upsert, FY/quarter utils, **FY-archival pattern**, 16MB-safe subdoc split) | B | 5 | **MOD**: archival baked in; pair-review gate |
| 11 | **BE-3-CHAOS NEW** Concurrency chaos harness: 50 concurrent cumulative-ledger writes, invariant check `cumulativeBaseMinor == Σ entries.taxableAmountMinor` | B | 2 | |
| 12 | BE-4 `TdsCalculationService` pure-fn refactor + cumulative integration (injected deps: `{invoiceDate, cumulativeData, rateTable, certificates, tenantConfig}` — no `new Date()`, no DB access) | B | 4 | **MOD**: pure-fn signature enforced |
| 13 | BE-5 Rate hierarchy (197, 206AA no-PAN, tenant override) + GST-separated base + quarter-by-deduction-date + **`deducteeType` field on VendorMaster** | B | 3.5 | **MOD**: deductee classification (Individual/HUF/Firm/Company/LLP) |
| 14 | BE-6 `AuditLog` (4 entity types) + service **with write-failure counter + audit-drop alert + periodic reconciliation query** | B | 2.5 | **MOD**: fire-and-forget metered, not silent |
| 15 | **BE-6-QUERY NEW** AuditLog search API: by user / date-range / entity / action; covers regulator-style queries | B | 2 | |
| 16 | BE-7a `ReconciliationMapping` model + repository + **explicit index set** (by invoiceId, bankTxnId, (tenantId,createdAt), paymentId) | B | 1.5 | |
| 17 | BE-7b Dual-write shim + **idempotent cursor-based backfill script with dry-run mode, resumability, progress telemetry** | B | 4 | **MOD**: real migration tool, not a script; staging dry-run gate |
| 18 | **BE-7-CONSIST NEW** Dual-write consistency check: nightly cron comparing `ReconciliationMapping` vs inline `matchedInvoiceId`; alerts on divergence | B | 1.5 | |
| 19 | BE-13 `/api/reports/tds-liability` endpoint | B | 1.5 | |
| 20 | **RUNBOOK-2 NEW** TDS + AuditLog runbook: cumulative ledger corruption recovery, audit-drop investigation, backfill rerun | Ops | 1 | |
| 21 | FE-10 TDS Dashboard (FY switcher, quarter drill-down, KPIs, liability table, cumulative chart) | F | 4 | **MOD**: FY switcher mandatory; 4-state contract; chart lib decided before PR (Recharts vs custom SVG) |

---

# Wave 2-Bridge — Bridge foundations (weeks 4-12, parallel)

| # | PR | B/F/Bridge | E | Notes |
|---|----|-----------|---|-------|
| 22 | **BRIDGE-THREAT NEW** Threat model + security review doc: mTLS handshake, credential-store attack surface, pairing flow, replay attacks | Docs | 3 | Must sign off before BRIDGE-4 lands |
| 23 | **BRIDGE-CA NEW** Internal CA for mTLS issuance (step-CA or equivalent); cert lifecycle policy; revocation distribution plan | Ops | 3 | |
| 24 | BRIDGE-1 `TallyClient` backend service (envelope builders, LINEERROR ordinal-correlated parser, **per-tenant mutex + circuit breaker + exponential backoff**, `SVCURRENTCOMPANY` always-on) | B | 5 | **MOD**: CB + backoff added; pair-review gate |
| 25 | BRIDGE-2 `TenantTallyCompany` model | B | 1.5 | |
| 26 | BRIDGE-3a `BridgeAgent` model + pairing API + liveness + **outbound command queue with command-ID replay dedup** | B | 3 | **MOD**: split from v3 BRIDGE-3 |
| 27 | **BRIDGE-3b NEW** mTLS cert issuance + rotation (dual-cert overlap, offline grace, revocation list distribution, renewal scheduling) | B | 3 | Separate PR per BE-Integration flag |
| 28 | **BRIDGE-4a NEW** Bridge core: Go service, long-poll client, command dispatcher, replay dedup | Bridge | 5 | Was v3 BRIDGE-4 (part 1 of 7) |
| 29 | **BRIDGE-4b NEW** Windows service wrapper + system tray UI + credential store (DPAPI) | Bridge | 4 | |
| 30 | **BRIDGE-4c NEW** Self-signed MSI installer + uninstall cleanup + customer-facing install doc with SmartScreen walkthrough | Bridge | 3 | **MOD**: stub signing path; no cert calendar wait; −2d |
| 31 | **BRIDGE-4d NEW** Auto-update channel (Squirrel.Windows): delta updates, rollback channel, version-skew handling | Bridge | 4 | |
| 32 | **BRIDGE-4e NEW** Telemetry + crash reporting (OpenTelemetry → cloud; Sentry for crashes) | Bridge | 3 | |
| 33 | **BRIDGE-4f NEW** Startup checks: NTP skew detection, Tally reachability probe, credential-store health, version probe cache | Bridge | 2 | |
| 34 | **BRIDGE-4g NEW** Multi-machine pairing: Tally-on-shared-server scenario; single-active-bridge-per-tenant enforcement | Bridge | 3 | |
| 35 | BRIDGE-5 Bridge Tally connector: local HTTP client to `:9000`, retry/timeout, version branch (ERP9 vs Prime vs Server) | Bridge | 3 | |
| 36 | **BRIDGE-CHAOS NEW** Chaos harness: Tally kill mid-batch, network drop during long-poll, clock skew, disk-full credential store, AV quarantine simulation | Bridge | 3 | |
| 37 | **BRIDGE-OBS NEW** Observability: metrics (liveness SLO, request success rate, partial-failure rate, drift lag), dashboards, alerts | Ops | 2.5 | |
| 38 | **RUNBOOK-3 NEW** Bridge operations runbook: offline diagnosis, re-pairing, cert rotation, AlterID rollback | Ops | 1.5 | |

**Bridge block total: 51 days** (vs v3's 13). Matches PM-GTM / BE-Integration reality checks.

---

# Wave 3 — Vendor CRUD (weeks 7-10)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 39 | BE-8a VendorMaster fields + Tenant `tan` + `tallyLedgerGuid` + `deducteeType` + `msmeClassificationHistory[]` | B | 2 | **MOD**: MSME history array (not single flag); pre-positioned for Wave 10 |
| 40 | BE-8b `VendorService` CRUD + merge (MongoDB txns) + Section-197 cert + `/api/vendors` routes + GSTIN-first matching (documented priority order) | B | 3.5 | **MOD**: transactional merge; GSTIN-first enforced |
| 41 | **RUNBOOK-4 NEW** Vendor operations runbook: merge rollback, GSTIN conflict resolution, Section 197 cert expiry | Ops | 1 | |
| 42 | FE-11a Vendor list (search, filter, sort, pagination, virtualised rows ≥500) | F | 3 | **MOD**: virtualisation via react-window |
| 43 | FE-11b Vendor detail — invoices + TDS sub-tabs + `VendorMergeDialog` | F | 3 | **MOD**: 4-state contract; deep-link `/vendors/:fp` |

---

# Wave 3-Tally — Vendor sync end-to-end (weeks 10-13) — **re-sequenced: wizard first**

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 44 | BRIDGE-11 Onboarding wizard (FE): connect Tally → verify company GUID → **hard-gate on F12 "Overwrite by GUID"** → initial ledger pull progress | F | 4.5 | **MOVED earlier** — must precede BRIDGE-6 pull |
| 45 | BRIDGE-6 `VendorSyncService`: onboarding ledger pull, GSTIN-first matching, Tally GUID persistence, idempotent upsert | B | 4 | **MOD**: depends on BRIDGE-11 wizard completion |
| 46 | BRIDGE-7 AlterID drift reconciliation **+ rollback/regression detection (AlterID going backwards → full re-sync trigger)** + diff → AuditLog | B | 4 | **MOD**: rollback path per BE-Data feedback |
| 47 | BRIDGE-12 Tally connection health panel (FE) | F | 2 | |
| 48 | BRIDGE-10 Ledger conflict resolution UI (FE) | F | 2.5 | **MOD**: 4-state contract |

---

# Wave 4 — Payments core (weeks 11-15)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 49 | BE-9 `Payment` model + invoice `paymentStatus`/`paidAmountMinor`/`gstTreatment` | B | 1.5 | |
| 50 | BE-10 `PaymentService` + routes + allocation validation + duplicate-UTR + **MongoDB transactions** around multi-doc writes (Payment + Invoice + TdsVendorLedger + AuditLog + ReconciliationMapping) + post-`$inc` status recompute | B | 6 | **MOD**: real txns, not $inc alone; pair-review gate |
| 51 | BE-11 Reversal flow + cash-limit risk signal | B | 2 | |
| 52 | **BE-OAR002 NEW** Backdated-invoice TDS recompute: ledger-entry reversal + rerun flow. Addresses OAR-002. | B | 4 | Required for compliance product, not deferrable |
| 53 | **RUNBOOK-5 NEW** Payment operations runbook: duplicate-UTR investigation, partial-payment correction, reversal disputes | Ops | 1 | |
| 54 | FE-12 Payment recording UI (single + multi-invoice, progress bar, status badge) | F | 5 | **MOD**: 4-state contract; server-error mapping; unsaved-changes guard; live-region announcements |
| 55 | FE-13 Payment/aging columns + history panel | F | 3 | |

---

# Wave 5 — Tally payment vouchers + TDS statutory tags (weeks 15-17)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 56 | **BE-30 MOVED** Tally TDS statutory module tags (`TDSAPPLICABLE`, `TDSDEDUCTEETYPE`, `TDSPAYMENTTYPE`) on purchase voucher export | B | 2 | **MOVED from Wave 11** per EM-Delivery + PM-Compliance |
| 57 | BRIDGE-8 Pre-export vendor-existence check: fail-fast or auto-create path | B | 2 | |
| 58 | BRIDGE-9 Settlement precheck: fetch Bills Outstanding **with per-tenant TTL cache + batching + latency SLO** | B | 4 | **MOD**: caching + SLO per BE-Integration |
| 59 | BE-12 Payment voucher XML + export endpoint + BRIDGE-8/9 integration | B | 2.5 | |
| 60 | **BE-12-FALLBACK NEW** File-only export path when bridge offline: explicit UX + warning banner + audit trail of "unverified" vouchers | B | 2 | Per EM-Delivery — fallback is a feature, not a banner |
| 61 | FE-14 Payment-voucher export panel + bridge-offline fallback UX | F | 2 | **MOD**: fallback designed, not improvised |
| 62 | FE-11c Vendor detail — payments sub-tab | F | 1.5 | |

---

# Wave 6 — Reports + ReportService extraction (weeks 17-18)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 63 | BE-16 Aging endpoint (`GET /api/reports/payment-aging`) | B | 1 | |
| 64 | FE-15a Aging-report view | F | 1.5 | |
| 65 | BE-17 Refactor: extract `ReportService` (rule-of-3 trigger) | B | 1.5 | |

---

# Wave 7 — Reconciliation v2 core (weeks 18-20)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 66 | BE-14a TDS-adjusted scoring + ±2 business-day tolerance + junction-table read cutover | B | 2.5 | |
| 67 | FE-16a Surface TDS-adjusted expected-debit in `BankStatementsTab` | F | 1 | |
| 68 | **RUNBOOK-6 NEW** Reconciliation runbook: scoring-threshold tuning, junction-table debugging | Ops | 1 | |

---

# Wave 8 — Inline cleanup + split/aggregate (weeks 20-23) — **re-sequenced**

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 69 | **BE-15 MOVED** Cleanup inline `matchedInvoiceId` (after ≥2-week stability post-Wave 7 + dual-write consistency green for 2 weeks) | B | 2 | **MOVED from Wave 7** per EM-Delivery; staging dry-run gate |
| 70 | BE-14b Split-detection algorithm (subset-sum ≤10 invoices, greedy pre-filter) | B | 4 | |
| 71 | BE-14c Aggregate-detection algorithm | B | 3 | |
| 72 | BE-18 Reconciliation summary endpoint | B | 1 | |
| 73 | FE-16b Reconciliation split-pane redesign (two-column, resizable divider, **keyboard-resizable with Arrow keys**) | F | 5 | **MOD**: keyboard resize; 8-state audit (2 columns × 4 states) |
| 74 | FE-17a `SplitMatchPanel` + live sum check + unmatch | F | 3 | |
| 75 | FE-17b `AggregateMatchPanel` + cumulative display | F | 2.5 | |
| 76 | FE-15b Reconciliation summary view | F | 1.5 | |
| 77 | FE-4b Refactor: extract `Portal` (rule-of-3 trigger) | F | 1 | |

---

# Wave 9 — Payment runs + bank files (weeks 23-25)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 78 | BE-19 `PaymentRun` model + service + `/api/payment-runs` | B | 3 | |
| 79 | BE-20 Bank payment-instruction file generator (NEFT/RTGS formats) | B | 3 | |
| 80 | FE-18 Payment Run UI (create, review, approve, download) | F | 4 | |

---

# Wave 10 — MSME + vendor detail expansion (weeks 25-26)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 81 | BE-21 MSME tracking (uses `msmeClassificationHistory` from BE-8a); `MSME_PAYMENT_OVERDUE`/`_APPROACHING` risk signals | B | 2 | |
| 82 | BE-22 MSME interest calculator (3× bank rate, compounded monthly) | B | 2 | |
| 83 | FE-11d Vendor detail — bank sub-tab | F | 1.5 | |
| 84 | FE-11e Vendor detail — MSME sub-tab + interest display | F | 2 | |
| 85 | FE-19 Refactor: extract `useRovingTabIndex` (rule-of-3 trigger) | F | 1 | |

---

# Wave 11 — TDS compliance depth (weeks 26-30) — **BE-23 CUT; 194Q + Form 16A added**

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| ~~63~~ | ~~BE-23 Section 206AB stub~~ | — | — | **CUT** per EM-Delivery; re-introduce only when real CBDT integration is viable |
| 86 | BE-24 Form 26Q FVU export (leverages BE-30 statutory tags) | B | 4 | |
| 87 | BE-25 TDS challan tracking model + service | B | 3 | |
| 88 | **BE-31 NEW** Section 194Q buyer-TDS cumulative tracking (parallel data model to TdsVendorLedger, triggered from Invoice side) + **Section 206C(1H) TCS cumulative** (same infra) | B | 5 | Per PM-Compliance; major compliance hole |
| 89 | **BE-33 NEW** Form 16A generation (vendor-facing TDS certificate, 15-day post-26Q deadline) + email delivery | B | 4 | Per PM-Compliance; statutory deliverable |
| 90 | FE-20 TDS filing dashboard (challan status, 26Q download, 194Q cumulative view) | F | 3.5 | |
| 91 | **FE-27 NEW** Form 16A send UI (single + bulk, preview, delivery status) | F | 2 | |

---

# Wave 12 — GSTR-2B / ITC (weeks 30-32)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 92 | BE-26 `Invoice.itcEligible` field + enum extension | B | 1 | |
| 93 | BE-27 GSTR-2B JSON import + matching service | B | 4 | |
| 94 | FE-21 GSTR-2B matching UI | F | 3 | |

---

# Wave 13 — Auditor-usable audit log + UX redesign (weeks 32-35)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 95 | **BE-34 NEW** AuditLog CSV/PDF export API + filter-by-regulator-style-query | B | 3 | Per PM-Compliance; auditor-usable, not just schema-present |
| 96 | **FE-28 NEW** Audit log viewer: searchable, filterable, exportable | F | 3 | |
| 97 | FE-22 Navigation sidebar (8-item) + `TenantSidebar` | F | 3 | |
| 98 | FE-23 App-shell restructure (sidebar, hash routing) + URL-migration banner for bookmarked pages | F | 3 | **MOD**: URL migration |
| 99 | BE-28 `GET /api/tenant/setup-progress` endpoint | B | 1 | |
| 100 | FE-24 Setup wizard / onboarding flow | F | 4 | |

---

# Wave 14 — Value-adds (weeks 35-37)

| # | PR | B/F | E | Notes |
|---|----|-----|---|-------|
| 101 | BE-29 Payment advice generation (PDF + email) | B | 3 | |
| 102 | FE-25 Payment advice send UI | F | 1.5 | |
| 103 | FE-26 Tax calendar (TDS deposits, GST filings, MSME deadlines) | F | 2 | |

---

# Totals

- **103 PRs** (77 in v3 + 26 new; 2 cut [BE-23, PROCURE-1]; STUB-SIGN replaces PROCURE-1)
- **~260 eng-days base effort**
- **With 40% risk buffer: ~365 eng-days, ~37 calendar weeks** (user as Go + primary engineer + Mahir as CA gate; Claude-as-second-reviewer for pair-gated PRs)
- ~~EV cert calendar wait~~ — eliminated by stub signing

## Critical path v4.1

- Track 0 foundation → gates EVERYTHING else (weeks 0-2)
- ~~PROCURE-1 → BRIDGE-4c (calendar-gated)~~ — **CUT, stub-signing path**
- BE-1/BE-2 → unblocks Tally exports
- BRIDGE-1..5 → BRIDGE-11 wizard → BRIDGE-6 pull → BRIDGE-7 drift
- BE-3/BE-4/BE-5 → BE-13 → FE-10 (TDS end-to-end)
- BE-8a/b → BE-9 → BE-10 (txn-safe) → BE-12 (gated on BRIDGE-9)
- BE-12 → BE-30 (now Wave 5, together)
- Wave 7 cutover → 2wk stability → Wave 8 BE-15 cleanup

## WIP cap enforcement

Main thread refuses to spawn PR N+3 while 3 are open. Priority when cap hit: pair-review-gate PRs > critical-path PRs > runbooks > cleanups.

## Known unresolved questions (OAR carry-over)

- OAR-001 Section 197 cert authenticity (TRACES API) — still deferred
- OAR-002 Backdated TDS recompute — **NOW ADDRESSED by BE-OAR002 in Wave 4**
- OAR-006 Payment reversal auto-detection from bank patterns — still deferred
- OAR-007 Tally statutory TDS vs manual 26Q — **addressed by BE-30 + BE-24**
- OAR-009 Multi-currency Tally export — still deferred
- OAR-010 TDS challan tracking scope — addressed by BE-25
- OAR-015 GSTR-2B matching strategy — addressed by Wave 12

## Memory entries to update before Round 2

- `feedback_pr_workflow.md` — add WIP cap + pair-review gate + test-heavy exception + staging dry-run gate
- `reference_agent_briefing.md` — same additions, plus 4-state UX contract for FE PRs
- `reference_tally_integration.md` — write the 11-rule reference (previously planned)
- `project_accounting_payments.md` — update scope, timeline, effort
