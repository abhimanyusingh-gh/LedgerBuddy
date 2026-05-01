# Vendor operations runbook

Audience: LedgerBuddy ops on-call and the customer's accounts-team admin handling vendor-master corrections.

This runbook covers what operators need to keep `VendorMaster` healthy across the high-risk mutations that span Phase 2: vendor merge (irreversible at the data layer per FR-VENDOR-014a), Section 197 lower-deduction certificate lifecycle, GSTIN-driven state-code drift, Tally ledger remapping, vendor blocking, and OCR-driven duplicate fingerprint cleanup. It also covers the AuditLog query patterns specific to `entityType: "vendor"` mutations. It assumes familiarity with Indian GSTIN / PAN / TDS basics and basic Mongo shell usage; it does not assume familiarity with LedgerBuddy's internal services.

Source code paths below are given as `file:line` so operators can jump to the exact location when collaborating with engineering. Code is the source of truth; if a citation drifts, raise it.

Vendor-merge sections (§3.1, §3.7) and several VendorMaster fields (`tallyLedgerName`, `vendorStatus`, `lowerDeductionCert`) are introduced by the Phase 2 work tracked under #261 (VendorMaster + Tenant fields) and #262 (VendorService CRUD + merge). Procedures that depend on those PRs landing are marked inline as **depends on #261/#262 landing**; the queries themselves are still safe to run today (the field will simply be absent on legacy rows).

Related references:
- `docs/accounting-payments/MASTER-SYNTHESIS.md` §4.2 — VendorMaster + Tenant + TenantExportConfig extensions.
- `docs/accounting-payments/MASTER-SYNTHESIS.md` §5.2 — Vendor REST API surface (list / detail / update / merge / cert).
- `docs/accounting-payments/MASTER-SYNTHESIS.md` §10.1 — VendorService responsibility matrix.
- `docs/accounting-payments/RFC-BACKEND.md` §4.6.1 — `VendorService` interface.
- `docs/accounting-payments/RFC-BACKEND.md` §4.6.2 — Vendor merge algorithm + Mongo transaction wrapper.
- `docs/accounting-payments/RFC-BACKEND.md` §6 Phase 2 steps 2.4–2.8 — vendor field rollout sequence.
- `backend/src/models/compliance/VendorMaster.ts` — vendor schema + indexes.
- `backend/src/services/compliance/VendorMasterService.ts` — upsert / bank-history derivation.
- `backend/src/constants/gstinStateCodes.ts` — `deriveVendorState(gstin, addressState)`.
- `backend/src/services/compliance/TdsCalculationService.ts` — Section 197 cert evaluation (`resolveEffectiveRate`).
- `backend/src/services/compliance/tdsOrchestrator.ts` — call-site that passes `vendorCert` to compute.
- `backend/src/models/compliance/TdsVendorLedger.ts` — ledger schema (consolidated during merge).
- `backend/src/models/core/AuditLog.ts` — AuditLog schema + `entityType: "vendor"` enum.
- `backend/src/services/core/AuditLogService.ts` — fire-and-forget write + dead-letter retry.

## 1. Pre-requisites

Before mutating a vendor record or chasing a vendor-mutation incident, the following must be true.

### 1.1 Mongo shell access scoped to tenant

All queries below operate against the production `vendormasters`, `tdsvendorledgers`, `auditlogs`, and `invoices` collections. Operators must:

- Have read access to the production cluster via the jumpbox `mongosh` profile.
- Always include `tenantId: "<tenantId>"` in every query — `VendorMaster.tenantId` is stored as `String` per `backend/src/models/compliance/VendorMaster.ts:18`. Cross-tenant queries are forbidden by policy.
- Always also include `clientOrgId: ObjectId("<clientOrgId>")` when querying `vendormasters` directly — the unique index at `backend/src/models/compliance/VendorMaster.ts:55` keys on `{clientOrgId, vendorFingerprint}`, so a tenant-only query can return rows from sibling client organisations.
- Never `update`, `delete`, or `findAndModify` against `auditlogs` (C-006 — see `docs/runbooks/tds-and-audit.md` §4.2). `vendormasters` is mutable but should only be touched via `VendorService` once #262 lands; until then, manual writes must be paired with a compensating AuditLog row (§3.8).

### 1.2 Vendor fingerprint format

`vendorFingerprint` is the GSTIN-first stable identifier the orchestrator passes through every compliance call (`backend/src/services/compliance/tdsOrchestrator.ts:16`). Per Tally rule #1, the priority is GSTIN → stored Tally GUID → normalised name → canonical abbreviation; operators should obtain the fingerprint from the failing invoice's metadata (`backend/src/services/invoice/invoiceService.ts:486`) or from the upstream `VendorMaster` document — never synthesise it from the display name, since OCR variants intentionally diverge.

The bank-account hash component used inside `bankHistory[]` is SHA-256 of the trimmed account number (`backend/src/services/compliance/VendorMasterService.ts:160`); operators should never compare raw account numbers across rows — always hash first if you need to match.

### 1.3 Reading AuditLog by vendor

The AuditLog write path is fire-and-forget per D-039 (`backend/src/services/core/AuditLogService.ts:36`); when a vendor mutation appears not to have an audit trail, first check `auditlogdeadletters` (see `docs/runbooks/tds-and-audit.md` §4.3) before assuming the mutation bypassed the service.

The `entityType` value for every vendor mutation is the bare string `"vendor"` per the enum at `backend/src/models/core/AuditLog.ts:6`. `entityId` for vendor rows is the `vendorFingerprint`, **not** the Mongo `_id`. The action dictionary for vendor mutations (e.g. `vendor_updated`, `vendor_merged`, `vendor_status_changed`, `vendor_cert_uploaded`) is documented at `docs/accounting-payments/RFC-BACKEND.md` lines 1444–1445; the full set is finalised by #262.

## 2. Vendor mutation flowchart

```
Customer reports vendor anomaly (wrong rate / wrong state / merged badly / blocked vendor still routing)
            │
            ▼
Identify vendorFingerprint + clientOrgId (from invoice or upstream)
            │
            ▼
Pull VendorMaster ──▶ inspect: gstin, stateCode, vendorStatus,
            │                    tallyLedgerName, lowerDeductionCert
            │
            ▼
Query auditlogs (entityType:"vendor", entityId:<fingerprint>)
            │
            ├─ recent merge event ──────────────▶ §3.1 (merge un-do via replay)
            │
            ├─ cert-related anomaly
            │   ├─ cert past validTo ──────────▶ §3.2 (cert expired)
            │   └─ cumulative > maxAmountMinor ▶ §3.3 (cert exhausted)
            │
            ├─ GSTIN changed since last seen ──▶ §3.4 (state re-derive)
            │
            ├─ tallyLedgerName mismatch in export ▶ §3.5 (ledger rename)
            │
            ├─ blocked vendor still routes to AWAITING_APPROVAL
            │                  ─────────────────▶ §3.6 (verify routing)
            │
            └─ duplicate fingerprint suspected ─▶ §3.7 (manual merge)

For audit-trail forensics on any of the above: §3.8.
```

## 3. Procedures

### 3.1 Vendor merge un-do via AuditLog replay

**Background**: The merge implemented in #262 is wrapped in a Mongo transaction (`docs/accounting-payments/RFC-BACKEND.md` §4.6.2). On commit, the source `VendorMaster` is soft-deleted (`vendorStatus: "inactive"`, `mergeStatus: "completed"`), source `TdsVendorLedger` rows are summed into the target via atomic `$inc` + `$push` and then deleted, and source `VendorGlMapping` / `VendorCostCenterMapping` rows are upserted into the target and deleted. There is **no built-in un-merge**: the consolidated cumulatives lose their per-source attribution, and the ledger consolidation is destructive at the row level (the source rows no longer exist).

Recovery is therefore an audit-replay, not a database-level rollback. **Depends on #262 landing.**

**Inputs**: `tenantId`, target `vendorFingerprint`, approximate merge timestamp.

**Steps**:

1. Locate the merge event in `auditlogs`:
   ```
   db.auditlogs.find({
     tenantId: "<tenantId>",
     entityType: "vendor",
     action: "vendor_merged",
     entityId: "<targetFingerprint>",
     timestamp: { $gte: ISODate("<approxMergeDate>") }
   }).sort({ timestamp: -1 }).limit(5)
   ```
   The `previousValue` field carries the pre-merge target snapshot; `newValue` carries the post-merge consolidated snapshot. The source vendor's full pre-merge state (including its per-source `TdsVendorLedger` rows and `VendorGlMapping` / `VendorCostCenterMapping` entries) is included by `VendorService.mergeVendors` per the merge-step contract at `docs/accounting-payments/RFC-BACKEND.md` lines 1500–1515.
2. Read the source vendor's pre-merge state from the same audit row (or, if the source's own `vendor_merged` row was emitted with `entityId: "<sourceFingerprint>"`, query for that). Per the §4.6.2 algorithm, the source is soft-deleted with `vendorStatus: "inactive"` and `mergeTargetFingerprint: "<targetFingerprint>"` — it is still queryable via:
   ```
   db.vendormasters.findOne({
     tenantId: "<tenantId>",
     vendorFingerprint: "<sourceFingerprint>"
   })
   ```
3. Re-create the source `VendorMaster` row by clearing `mergeStatus` / `mergeTargetFingerprint` and restoring `vendorStatus: "active"`. Do **not** mutate the target's `aliases[]` to remove the merged source name in the same write — split the un-merge across two AuditLog-emitting operations to preserve the trail.
4. Re-create the source's `TdsVendorLedger` rows by reading the per-source `entries[]` from `previousValue` and inserting them as a new ledger document per `{tenantId, sourceFingerprint, financialYear, section}`. Subtract the same `cumulativeBaseMinor` / `cumulativeTdsMinor` from the target row using `$inc` with negative deltas; do **not** drop the target row.
5. Emit a compensating audit event with `action: "vendor_merge_reverted"` referencing the original `vendor_merged` row's `_id` in `previousValue.revertedAuditLogId`.

**Expected outputs**: Source vendor re-activated with its original cumulatives restored; target vendor's cumulatives reduced by exactly the source's contribution; AuditLog contains both the original merge and the compensating revert.

**Rollback path**: None — the revert is itself a forward-only operation. If the revert produces wrong cumulatives, repeat steps 4–5 with corrected deltas and emit a second `vendor_merge_reverted` row referencing the first.

### 3.2 Section 197 cert expired in production

**Background**: `resolveEffectiveRate` at `backend/src/services/compliance/TdsCalculationService.ts:115` applies the cert rate only if all of the following hold (lines 126–131): `validFrom ≤ now`, `validTo ≥ now`, `financialYear === invoiceFy`, `!exhaustedAt`, and `cumulativeBaseMinor < maxAmountMinor`. Once `validTo` lapses, future invoices automatically fall back to the standard / tenant-override rate via lines 149–152. The `TDS_SECTION_197_APPLIED` risk signal at `backend/src/services/compliance/TdsCalculationService.ts:403` is emitted only when `certApplied: true`, so it stops emitting on the first post-expiry invoice without operator action.

What does require operator action: vendor-detail UIs surfacing the cert as "active" past expiry, and any pending invoices computed before midnight on `validTo` that should be re-enriched at the standard rate. **Cert field shape depends on #261 landing**; until then, `lowerDeductionCert` is sourced via the orchestrator's `vendorCert` parameter (`backend/src/services/compliance/tdsOrchestrator.ts:19`) which is wired up by the post-#261 caller.

**Inputs**: `tenantId`, `clientOrgId`, `vendorFingerprint`, the cert's `validTo`.

**Steps**:

1. Confirm the cert has actually lapsed against IST midnight, not server UTC. The check at `TdsCalculationService.ts:128` compares `validTo.getTime() ≥ now.getTime()`, so a cert with `validTo: 2026-03-31T23:59:59+05:30` becomes invalid at the same instant in either timezone — but operators should always quote IST when communicating with the customer.
2. Pull the vendor record:
   ```
   db.vendormasters.findOne({
     tenantId: "<tenantId>",
     clientOrgId: ObjectId("<clientOrgId>"),
     vendorFingerprint: "<vendorFingerprint>"
   })
   ```
   Inspect `lowerDeductionCert` (post-#261). If the cert document is still present and the customer wants it cleared from the UI, set it to `null` via `VendorService.updateVendor` (post-#262); never mutate the field in place from the shell without a paired `vendor_cert_expired` AuditLog write.
3. Identify pending invoices that were enriched while the cert was valid but have not yet been approved or exported:
   ```
   db.invoices.find({
     tenantId: "<tenantId>",
     clientOrgId: ObjectId("<clientOrgId>"),
     "metadata.vendorFingerprint": "<vendorFingerprint>",
     status: { $in: ["NEEDS_REVIEW", "AWAITING_APPROVAL", "PARSED"] },
     "compliance.tds.rateSource": "section197"
   }, { _id: 1, invoiceDate: 1, "compliance.tds.rateBps": 1 })
   ```
   The `INVOICE_STATUS` enum is at `backend/src/types/invoice.ts:4`; `TDS_RATE_SOURCE` at `backend/src/types/invoice.ts:132`. Re-trigger compliance enrichment for each affected invoice via the admin recompute endpoint — the recompute will pick up the now-falsy cert check and emit a fresh `compliance.tds` block at the standard rate, dropping `TDS_SECTION_197_APPLIED` from `riskSignals`.
4. The cumulative ledger row at `{tenantId, vendorFingerprint, FY, section}` is **not** retroactively corrected for invoices already recorded under the cert rate. If the customer needs Form 26Q reconciliation, follow `docs/runbooks/tds-and-audit.md` §3.4 and §5 to retire the cert-rate entries and re-record at the standard rate.

**Expected outputs**: `VendorMaster.lowerDeductionCert` cleared (or left expired-but-present per customer preference); pending invoices show the standard `rateSource` (typically `"rateTable"` or `"tenantOverride"`); no `TDS_SECTION_197_APPLIED` signal on newly enriched invoices.

**Rollback path**: Re-upload the cert via the post-#262 `POST /api/tenants/:tenantId/vendors/:fingerprint/cert` endpoint with corrected `validTo`; the next compliance run will re-apply it.

### 3.3 Section 197 cert maxAmount exhausted

**Background**: Same call-site as §3.2 (`TdsCalculationService.ts:131`); the cumulative-base check `cumulativeBaseMinor < vendorCert.maxAmountMinor` is what turns the cert off. Once a vendor's `TdsVendorLedger.cumulativeBaseMinor` for the cert's `{financialYear, section}` exceeds `maxAmountMinor`, the next invoice falls back to standard rate automatically — even if `validTo` is still in the future.

The cert is **not** auto-marked `exhaustedAt` by the rate resolver — that field is set by the upstream caller that loads the cert. Operators should set it explicitly so the vendor-detail UI doesn't display the cert as "active under cap" when it has in fact crossed the cap.

**Inputs**: `tenantId`, `clientOrgId`, `vendorFingerprint`, the cert's `financialYear` + `section`.

**Steps**:

1. Compute the cumulative base from the ledger (single-source-of-truth):
   ```
   db.tdsvendorledgers.findOne({
     tenantId: "<tenantId>",
     vendorFingerprint: "<vendorFingerprint>",
     financialYear: "<FY>",
     section: "<section>"
   }, { cumulativeBaseMinor: 1, cumulativeTdsMinor: 1 })
   ```
   Compare `cumulativeBaseMinor` against `lowerDeductionCert.maxAmountMinor` from the vendor row.
2. If exceeded, set `exhaustedAt` on the cert via the post-#262 update endpoint (or via a paired AuditLog-emitting shell write if pre-#262), so the vendor-detail UI reflects reality. The rate resolver (`TdsCalculationService.ts:130`) treats any non-null `exhaustedAt` as cert-off, so this is a defence-in-depth signal — the cumulative-base check already disables the cert.
3. Re-emit `TDS_SECTION_197_APPLIED` "off": this is **not** a fresh signal — it stops being emitted on the next enrichment per `TdsCalculationService.ts:403`. Trigger compliance re-enrichment on any pending invoices (same query shape as §3.2 step 3) so their `riskSignals[]` no longer contains the stale code.
4. If the customer requires audit evidence of the exhaustion event, emit an explicit `vendor_cert_exhausted` AuditLog row with `previousValue: { exhaustedAt: null }` and `newValue: { exhaustedAt: <timestamp>, exhaustedAtCumulativeBaseMinor: <value> }`.

**Expected outputs**: `lowerDeductionCert.exhaustedAt` populated; subsequent enrichments use the standard / tenant-override rate; `TDS_SECTION_197_APPLIED` signal absent from new compliance results.

**Rollback path**: If the cap was set incorrectly and the cert should still apply, raise `maxAmountMinor` on the cert (paired with an audit row), then null out `exhaustedAt`. Re-run enrichment.

### 3.4 GSTIN format changed

**Background**: `deriveVendorState(gstin, addressState)` at `backend/src/constants/gstinStateCodes.ts:50` derives the canonical state name from the first two digits of the GSTIN, falling back to the address state when the GSTIN is absent or malformed. Tally export reads this at `backend/src/services/export/tallyExporter.ts:337` to emit `<PLACEOFSUPPLY>` correctly. When a vendor's GSTIN changes (e.g. inter-state restructuring, correction of an OCR-misread digit), the stored `stateCode` / `stateName` on `VendorMaster` go stale and any pending invoice's `placeOfSupply` derivation is wrong.

**Depends on #261 landing** for the explicit `stateCode` / `stateName` fields on `VendorMaster`; until then, `deriveVendorState` is recomputed on every export call from the live invoice payload, so the corrective action is mostly forward-looking re-enrichment.

**Inputs**: `tenantId`, `clientOrgId`, `vendorFingerprint`, the new GSTIN.

**Steps**:

1. Verify the new GSTIN passes the format check. The regex is `GSTIN_FORMAT` at `backend/src/constants/indianCompliance.ts` (imported by `gstinStateCodes.ts:1`). A malformed GSTIN will silently return `null` from `stateFromGstin` (`backend/src/constants/gstinStateCodes.ts:63`) and fall back to the address-state lookup.
2. Compute the new state from the new GSTIN. Examples from the table at `backend/src/constants/gstinStateCodes.ts:3`–`:41`: prefix `27` → Maharashtra; `29` → Karnataka; `33` → Tamil Nadu. Confirm the new prefix matches the customer's stated business address.
3. Update the vendor record (post-#262 via `VendorService.updateVendor`; pre-#262 via paired shell write + `vendor_updated` AuditLog row):
   ```
   db.vendormasters.updateOne(
     { tenantId: "<tenantId>", clientOrgId: ObjectId("<clientOrgId>"), vendorFingerprint: "<vendorFingerprint>" },
     { $set: { gstin: "<NEW_GSTIN>", stateCode: "<NN>", stateName: "<canonical name from gstinStateCodes.ts>" } }
   )
   ```
   Note `stateCode` / `stateName` are introduced by #261; pre-#261 the operation reduces to setting `gstin` only.
4. Identify pending invoices that may have already been enriched with the old PLACEOFSUPPLY:
   ```
   db.invoices.find({
     tenantId: "<tenantId>",
     "metadata.vendorFingerprint": "<vendorFingerprint>",
     status: { $in: ["NEEDS_REVIEW", "AWAITING_APPROVAL", "PARSED", "APPROVED"] }
   }, { _id: 1, "compliance.placeOfSupply": 1 })
   ```
   For invoices not yet exported (status not `EXPORTED`), trigger compliance re-enrichment so the next Tally export emits the correct `<PLACEOFSUPPLY>`. For `EXPORTED` invoices, the export-reuse guard at `backend/src/services/export/tallyReExportGuard.ts` will block silent re-emission — see `docs/runbooks/tally-exporter.md` §4 for the re-export procedure.

**Expected outputs**: `VendorMaster.gstin` updated; `stateCode` / `stateName` consistent with the new GSTIN prefix; pending invoices' `compliance.placeOfSupply` rederived to the new state on next enrichment.

**Rollback path**: If the GSTIN change was applied in error, restore the previous GSTIN via the same update path, paired with a compensating audit row referencing the bad-update row's `_id`.

### 3.5 Tally ledger name changed

**Background**: `VendorMaster.tallyLedgerName` (post-#261) overrides the OCR-extracted `vendorName` at the Tally export call-site documented in `docs/accounting-payments/MASTER-SYNTHESIS.md` line 362. Renaming the ledger in Tally (e.g. customer reorganises Sundry Creditors into sub-groups) requires updating exactly this one field — `VendorMaster.name`, `aliases[]`, and `vendorFingerprint` are unaffected and **must not** be changed in the same operation, since the fingerprint is the cumulative-ledger key.

This is the lowest-risk procedure in this runbook: a single-field write with no AuditLog implication for the vendor's compliance state. The audit row exists for trail purposes only.

**Inputs**: `tenantId`, `clientOrgId`, `vendorFingerprint`, the new `tallyLedgerName`.

**Steps**:

1. Confirm the new ledger name exists in the customer's Tally book. Ledger pre-validation is the F12 gate (per Tally rule #4 in project memory `reference_tally_integration.md`); a non-existent ledger name will fail the next export with Tally error 7. If the customer is unsure, use the Tally ledger picker UI before writing here.
2. Update the vendor record (post-#262):
   ```
   db.vendormasters.updateOne(
     { tenantId: "<tenantId>", clientOrgId: ObjectId("<clientOrgId>"), vendorFingerprint: "<vendorFingerprint>" },
     { $set: { tallyLedgerName: "<NEW_LEDGER_NAME>" } }
   )
   ```
3. Flag any in-flight exports for re-resolution. Approved-but-not-yet-exported invoices will pick up the new ledger name on the next batch automatically (the exporter reads `tallyLedgerName` per export, not at approval time). Already-exported invoices retain the old ledger name on the Tally side; if the customer needs them re-emitted under the new name, follow the re-export procedure in `docs/runbooks/tally-exporter.md` §4 — note that the re-export guard at `backend/src/services/export/tallyReExportGuard.ts` will require an explicit operator override.
4. Emit an audit row: `action: "vendor_updated"`, `previousValue: { tallyLedgerName: "<OLD>" }`, `newValue: { tallyLedgerName: "<NEW>" }`.

**Expected outputs**: `VendorMaster.tallyLedgerName` reflects the new name; next export batch uses it; existing `tallyLedgerGuid` (if any) is preserved.

**Rollback path**: Restore the previous `tallyLedgerName` via the same update path. No ledger consolidation is required because nothing else changed.

### 3.6 Vendor blocked — verify routing

**Background**: A `vendorStatus: "blocked"` vendor (introduced by #261's enum: `"active" | "inactive" | "blocked"`) must route all subsequent invoices to `INVOICE_STATUS.NEEDS_REVIEW` per the vendor-status routing rule. The enum value `"NEEDS_REVIEW"` is at `backend/src/types/invoice.ts:7`. After blocking, operators should verify that the routing is actually taking effect — there have historically been gaps where in-flight invoices already past the routing decision continue to flow to `AWAITING_APPROVAL`.

**Depends on #261 landing** for the `vendorStatus` enum; pre-#261 there is no programmatic blocked state (a manual workaround is to mark the vendor `inactive`, which the routing logic does not currently honour).

**Inputs**: `tenantId`, `clientOrgId`, `vendorFingerprint`, the timestamp at which the vendor was blocked.

**Steps**:

1. Confirm the block actually persisted:
   ```
   db.vendormasters.findOne(
     { tenantId: "<tenantId>", clientOrgId: ObjectId("<clientOrgId>"), vendorFingerprint: "<vendorFingerprint>" },
     { vendorStatus: 1, updatedAt: 1 }
   )
   ```
2. Enumerate open invoices for the blocked vendor created or modified after the block timestamp:
   ```
   db.invoices.find({
     tenantId: "<tenantId>",
     clientOrgId: ObjectId("<clientOrgId>"),
     "metadata.vendorFingerprint": "<vendorFingerprint>",
     status: { $in: ["AWAITING_APPROVAL", "PARSED", "PENDING", "PENDING_TRIAGE"] },
     createdAt: { $gte: ISODate("<blockTimestamp>") }
   }, { _id: 1, status: 1, createdAt: 1 })
   ```
3. Any rows returned at `status: "AWAITING_APPROVAL"` are evidence that the block did not propagate. Either (a) the routing logic ran before the block landed, or (b) the routing logic does not yet read `vendorStatus`. Both are escalations; do not silently flip the invoice status from the shell.
4. For invoices that should be re-routed, trigger compliance re-enrichment via the admin recompute endpoint. The enrichment pass should observe the now-blocked vendor and emit the `NEEDS_REVIEW` status on its next state-transition.
5. Emit an audit row when the block was originally written: `action: "vendor_status_changed"` per `docs/accounting-payments/RFC-BACKEND.md` line 1445, with `previousValue: { vendorStatus: "active" }`, `newValue: { vendorStatus: "blocked", reason: "<customer-stated reason>" }`.

**Expected outputs**: All matching invoices transition to `NEEDS_REVIEW`; new ingestions land at `NEEDS_REVIEW` directly.

**Rollback path**: Set `vendorStatus` back to `"active"` and emit a paired audit row. Existing `NEEDS_REVIEW` invoices do not auto-promote — re-trigger enrichment per invoice or accept manual review.

### 3.7 Vendor fingerprint duplicate — manual merge

**Background**: OCR-driven name variants (e.g. `"ACME PVT LTD"` vs `"Acme Private Limited"` vs `"ACME P. LTD."`) where the GSTIN is missing on one or both invoices produce divergent `vendorFingerprint` values, which fragment cumulative TDS tracking across `TdsVendorLedger` rows. The merge endpoint introduced by #262 consolidates them per `docs/accounting-payments/RFC-BACKEND.md` §4.6.2.

The merge is **atomic** (Mongo transaction per FR-VENDOR-014a) and **destructive** (source ledger rows are deleted, not archived in place). Always preview before executing. **Depends on #262 landing.**

**Inputs**: `tenantId`, `clientOrgId`, `sourceFingerprint`, `targetFingerprint`.

**Steps**:

1. Confirm the merge direction. The target should be the canonical fingerprint — typically the one with the populated GSTIN, the higher `invoiceCount`, or the one already mapped to the correct `tallyLedgerName`. Inspect both:
   ```
   db.vendormasters.find({
     tenantId: "<tenantId>",
     clientOrgId: ObjectId("<clientOrgId>"),
     vendorFingerprint: { $in: ["<sourceFingerprint>", "<targetFingerprint>"] }
   }, { vendorFingerprint: 1, name: 1, gstin: 1, pan: 1, invoiceCount: 1, tallyLedgerName: 1, vendorStatus: 1 })
   ```
2. Preview the consolidated TdsVendorLedger by simulating the per-`{FY, section}` sum:
   ```
   db.tdsvendorledgers.aggregate([
     { $match: {
         tenantId: "<tenantId>",
         vendorFingerprint: { $in: ["<sourceFingerprint>", "<targetFingerprint>"] }
     } },
     { $group: {
         _id: { fy: "$financialYear", section: "$section" },
         baseSum: { $sum: "$cumulativeBaseMinor" },
         tdsSum: { $sum: "$cumulativeTdsMinor" },
         entriesSum: { $sum: { $size: "$entries" } },
         invoiceCountSum: { $sum: "$invoiceCount" }
     } }
   ])
   ```
   Cross-check `entriesSum` and `invoiceCountSum` for each `(fy, section)` against the customer's expectation. Any duplicate `invoiceId` between source and target `entries[]` is a red flag — the merge will produce an inflated cumulative because the service does not deduplicate (`backend/src/services/tds/TdsVendorLedgerService.ts:87`).
3. Dry-run the merge (post-#262 will expose a `dryRun: true` mode on `POST /api/tenants/:tenantId/vendors/:fingerprint/merge`); inspect the returned `MergeResult` for the consolidated VendorMaster, the consolidated `TdsVendorLedger` rows, and the count of `VendorGlMapping` / `VendorCostCenterMapping` upserts.
4. Confirm with the customer in writing (email or chat — preserved as evidence). Merge is irreversible per §3.1.
5. Execute the live merge. The service wraps all eight steps (`docs/accounting-payments/RFC-BACKEND.md` lines 1500–1515) inside a Mongo transaction; partial failures roll back cleanly only on a replica-set deployment. On standalone Mongo (jumpbox dev), the `mergeStatus: "in_progress" | "completed" | "failed"` field on the source vendor (`docs/accounting-payments/RFC-BACKEND.md` line 1517) is the recovery signal; an `in_progress` row stuck for > 5 minutes needs admin attention.
6. Verify post-merge: source `vendorStatus: "inactive"`, source `mergeStatus: "completed"`, target cumulatives match the dry-run preview, AuditLog contains a `vendor_merged` row with the full pre/post snapshot.

**Expected outputs**: One canonical `VendorMaster`; one `TdsVendorLedger` row per `{fy, section}` with summed cumulatives; one AuditLog `vendor_merged` row.

**Rollback path**: §3.1 (audit replay). The data-layer merge cannot be undone via Mongo operations alone.

### 3.8 AuditLog vendor query patterns

`auditlogs` is immutable per C-006 / C-019 (`docs/runbooks/tds-and-audit.md` §4.2 — never delete, never update). The schema indexes at `backend/src/models/core/AuditLog.ts:38`–`:41` are designed for the query shapes below; ad-hoc queries that omit `tenantId` are forbidden.

By vendor (most common — "what changed on this vendor and when?"):
```
db.auditlogs.find({
  tenantId: "<tenantId>",
  entityType: "vendor",
  entityId: "<vendorFingerprint>"
}).sort({ timestamp: -1 })
```
The `entityType` enum value is `"vendor"` per `backend/src/models/core/AuditLog.ts:6`; `entityId` is the `vendorFingerprint` (not the Mongo `_id`).

By action across all vendors in a tenant (compliance question — "every Section 197 cert upload this FY"):
```
db.auditlogs.find({
  tenantId: "<tenantId>",
  entityType: "vendor",
  action: "vendor_cert_uploaded",
  timestamp: { $gte: ISODate("2026-04-01T00:00:00Z") }
}).sort({ timestamp: -1 })
```
The vendor-mutation action dictionary (`vendor_updated`, `vendor_merged`, `vendor_status_changed`, `vendor_cert_uploaded`) is at `docs/accounting-payments/RFC-BACKEND.md` lines 1444–1445; #262 finalises the set.

By user (forensic question — "what did this user touch on vendors today?"):
```
db.auditlogs.find({
  tenantId: "<tenantId>",
  entityType: "vendor",
  userId: "<userId>",
  timestamp: { $gte: ISODate("2026-04-28T00:00:00Z") }
}).sort({ timestamp: -1 })
```

By time range, all vendor mutations in the tenant (rollout-verification question):
```
db.auditlogs.find({
  tenantId: "<tenantId>",
  entityType: "vendor",
  timestamp: { $gte: ISODate("<from>"), $lte: ISODate("<to>") }
}).sort({ timestamp: 1 })
```

`previousValue` and `newValue` are `Mixed` per `backend/src/models/core/AuditLog.ts:26`; treat them as opaque JSON. For merge events specifically, both fields carry full vendor snapshots plus the per-source consolidated ledger / mapping deltas — see §3.1 step 1.

If a vendor mutation appears to have no audit row, check `auditlogdeadletters` per `docs/runbooks/tds-and-audit.md` §4.3 before concluding the mutation bypassed the service. The retry tick is driven by `backend/src/services/core/AuditLogService.ts:56` (`retryDeadLetters`).

## 4. Cross-references

- `docs/runbooks/tds-and-audit.md` — TDS cumulative ledger interactions during merge (consolidation arithmetic), AuditLog write-failure / dead-letter operations (§4.3), and the rollback procedure (§5) for retiring bad ledger entries after a vendor correction.
- `docs/runbooks/tally-exporter.md` — `tallyLedgerName` propagation to exports (§3.5 above), PLACEOFSUPPLY emission after a GSTIN change (§3.4 above), and the re-export guard behaviour for already-exported invoices.

## 5. Change log

- 2026-04-28 — Initial version. Closes #280. Vendor-merge sections (§3.1, §3.7) and several VendorMaster fields depend on #261 + #262 landing.
