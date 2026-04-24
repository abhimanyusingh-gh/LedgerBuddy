# Tally exporter runbook

Audience: LedgerBuddy ops on-call and design-partner IT contacts.

This runbook covers what operators need to keep the Tally purchase-voucher exporter healthy: onboarding preconditions, first-export and re-export behaviour, how to read Tally's error shapes, and recovery steps for the common failure modes. It assumes familiarity with Tally Prime / ERP 9 and basic server concepts; it does not assume familiarity with LedgerBuddy's internals.

Source code paths below are given as `file:line` so operators can jump to the exact location when collaborating with engineering. Code is the source of truth; if a citation drifts, raise it.

Related references:
- `docs/accounting-payments/input/TALLY-INTEGRATION-DEEP-DIVE.md` — full XML request/response catalogue this runbook draws from.
- `docs/accounting-payments/MASTER-SYNTHESIS.md` §3 — decisions and constraints underlying the integration.

## 1. Pre-requisites

Before a tenant can push a single voucher, the following must be true.

### 1.1 Tally installed and HTTP-XML listener reachable

- Tally Prime (any build) or Tally ERP 9 running on the customer host with the company loaded.
- Tally's **HTTP-XML port (default TCP 9000)** configured and bound. In Tally, `Gateway of Tally → F1 Help → Configure` (Prime) / `F12 Configure → Advanced Configuration` (ERP 9), set `Tally.ERP 9 is acting as: Both` (Prime: Server mode enabled) and note the port.
- From the jumpbox, a `curl -X POST http://<customer-host>:9000` must return Tally's boilerplate `<RESPONSE>…</RESPONSE>` envelope. If it doesn't: firewall, NAT, or Tally not listening — stop here.

### 1.2 Jumpbox reachability and EIP allowlisting

Connectivity topology (MVP, no desktop agent):

```
Backend (ECS) ──TLS──▶ Jumpbox (VPC, static EIP, IAM-gated inbound, outbound-only)
                         │
                         └──TCP:9000 XML──▶ Customer Tally (cloud-hosted or public-IP on-prem)
```

- The customer network team must allowlist **our jumpbox's static EIP** on their firewall for inbound TCP:9000 to the Tally host. This is a one-time action per tenant.
- Confirm reachability by running `nc -zv <customer-host> 9000` from the jumpbox.
- No desktop agent is installed on the customer side in MVP. A Windows/Go desktop agent is explicitly post-MVP backlog.

### 1.3 F12 "Overwrite voucher by GUID" enabled

Every re-export relies on Tally accepting `ACTION="Alter"` against the GUID we issued on the first export. If the F12 toggle is off, re-exports fail with `LINEERROR: Voucher with same GUID already exists.`

Operator steps to verify in Tally:

1. Open any company. In Tally Prime: `F12 → Voucher Entry → Allow overwriting of existing vouchers when voucher with same GUID is imported → Yes`.
2. In Tally ERP 9: the label differs slightly (`Overwrite voucher when voucher with same GUID exists`) but the semantics are identical.
3. In onboarding, operator then clicks "Verify F12 overwrite" in the admin UI — this flips `ClientOrganization.f12OverwriteByGuidVerified` to `true`. Until then, any attempt to re-export raises `F12OverwriteNotVerifiedError` and is surfaced to the operator.

Persistence is on `backend/src/models/integration/ClientOrganization.ts` (`f12OverwriteByGuidVerified`). The gate is enforced at `backend/src/services/export/tallyReExportGuard.ts:79`. First-time export (`ACTION="Create"`) does not require the toggle.

## 2. First-export flow

First export of an invoice means `exportVersion = 0` in our database and `ACTION="Create"` on the wire. No F12 gate.

### 2.1 What a successful Create looks like

Envelope the exporter emits (elided for brevity; pulled from `backend/src/services/export/tallyExporter/xml.ts:266`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>ACME Pvt Ltd</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Accounting Voucher View">
          <DATE>20260415</DATE>
          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
          <VOUCHERNUMBER>INV-007</VOUCHERNUMBER>
          <GUID>a8c1…hex…deadbeef</GUID>
          <PARTYGSTIN>29AABCA1234C1Z5</PARTYGSTIN>
          <GSTIN>29AABCA1234C1Z5</GSTIN>
          <!-- LEDGERENTRIES.LIST children … -->
        </VOUCHER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>
```

Expected response (success path):

```xml
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>
  <BODY>
    <DATA>
      <IMPORTRESULT>
        <CREATED>1</CREATED>
        <ALTERED>0</ALTERED>
        <ERRORS>0</ERRORS>
        <LASTVCHID>…tally-voucher-id…</LASTVCHID>
      </IMPORTRESULT>
    </DATA>
  </BODY>
</ENVELOPE>
```

`STATUS=1` means the envelope parsed; it does **not** mean every row succeeded. The exporter inspects `<ERRORS>` and `<LINEERROR>` in `parseTallyImportResponse` (`backend/src/services/export/tallyExporter/xml.ts:99`) and treats success as `ERRORS=0 AND (CREATED>0 OR ALTERED>0 OR STATUS=1)` (`backend/src/services/export/tallyExporter/xml.ts:383`).

### 2.2 Common first-export failures

| Symptom (LINEERROR text) | Root cause | Fix |
|---|---|---|
| `Ledger 'X' does not exist.` | Vendor ledger absent from Tally; exporter never runs `ALLOWCREATION=Yes` (rule #10, §13). | Create the vendor ledger via vendor-sync (§5) or in Tally directly, retry. |
| `Could not set value for GSTIN` | Invalid 15-char GSTIN on the invoice. | Correct the invoice record, re-queue. |
| `Company is not loaded.` | `SVCURRENTCOMPANY` in the envelope doesn't match any open company. | Onboarding operator must re-verify company name / GUID on `ClientOrganization`; confirm company is open in Tally. |
| `Voucher Totals do not match.` | Debit/credit sum ≠ 0 in `LEDGERENTRIES.LIST`. | Engineering: inspect the `<LEDGERENTRIES.LIST>` blocks in the logged envelope. Usually a GST subtotal rounding regression. |
| `Date is not within the financial period.` | Invoice date outside the FY open in Tally. | User must open the financial period in Tally or reject the invoice. |

Code paths: envelope construction at `backend/src/services/export/tallyExporter/xml.ts:126`, response parsing at `backend/src/services/export/tallyExporter/xml.ts:99`, tenant-scoped export loop at `backend/src/services/export/tallyExporter.ts:70`.

## 2.5 Vendor matching priority ladder

(Rule #1: GSTIN-first vendor matching.)

When the exporter needs to resolve an invoice's vendor to a Tally ledger, it walks a 5-step priority ladder — stop at the first match, never skip ahead:

1. **GSTIN equality** — exact match on the 15-character vendor GSTIN. Highest-confidence signal; short-circuits everything below.
2. **Stored Tally ledger GUID** — `VendorMaster.tallyLedgerGuid` persisted on first sighting from a prior Tally pull.
3. **Normalised name** — case-folded, whitespace-collapsed exact name match.
4. **Canonicalised abbreviations** — e.g. `Pvt Ltd` = `Private Limited`, `&` = `and`, with the same normalisation as step 3 applied after canonicalisation.
5. **Token Jaccard similarity** — last-resort fuzzy match. **Never auto-merge on Jaccard alone** — surface the candidate to the operator for confirmation.

Operators debugging "vendor not found" or suspicious auto-matches should start by checking which rung of the ladder fired (logged on the match event). If step 5 fires and auto-merges silently, that's a bug — file it.

## 3. Re-export / Alter flow (2-phase staging)

Re-export is triggered when an invoice is corrected after its first successful export, or when an earlier attempt crashed mid-POST. The invariant: **Tally and our DB end with the same `exportVersion`, or the DB stays behind and the operator retries.**

### 3.1 Two-phase staging semantics

The user-visible atomicity model is **two DB phases** — `stage` and `promote-or-clear` — with the Tally `POST` sandwiched between them as an out-of-phase network side-effect. The DB never holds an in-between state visible to other writers: either `exportVersion` has moved forward, or it hasn't.

Implementation: `backend/src/services/export/tallyReExportGuard.ts` + call sites in `backend/src/services/export/tallyExporter.ts:102` onward.

```
Phase 1 — stage                       tallyReExportGuard.ts:92
  CAS-set Invoice.inFlightExportVersion = v+1
  WHERE exportVersion = v AND (inFlight IS NULL OR inFlight = v+1)
  If another exporter advanced v concurrently → ExportVersionConflictError.

(out-of-phase) POST to Tally          tallyExporter.ts:121
  Build envelope with GUID(v+1) and ACTION = "Alter" (if v > 0) or "Create" (if v = 0).
  Alter path is gated on f12OverwriteByGuidVerified (tallyReExportGuard.ts:79).
  Network side-effect; no DB mutation here.

Phase 2a — promote                    tallyReExportGuard.ts:129
  On Tally success:  atomically set exportVersion = v+1 AND clear inFlight.

Phase 2b — clear                      tallyReExportGuard.ts:146
  On POST failure or ERRORS>0: clear inFlight only.
  exportVersion never moved, so there is nothing to roll back.
```

### 3.2 Crash recovery (why you will sometimes see `inFlightExportVersion` stuck)

If an invoice has `inFlightExportVersion = v+1` set but `exportVersion = v` unchanged, a prior export crashed between Phase 1 (stage) and Phase 2 (promote/clear) — typically because the backend process died mid-POST or the Tally connection timed out before the response came back.

The next exporter run auto-recovers: Phase 1's CAS also accepts the already-staged case (see the `{ inFlightExportVersion: stagedVersion }` branch at `backend/src/services/export/tallyReExportGuard.ts:104`), the POST re-issues the **same GUID** with `ACTION="Alter"` — Tally treats this as idempotent because of the F12 toggle — and Phase 2a promotes. No manual operator action is required unless the crash indicates a systemic failure (e.g. repeated Tally timeouts).

If you genuinely need to unstick an invoice by hand — e.g. the F12 toggle was never enabled and the tenant is blocked — manually null out `Invoice.inFlightExportVersion` in the DB and re-run the exporter. Only do this after you have confirmed the Tally side has no voucher at GUID(v+1).

### 3.3 GUID derivation

`computeVoucherGuid` at `backend/src/services/export/tallyReExportGuard.ts:59` produces `SHA-256(lengthPrefix(tenantId) | lengthPrefix(invoiceId) | exportVersion)`. Length-prefixing prevents collisions between `("abc", "def", 1)` and `("abc:def", "", 1)`. This is the identity Tally uses for the voucher; never reuse a GUID across `exportVersion` values.

## 4. LINEERROR ordinal correlation

(Rule #7: deterministic ordinal order, fallback-per-ordinal on partial failure.)

### 4.0 Batch size invariant

The exporter emits at most 25 vouchers per XML batch (`TALLY_BATCH_SIZE` at `backend/src/services/export/tallyExporter/xml.ts:19`). Tight batches limit blast radius on partial failure and simplify LINEERROR ordinal correlation (§4). This is rule #6 — do not raise it without an OAR.

Tally returns batch failures as a count plus `<LINEERROR>` blocks — it does **not** return a voucher-number-to-error map. To correlate a `LINEERROR` back to an invoice:

1. The exporter emits vouchers in the order `invoices` is iterated at `backend/src/services/export/tallyExporter.ts:86`. The batch XML envelope preserves that order (see `buildTallyBatchImportXml` → `chunkVoucherInputs` at `backend/src/services/export/tallyExporter/xml.ts:292`). Batch size is fixed at 25 (`TALLY_BATCH_SIZE` at `backend/src/services/export/tallyExporter/xml.ts:19`).
2. In the response, `<LINEERROR>` entries appear in the same positional order as the failed vouchers in the batch. If the exporter emitted `[INV-A, INV-B, INV-C, INV-D]` and the response has `<ERRORS>2</ERRORS>` with two `<LINEERROR>` blocks, you must match them to the 1st and 2nd failures by counting.
3. For this reason each export loop iteration currently processes **one invoice at a time** (`backend/src/services/export/tallyExporter.ts:86` loops per-invoice, not per-batch). A future batched-push path must preserve ordinal-order or fall back to per-voucher retries of failed ordinals — that is the fallback described in rule #7.

Operational tip: when the log `tally.export.invoice.failed` (`backend/src/services/export/tallyExporter.ts:159`) fires, its `invoiceId` field is already the correlated invoice — no manual ordinal math needed in the per-invoice path. Ordinal correlation only matters once batch-push lands.

## 5. AlterID cursor behaviour

(Rule #8: incremental sync via `$AlterID > lastSeen`.)

Tally's `AlterID` is a monotonically-increasing per-master version counter (`<ALTERID>47</ALTERID>` on every ledger). Vendor-sync uses it as a cursor:

```
QUERY Collection "Ledger"
  WHERE Parent = "Sundry Creditors" AND $AlterID > lastLedgerAlterId
  NATIVEMETHOD Name, PartyGSTIN, LedStateName, AlterID, GUID, …
for each ledger in response:
  match by GUID in VendorMaster; diff and apply
  update lastLedgerAlterId = max(…, row.AlterID)
```

Full algorithm, including voucher-drift detection, is in `docs/accounting-payments/input/TALLY-INTEGRATION-DEEP-DIVE.md` §9.3.

**Rollback handling.** If between syncs the observed `max(AlterID)` **decreases** — typically because a Tally user deleted ledger entries, or the customer restored Tally from a backup — the vendor-sync must trigger a full re-sync (re-pull all Sundry Creditors, not just `$AlterID > cursor`). The exporter itself is unaffected because it works off our own `VendorMaster` cache; the ops signal is a spike in vendor-sync run duration plus a `vendor_sync.alterid_rollback` log event (future; not yet implemented — tracked with vendor-sync PRs).

In MVP the vendor-sync plumbing is not yet wired end-to-end; operator visibility for AlterID rollback will land with the VENDOR-SYNC-1 / VENDOR-SYNC-2 PRs.

## 6. Settlement precheck

(Rule #9: verify `Bills Outstanding REFERENCE` before payment voucher push.)

The silent-orphan hazard: if a Payment Voucher uses `BILLTYPE="Agst Ref"` with a `<NAME>` that doesn't match any outstanding bill on the vendor, Tally imports the voucher **without a LINEERROR** — the allocation is silently recorded as an on-account credit, and the original bill stays outstanding.

Mitigation is the settlement precheck: before emitting a Payment Voucher envelope, query the vendor's `Bills Outstanding` collection (envelope at `docs/accounting-payments/input/TALLY-INTEGRATION-DEEP-DIVE.md` §6.2 lines 530-562) and verify the `<REFERENCE>` NAME exists with unallocated amount ≥ the proposed allocation.

Failure UX:

- Operator sees: `Bills Outstanding REFERENCE 'INV-0042' not found for vendor 'Acme Foo Pvt Ltd'` in the export history detail, with a "Refresh vendor bills from Tally" action.
- Recovery: (a) confirm the bill reference string matches what Tally stored on the purchase voucher, character-for-character (whitespace / casing); (b) if it does, the bill may already be fully settled — mark the invoice as `paid` in LedgerBuddy and skip the payment voucher; (c) if Tally is stale — e.g. a prior payment wasn't recorded — run vendor-sync and retry.

Payment-voucher push is not yet implemented in the exporter (it is a Phase 2 feature, BE-12). This section documents the intended operator contract for when BE-12 lands.

## 7. PLACEOFSUPPLY emission

(GST state-of-supply determination for inter-state purchases.)

The exporter emits `<PLACEOFSUPPLY>` inside the `VOUCHER` element at `backend/src/services/export/tallyExporter/xml.ts:152` (gated by the guard at `backend/src/services/export/tallyExporter/xml.ts:151`). The gating condition is computed in `applyReExportDecision` at `backend/src/services/export/tallyExporter.ts:453`:

```ts
const placeOfSupplyStateName = (
  decision.buyerStateName &&
  input.partyStateName &&
  decision.buyerStateName.trim().toLowerCase() !== input.partyStateName.trim().toLowerCase()
) ? decision.buyerStateName : undefined;
```

Plain-English rule: emit `<PLACEOFSUPPLY>` when the **buyer state** (our tenant's company state, from `ClientOrganization.stateName`) differs from the **vendor / party state**. Same-state purchases do not emit it (Tally infers intra-state from the ledger's `LEDSTATENAME`).

**Known gap.** The vendor's `partyStateName` is not yet derived from the invoice's vendor GSTIN prefix or address — this is tracked in **Issue #130** ("Wire vendor-state derivation for PLACEOFSUPPLY — BE-2 follow-up"). Until #130 lands, the emission path in production is effectively dormant (always `undefined`). Operators seeing missing `PLACEOFSUPPLY` on inter-state invoices should flag on #130; this is not a Tally-side bug.

## 8. Atlas `documentValidationFailure` log monitoring

(RUNBOOK-BE-0 follow-up from PR #118.)

BE-0 (`backend/src/db/applyJsonSchemaValidators.ts`) installs MongoDB `$jsonSchema` validators on every collection that holds `*Minor` (integer-encoded money) fields. The first deploy runs `validationAction: "warn"` (`backend/src/db/applyJsonSchemaValidators.ts:39`) so non-compliant writes surface in Mongo logs without being rejected.

### 8.1 What ops watches for

Atlas emits `documentValidationFailure` events to the project log stream whenever a write would have failed the schema. For every event, inspect:

- `ns` (namespace) — which collection.
- `errInfo.details.schemaRulesNotSatisfied` — which field failed, and expected type vs observed.
- The operating service ID — usually `backend` or a scripted repair job.

A persistent stream of `documentValidationFailure` on an `*Minor` field is our signal that a code path is still writing non-integer values (e.g. `Number` with a decimal component) into a money field.

### 8.2 Atlas alert setup

- In Atlas Project Alerts: add alert `Alert: Database "documentValidationFailure" count > 0 in 15m` on the production cluster.
- Route to PagerDuty low-urgency (not paging on-call immediately — warnings, not errors) and to the `#ops-alerts` Slack channel.
- When the alert fires: pull the last hour's failures from the Atlas `applicationLogs` stream, group by namespace + failed-field, open an engineering ticket for the offending writer.

The plan (documented on BE-0 PR #118) is to flip `validationAction` to `"error"` once the warning stream is clean for 7 consecutive days. That flip is a separate PR.

## 9. Dual-tag emission

(Rule #2: emit both ERP9 and Prime aliases on writes; accept either on reads.)

Because ERP 9 and Prime use different canonical tag names, writes emit both aliases and reads accept either. The alias tables are at `backend/src/services/export/tallyExporter/xml.ts:3` (`TALLY_WRITE_ALIASES`) and `backend/src/services/export/tallyExporter/xml.ts:9` (`TALLY_READ_ALIASES`):

```ts
const TALLY_WRITE_ALIASES = {
  GSTIN:      ["PARTYGSTIN", "GSTIN"],
  PAN:        ["PANIT", "INCOMETAXNUMBER"],
  STATE_NAME: ["STATENAME", "LEDSTATENAME"]
};
const TALLY_READ_ALIASES = {
  LAST_ENTITY_ID: ["LASTVCHID", "LASTMID"]
};
```

Emission points: GSTIN at `backend/src/services/export/tallyExporter/xml.ts:156`, PAN at `backend/src/services/export/tallyExporter/xml.ts:160`, state at `backend/src/services/export/tallyExporter/xml.ts:164`.

Operators normally don't need to touch this. The one place it surfaces: if the Tally-side audit log shows **both** `<PARTYGSTIN>` and `<GSTIN>` on a party ledger, that is the exporter behaving correctly — not a duplication bug. Same for `PANIT`/`INCOMETAXNUMBER` and `STATENAME`/`LEDSTATENAME`.

## 10. Version-compatibility caching

(Rule #11: detect ERP 9 vs Prime vs Prime Server once, cache per tenant.)

`ClientOrganization.detectedVersion` at `backend/src/models/integration/ClientOrganization.ts` caches which Tally flavour the tenant runs. The enum values are in the same file:

```ts
export const TALLY_VERSION = {
  ERP9: "erp9",
  Prime: "prime",
  PrimeServer: "primeServer"
};
```

The exporter reads and logs this on every tenant-scoped export at `backend/src/services/export/tallyExporter.ts:79` (log event `tally.export.detected_version`). The detection probe itself is not yet implemented — it will land with the Tally onboarding health panel (TALLY-ONBOARD / TALLY-HEALTH).

Operator use: if response shapes suddenly start looking unfamiliar (e.g. `<LASTMID>` where a tenant previously returned `<LASTVCHID>`, or missing `BANKDETAILS.LIST` structures), check the logged `detectedVersion` against the tenant's actual Tally build. A mismatch means the cached detection is stale — clear the field on `ClientOrganization` and re-run onboarding.

Prime Server is rare (<5% of installs) and supports concurrent request handling — do not assume single-in-flight semantics for tenants detected as `primeServer`.

## 11. Troubleshooting matrix

| Symptom | Diagnosis | Fix |
|---|---|---|
| `connect ECONNREFUSED` / Tally offline | Tally process not running, or HTTP-XML port not bound. | Ask customer to open Tally + load the company. Verify port 9000 on the Tally host. If reachable from jumpbox but not from backend, check jumpbox health. |
| `connect ETIMEDOUT` | Jumpbox EIP not allowlisted on the customer firewall, or customer routing dropped. | Verify allowlist entry. Test with `nc -zv <host> 9000` from jumpbox. |
| `LINEERROR: Voucher with same GUID already exists.` | Re-export attempted without F12 "Overwrite by GUID" enabled, **or** F12 toggle was enabled but `f12OverwriteByGuidVerified` is still `false`. | Enable F12 in Tally (§1.3), click "Verify F12 overwrite" in onboarding admin, retry. |
| `F12OverwriteNotVerifiedError` raised by exporter | Our own gate blocking the re-export before POST. | Same fix as above — the gate is there to prevent the Tally-side failure. |
| Invalid XML / `STATUS=0` with no `LINEERROR` | Envelope-level parse failure (malformed XML from our side, or truncated stream). | Do **not** auto-retry (rule). Log the full request/response, open engineering ticket, surface to user. |
| `Bills Outstanding REFERENCE not found` (settlement precheck) | Payment allocation targets a bill that is already fully settled, has a typo, or doesn't exist on the Tally side. | See §6. Refresh vendor bills, verify the reference string, retry or mark paid locally. |
| `Company is not loaded.` | `SVCURRENTCOMPANY` in our envelope doesn't match an open company. | Re-verify `ClientOrganization.companyName` vs the name in Tally — customers sometimes rename. |
| `Could not set value for GSTIN` | 15-char GSTIN invalid on the invoice. | Fix on the invoice detail page; re-queue. |
| `Ledger 'X' does not exist.` | Vendor ledger not yet created in Tally. | Run vendor-sync (once TALLY-VENDOR-PRECHECK lands) or have the customer create it in Tally. Do **not** enable `ALLOWCREATION=Yes` (rule #10) — it auto-creates under `Primary` with no GSTIN/state. |
| `Invoice stuck with inFlightExportVersion set` | Prior export crashed mid-POST (§3.2). | Re-run exporter — auto-recovery re-POSTs the same GUID under `ACTION="Alter"`. If the crash is repeating, escalate to engineering. |
| `ExportVersionConflictError: version-mismatch` | Two exporters raced; the other one advanced `exportVersion` first. | Retry with refreshed invoice state. If persistent, investigate duplicate export schedulers. |
| `ExportVersionConflictError: in-flight-mismatch` | Another exporter is currently staging a different version. | Back off, let the in-flight attempt resolve, retry. |
| Atlas `documentValidationFailure` events increasing | A code path writing non-integer into an `*Minor` field. | §8. Open engineering ticket with `ns` + `schemaRulesNotSatisfied` payload. |
| Tally responds with `LASTMID` instead of `LASTVCHID` | Version drift (ERP 9 older response shape). | Confirm `ClientOrganization.detectedVersion` matches the tenant's Tally build (§10). The exporter accepts both — this is a diagnostic signal only. |
| Cannot import vouchers - company is locked | Another Tally user holds the edit lock. | Retry with 30–120s backoff; escalate to customer if lock persists. |
| `Date is not within the financial period.` | Invoice date outside the FY open in Tally. | Customer must open the FY in Tally; do not retry until confirmed. |

## 12. Boundaries operators should not cross

- Do not enable `ALLOWCREATION=Yes` in any onboarding configuration (rule #10). It will auto-create vendor ledgers under `Primary` with no GSTIN / state and destroy downstream GST inference.
- Do not manually issue a client-supplied `<GUID>` for a ledger Create. Tally assigns ledger GUIDs; we only supply voucher GUIDs (rule #4).
- Do not auto-merge vendor ledgers on token Jaccard similarity alone (rule #1). Surface to the user.
- Do not bypass the F12 gate by flipping `f12OverwriteByGuidVerified = true` in the DB without verifying the toggle is actually on in Tally. The gate exists to prevent `LINEERROR: Voucher with same GUID already exists.` at export time.

## 13. Rule coverage

Every numbered rule in `reference_tally_integration.md` surfaces somewhere in this runbook. Cross-reference:

| Rule # | Rule summary | Runbook section |
|---|---|---|
| 1 | GSTIN-first vendor matching; never auto-merge on Jaccard alone | §2.5 Vendor matching priority ladder; §12 Boundaries |
| 2 | Dual-tag emission on writes (ERP9 + Prime aliases); tolerant reads | §9 Dual-tag emission |
| 3 | `SVCURRENTCOMPANY` on every request | §2.1 (envelope example) |
| 4 | No client-supplied ledger GUIDs — Tally issues them | §12 Boundaries; §3.3 (voucher GUIDs are client-supplied, ledger GUIDs are not) |
| 5 | F12 "Overwrite by GUID" gate for idempotent re-export; `ACTION="Alter"` on re-export | §1.3 F12 pre-req; §3 Re-export flow |
| 6 | Batch default: 25 vouchers per request | §4.0 Batch size invariant |
| 7 | LINEERROR ordinal correlation; deterministic emission order | §4 LINEERROR ordinal correlation |
| 8 | AlterID cursors for drift detection; full re-sync on rollback | §5 AlterID cursor behaviour |
| 9 | Settlement precheck — verify `Bills Outstanding REFERENCE` before payment voucher | §6 Settlement precheck |
| 10 | `ALLOWCREATION=Yes` is banned | §11 Troubleshooting matrix (Ledger 'X' does not exist); §12 Boundaries |
| 11 | Version-compat: emit both aliases, cache detected version per tenant | §9 Dual-tag emission; §10 Version-compatibility caching |

## 14. Change log

- 2026-04-23 — Initial version. Closes #138.
