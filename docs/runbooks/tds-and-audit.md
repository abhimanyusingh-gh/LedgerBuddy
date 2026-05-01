# TDS cumulative + AuditLog runbook

Audience: LedgerBuddy ops on-call and CA-firm ops handling vendor TDS reconciliation.

This runbook covers what operators need to keep the cumulative TDS ledger and the AuditLog write path healthy: how to diagnose vendor TDS deltas against Form 26Q, how to read and unstick a stuck `TdsVendorLedger` document, how to query the audit trail before BE-6 ships a public API, and how to drain the AuditLog dead-letter queue when the primary write path is degraded. It assumes familiarity with Indian TDS sections (194C / 194J / 194I / 194H / 194Q) and basic Mongo shell usage; it does not assume familiarity with LedgerBuddy's internal services.

Source code paths below are given as `file:line` so operators can jump to the exact location when collaborating with engineering. Code is the source of truth; if a citation drifts, raise it.

Related references:
- `docs/accounting-payments/MASTER-SYNTHESIS.md` §2.4 — TDS computation flow (algorithm and edge cases).
- `docs/accounting-payments/MASTER-SYNTHESIS.md` §11.4 — AuditLog write-failure policy (D-039).
- `docs/accounting-payments/RFC-BACKEND.md` §4.1.6 — `TdsVendorLedgerService` design.
- `docs/accounting-payments/RFC-BACKEND.md` §4.5 — AuditLog service design + actions dictionary.
- `docs/accounting-payments/RFC-BACKEND.md` §6 Phase 1 — TDS rollout / rollback plan.
- `backend/src/models/compliance/TdsVendorLedger.ts` — ledger schema + indexes.
- `backend/src/models/core/AuditLog.ts` — AuditLog schema (no TTL — C-006 / C-019).
- `backend/src/models/core/AuditLogDeadLetter.ts` — dead-letter schema.
- `backend/src/services/compliance/TdsCalculationService.ts` — pure rate / threshold logic.
- `backend/src/services/compliance/tdsOrchestrator.ts` — call-site that decides whether to record to the ledger.
- `backend/src/services/tds/TdsVendorLedgerService.ts` — atomic upsert into `tdsvendorledgers`.
- `backend/src/services/tds/fiscalYearUtils.ts` — IST-anchored FY + quarter derivation.
- `backend/src/services/core/AuditLogService.ts` — fire-and-forget write + dead-letter retry.

## 1. Pre-requisites

Before debugging a TDS or AuditLog incident, the following must be true.

### 1.1 Mongo shell access scoped to tenant

All queries in this runbook operate against the production `auditlogs`, `auditlogdeadletters`, and `tdsvendorledgers` collections. Operators must:

- Have read access to the production cluster via the jumpbox `mongosh` profile.
- Always include `tenantId: ObjectId("...")` (or the string-form `tenantId: "..."` — the schema stores it as `String` per `backend/src/models/compliance/TdsVendorLedger.ts:6` and `backend/src/models/core/AuditLog.ts:22`) in every query. Cross-tenant queries are forbidden by policy.
- Never `update`, `delete`, or `findAndModify` against `auditlogs` (C-006 — see §4.2). `tdsvendorledgers` is mutable but should only be touched via the service or the documented rollback procedure (§5).

### 1.2 Knowing the FY string format

`determineFY` at `backend/src/services/tds/fiscalYearUtils.ts:47` produces strings of the form `YYYY-YY` anchored to IST: an invoice dated `2026-04-15T05:30:00+05:30` belongs to FY `2026-27`; an invoice dated `2026-03-31T18:30:00Z` (which is `2026-04-01 00:00 IST`) also belongs to FY `2026-27`. Always pass the FY exactly as the service stored it; the unique index at `backend/src/models/compliance/TdsVendorLedger.ts:46` keys on `{tenantId, vendorFingerprint, financialYear, section}` and a typo (e.g. `2026-2027`) will look like a missing document.

### 1.3 Vendor fingerprint is opaque

`vendorFingerprint` is the GSTIN-derived stable identifier the orchestrator passes in (`backend/src/services/compliance/tdsOrchestrator.ts:14`). Operators should obtain it from the invoice document or from the upstream vendor lookup; do not synthesise it from the vendor display name.

### 1.4 Section codes are bare strings

`section` on the ledger is a string like `"194C"`, `"194J"`, `"194Q"` — no whitespace, no prefix. The schema at `backend/src/models/compliance/TdsVendorLedger.ts:9` does not enum-constrain it, so a typo will silently create a parallel ledger row. When writing queries, copy the section value from the failing invoice's compliance subdocument.

## 2. TDS troubleshooting flowchart

```
Customer reports vendor TDS mismatch
            │
            ▼
Confirm: which invoice(s) and which FY?
            │
            ▼
Pull invoice from DB  ──▶  read invoice.compliance.tds (rateBps, section, FY, quarter)
            │
            ▼
Query TdsVendorLedger for {tenantId, vendorFingerprint, FY, section}
            │
            ├─ no doc found ───────▶ §3.2 (threshold-not-emitted / not-recorded)
            │
            ├─ doc found but cumulativeBaseMinor < expected
            │                  ──▶ §3.1 (Form 26Q reconciliation)
            │
            ├─ doc found but rateBps differs from invoice
            │                  ──▶ §3.4 (cert expired / rate hierarchy drift)
            │
            └─ doc found, cumulative concurrent-write looks wrong
                               ──▶ §3.5 (concurrent-write drift)

For backdated catch-up: §3.3.
For audit trail of a manual override: §4.1.
```

## 3. Procedures

### 3.1 Vendor TDS doesn't match Form 26Q expectation

**Inputs**: `tenantId`, `vendorFingerprint`, `financialYear` (e.g. `"2026-27"`), `section` (e.g. `"194C"`).

**Steps**:

1. Pull the ledger row:
   ```
   db.tdsvendorledgers.findOne({
     tenantId: "<tenantId>",
     vendorFingerprint: "<vendorFingerprint>",
     financialYear: "2026-27",
     section: "194C"
   })
   ```
2. Compare `cumulativeBaseMinor` and `cumulativeTdsMinor` against the customer's expected Form 26Q totals. Both fields are minor units (paise) per the integer validators at `backend/src/models/compliance/TdsVendorLedger.ts:13` / `:21`. Divide by 100 for rupee comparison.
3. If cumulative is **lower** than expected, inspect `entries[]` and cross-reference each `invoiceId` against the source invoice. Missing invoices indicate the orchestrator's `shouldRecord` gate skipped them — see `backend/src/services/compliance/tdsOrchestrator.ts:56` (gates: `!dryRun && invoiceId && section && quarter && taxableAmountMinor > 0`).
4. If cumulative is **higher** than expected, look for duplicate `invoiceId` values inside `entries[]`. The service does not deduplicate — every `recordTdsToLedger` call `$inc`s and `$push`es (`backend/src/services/tds/TdsVendorLedgerService.ts:87`), so a re-run of the orchestrator on the same invoice double-counts. This is the most common cause of inflation.
5. Reconcile by quarter:
   ```
   db.tdsvendorledgers.aggregate([
     { $match: { tenantId: "<tenantId>", financialYear: "2026-27", section: "194C" } },
     { $unwind: "$entries" },
     { $group: { _id: "$entries.quarter", base: { $sum: "$entries.taxableAmountMinor" }, tds: { $sum: "$entries.tdsAmountMinor" } } }
   ])
   ```

**Expected outputs**: Aggregation totals reconcile against the customer's Q1/Q2/Q3/Q4 challan totals.

**Rollback path**: Do not edit `entries[]` in place. If the row is genuinely corrupt, follow §5 (drop and rebuild for the affected vendor only).

### 3.2 Ledger row missing or threshold-crossed signal not emitted

Note: `TDS_CUMULATIVE_ENABLED` is **not** a feature flag in the registry (`backend/src/services/flags/featureFlagRegistry.ts`) — the cumulative path is always on. Diagnose via caller-side discipline rather than flag state.

**Inputs**: `tenantId`, `vendorFingerprint`, `invoiceId`.

**Steps**:

1. Verify the orchestrator was actually invoked. The decision to record lives at `backend/src/services/compliance/tdsOrchestrator.ts:56`:
   ```
   const shouldRecord = !dryRun
     && invoiceId
     && result.tds.section
     && result.tds.quarter
     && result.ledgerDelta.taxableAmountMinor > 0;
   ```
   Any falsy condition causes a silent skip — no ledger row, no `thresholdCrossedAt`. Check the invoice for: missing `invoiceId`, dry-run mode, missing detected section (i.e. no GL category mapping), missing quarter, or zero taxable base.
2. Confirm `TdsCalculationService.detectSection` returned a section. If the invoice's `glCategory` and PAN-derived `panCategory` don't resolve to a `TdsSectionMapping`, the result short-circuits at `backend/src/services/compliance/tdsOrchestrator.ts:32` and never reaches the ledger.
3. Inspect the invoice's compliance result. If `result.ledgerDelta.thresholdJustCrossed === true` but the ledger row has `thresholdCrossedAt: null`, the orchestrator skipped recording — re-check step 1.
4. To force a recompute on a single invoice, re-trigger compliance enrichment via the admin path. Do not write to `tdsvendorledgers` by hand.

**Expected outputs**: A ledger row with `cumulativeBaseMinor > 0` and, if the threshold was crossed, a non-null `thresholdCrossedAt`.

**Rollback path**: None — recording is idempotent in intent but additive in implementation. If a manual recompute double-records, follow §5.

### 3.3 Backdated invoice catch-up (OAR-002 manual procedure)

A backdated invoice is one whose `invoice.invoiceDate` falls in an earlier FY or quarter than the processing date. Per `MASTER-SYNTHESIS.md` §2.4 edge cases, FY is taken from the invoice date, not processing date — so a backdated invoice will land on the older FY's ledger row.

**Inputs**: `tenantId`, `vendorFingerprint`, the affected `invoiceId`, the historical `invoiceDate`.

**Steps**:

1. Confirm the invoice routed to the correct FY:
   ```
   db.tdsvendorledgers.findOne({
     tenantId: "<tenantId>",
     vendorFingerprint: "<vendorFingerprint>",
     section: "<section>",
     "entries.invoiceId": "<invoiceId>"
   }, { financialYear: 1, "entries.$": 1 })
   ```
2. The returned `financialYear` must equal `determineFY(invoiceDate)` (`backend/src/services/tds/fiscalYearUtils.ts:47`). If it landed on the wrong FY, that is a bug — open an engineering ticket with the invoice ID.
3. Catch-up TDS computation: per the synthesis algorithm, threshold-crossing logic compares the running cumulative on the **historical** FY ledger row against the per-section annual threshold. If the catch-up causes a late threshold crossing, `thresholdCrossedAt` is set to the catch-up `recordedAt`, not the historical invoice date — the field tracks discovery time, not crossing time.

**Expected outputs**: Ledger row on the correct FY, with the invoice's entry present and the cumulative incremented.

**Rollback path**: §5 (drop + rebuild for the affected `{tenantId, vendorFingerprint, FY, section}` only).

### 3.4 Cert expired but old rate still applied

The TDS rate hierarchy at `MASTER-SYNTHESIS.md` §2.4 step 3 puts Section 197 lower-deduction certs first. If a vendor's cert expired between two invoices, the second invoice should fall back to standard rate.

**Inputs**: `tenantId`, `vendorFingerprint`, the suspect `invoiceId`.

**Steps**:

1. Pull the ledger and find the entry's `rateSource`:
   ```
   db.tdsvendorledgers.findOne(
     { tenantId: "<tenantId>", vendorFingerprint: "<vendorFingerprint>", financialYear: "<FY>", section: "<section>" },
     { entries: { $elemMatch: { invoiceId: "<invoiceId>" } } }
   )
   ```
2. The `rateSource` enum values come from `backend/src/types/invoice.ts:132` (`TDS_RATE_SOURCE`). If you see `"section197"` on an invoice whose date is past the cert's `validTo`, the cert was treated as valid at compute time. Inspect the vendor's `lowerDeductionCert` payload (passed into the orchestrator as `vendorCert` at `backend/src/services/compliance/tdsOrchestrator.ts:17`) and confirm the `validTo` was correctly populated upstream.
3. Force a recompute by re-running compliance enrichment on the invoice after correcting the cert expiry on the vendor record. The recompute will produce a corrected `result`, but the existing `entries[]` row is **not** updated in place — see §5 for how to retire the bad entry.

**Expected outputs**: New compliance result on the invoice with the correct `rateSource` (typically `"rateTable"` or `"tenantOverride"` for an expired cert). Until §5 runs, the cumulative includes both the bad and corrected entries — alert the operator.

**Rollback path**: §5.

### 3.5 Concurrent-write drift detection

The ledger relies on Mongo's atomic `$inc` + `$push` (`backend/src/services/tds/TdsVendorLedgerService.ts:96`) per D-038. Concurrent invoice processing for the same `{tenantId, vendorFingerprint, FY, section}` must converge to the sum of inputs.

The chaos test at `backend/src/services/tds/TdsVendorLedgerService.test.ts:177` ("RFC §7.1 case 12 — concurrent writes produce final cumulative = sum of inputs") asserts this invariant for `N=50` parallel writes. If you observe drift in production:

1. Check `invoiceCount` against `entries.length`:
   ```
   db.tdsvendorledgers.aggregate([
     { $match: { tenantId: "<tenantId>", financialYear: "<FY>" } },
     { $project: { vendorFingerprint: 1, section: 1, invoiceCount: 1, entriesLen: { $size: "$entries" } } },
     { $match: { $expr: { $ne: ["$invoiceCount", "$entriesLen"] } } }
   ])
   ```
2. A mismatch indicates either (a) a write that bypassed the service, or (b) a Mongo replica-set step-down mid-write that the driver did not retry. Both are escalations, not operator fixes.
3. Cross-check `cumulativeBaseMinor === sum(entries.taxableAmountMinor)` and `cumulativeTdsMinor === sum(entries.tdsAmountMinor)` per row. Same query shape as above with `$sum` projections.

Chaos coverage during archival / split is expanded by #278 if merged — once that lands, this section will reference the archival-specific concurrency tests.

**Rollback path**: §5 if drift is isolated to one vendor / FY / section. If drift is cluster-wide, halt the polling tick (`backend/src/server.ts:52`) and escalate.

## 4. AuditLog operations

### 4.1 Searching by user / date / entity

`BE-6-QUERY` (the public AuditLog query API) is **not yet shipped**. Until then, raw Mongo queries against the `auditlogs` collection are the only path. The collection has four indexes (`backend/src/models/core/AuditLog.ts:38`–`:41`) — every query below is index-aligned.

By entity (most common — "what happened to invoice X?"):
```
db.auditlogs.find({
  tenantId: "<tenantId>",
  entityType: "invoice",
  entityId: "<invoiceId>"
}).sort({ timestamp: -1 })
```

By user (compliance question — "what did this user change today?"):
```
db.auditlogs.find({
  tenantId: "<tenantId>",
  userId: "<userId>",
  timestamp: { $gte: ISODate("2026-04-28T00:00:00Z") }
}).sort({ timestamp: -1 })
```

By action (e.g. "every TDS manual override this FY"):
```
db.auditlogs.find({
  tenantId: "<tenantId>",
  action: "tds_manual_override",
  timestamp: { $gte: ISODate("2026-04-01T00:00:00Z") }
}).sort({ timestamp: -1 })
```

`entityType` values come from the enum at `backend/src/models/core/AuditLog.ts:3` (`AUDIT_ENTITY_TYPE`): `tds_manual_override`, `gl_override`, `vendor`, `config`, `invoice`, `payment`, `bank_transaction`, `reconciliation`, `export`, `approval`. The full action dictionary is in `RFC-BACKEND.md` §4.5.

`previousValue` and `newValue` are `Mixed` per `backend/src/models/core/AuditLog.ts:26` — operators must inspect them as opaque JSON; no schema is enforced.

### 4.2 Why we never delete from `auditlogs` (C-006 / C-019)

`auditlogs` is **immutable by policy**. Per C-006 the `timestamp` field is canonical (Mongoose `timestamps: false` at `backend/src/models/core/AuditLog.ts:33`); per C-019 there is **no TTL index** — compliance tenants require minimum 8-year retention (`MASTER-SYNTHESIS.md` §10.4 line 870). Operators must never:

- `db.auditlogs.deleteOne(...)` or `deleteMany(...)`.
- `updateOne` / `updateMany` against any document (even to "fix" a typo in `previousValue`).
- Drop the collection, even on a non-prod tenant — there is no migration story for restoring it.

If a write went in with bad data (e.g. wrong `userEmail`), record a compensating event with a new audit row (e.g. `action: "audit_correction"`) referencing the bad row's `_id`. Never mutate the original.

### 4.3 Dead-letter cron retry — inspect / drain manually

AuditLog writes are fire-and-forget per D-039 (`backend/src/services/core/AuditLogService.ts:36`). On primary-write failure, the payload is enqueued onto `auditlogdeadletters` (`backend/src/services/core/AuditLogService.ts:118`) with an exponential backoff schedule.

Backoff schedule (`backend/src/services/core/AuditLogService.ts:16`):

| Attempt | Delay before next try |
|---|---|
| 0 → 1 | 1h |
| 1 → 2 | 2h |
| 2 → 3 | 4h |
| 3 → 4 | 8h |

After 4 attempts (`AUDIT_RETRY_MAX_ATTEMPTS` at `backend/src/services/core/AuditLogService.ts:23`), the entry is marked `givenUp: true` and stays in `auditlogdeadletters` for manual investigation — it is never deleted automatically.

The retry tick is driven by the polling loop at `backend/src/server.ts:62` (`auditLogService.retryDeadLetters()`).

Inspect pending dead letters:
```
db.auditlogdeadletters.find({
  givenUp: false,
  nextAttemptAt: { $lte: new Date() }
}).sort({ nextAttemptAt: 1 })
```

Inspect given-up entries (manual investigation backlog):
```
db.auditlogdeadletters.find({ givenUp: true }).sort({ updatedAt: -1 })
```

Manual drain (only after engineering has fixed the root cause that caused the writes to fail):

1. For each entry, inspect `entry.payload` — it is the full document the service tried to write. Identify the failure mode in `entry.lastError`.
2. If the payload is recoverable, reset the entry to retry on the next tick:
   ```
   db.auditlogdeadletters.updateMany(
     { givenUp: true, /* additional filter to scope */ },
     { $set: { givenUp: false, attempts: 0, nextAttemptAt: new Date() } }
   )
   ```
3. The next polling tick will pick them up and attempt insertion into `auditlogs`. On success, the dead-letter row is deleted (`backend/src/services/core/AuditLogService.ts:69`); on failure, the backoff cycle restarts.
4. If the payload is not recoverable (e.g. bad enum value pre-#260), leave `givenUp: true` and document the decision — do **not** delete from `auditlogdeadletters` without explicit engineering sign-off.

## 5. Rollback procedure

These steps are destructive and must be run only with engineering sign-off and a customer-comms plan.

**Drop ledger rows for an affected tenant (full reset):**
```
db.tdsvendorledgers.deleteMany({ tenantId: "<tenantId>" })
```

**Drop ledger rows for one vendor / FY / section (preferred — minimum blast radius):**
```
db.tdsvendorledgers.deleteOne({
  tenantId: "<tenantId>",
  vendorFingerprint: "<vendorFingerprint>",
  financialYear: "<FY>",
  section: "<section>"
})
```

**Disable cumulative computation manually**: there is no kill switch — `TDS_CUMULATIVE_ENABLED` was not registered in the feature-flag registry per the #255 patch decision. To halt recording without a code revert, comment out or guard the `recordTdsToLedger` call at `backend/src/services/compliance/tdsOrchestrator.ts:63` and deploy. The pure compute path (`TdsCalculationService.computeTds`) is unaffected and continues to produce per-invoice TDS results.

**Re-trigger compliance enrichment**: per `RFC-BACKEND.md` §6 Phase 1 rollback plan, after dropping ledger rows, re-run compliance enrichment for the affected invoices via the admin recompute endpoint. Recompute is order-sensitive — process invoices in ascending `invoiceDate` so threshold-crossing is detected on the correct invoice.

**AuditLog has no rollback.** Per §4.2 you cannot delete from `auditlogs`. If a rollback of TDS ledger state needs to be auditable, write a compensating `audit_correction` event before dropping the ledger row.

## 6. Change log

- 2026-04-28 — Initial version. Closes #279.
