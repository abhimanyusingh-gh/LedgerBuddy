# Tally HTTP-XML Integration — Deep Dive

**Author**: Integrations engineering
**Date**: 2026-04-22
**Scope**: Bi-directional sync layer between BillForge (cloud) and Tally Prime (desktop). Covers request framing, master fetch, vendor push, voucher imports, error handling, and recommended architecture.
**Builds on**: `docs/accounting-payments/input/TALLY-INTEGRATION-AUDIT.md`, `docs/accounting-payments/MASTER-SYNTHESIS.md` §3, `docs/accounting-payments/RFC-BACKEND.md` §4.3. This document does not re-derive the Phase-0 XML structural fixes (ALLLEDGERENTRIES / ISINVOICE / BILLALLOCATIONS / REFERENCE / EFFECTIVEDATE) — those are settled.

---

## 1. Executive summary

1. Tally Prime's HTTP-XML interface is HTTP POST to `http://<host>:9000/` with a body of a single `<ENVELOPE>` document. No path, no auth, no TLS. Content-Type `text/xml` or `application/xml`.
2. A single Tally instance is a single-threaded UI process: concurrent requests are **not safe**. One company open at a time per Tally process. Timeout budget should be ≥ 30 s for voucher batches, ≥ 60 s for large ledger pulls.
3. **There is no cloud API**. Tally.NET "Remote Access" uses a proprietary encrypted protocol between two Tally clients — not an HTTPS API. Tally Prime Server is a multi-threaded LAN server; still private network only. Confirmed: cloud-to-customer-Tally requires an on-prem bridge or tunnel.
4. Tally Prime **does** honour `<GUID>` for idempotency on voucher imports and exposes a user-facing "Overwrite voucher when a voucher with same GUID exists" switch. GUID is the correct dedup key; `VOUCHERNUMBER` alone is insufficient.
5. Master fetch uses `TALLYREQUEST=Export` with `TYPE=Collection` and an **inline TDL** in `<DESC><TDL>…</TDL></DESC>`. Filter ledgers by parent group using `ChildOf="Sundry Creditors"` + `BelongsTo="Yes"` attributes on the Collection element.
6. Vendor (ledger) push uses `TALLYREQUEST=Import`, `TYPE=Data`, `ID=All Masters`, with a `<LEDGER NAME="…" ACTION="Create">` (or `"Alter"`) inside `<TALLYMESSAGE>`. GST fields: `GSTREGISTRATIONTYPE`, `PARTYGSTIN` or `GSTIN`, `LEDSTATENAME`, `PANIT`, `COUNTRYOFRESIDENCE`, `ISBILLWISEON`, `ADDRESS.LIST`.
7. Successful response has `<CREATED>`, `<ALTERED>`, `<IGNORED>`, `<ERRORS>`, `<LASTVCHID>`, `<LASTMID>`. Partial-batch failures surface as `<ERRORS>n</ERRORS>` plus per-row `<LINEERROR>…</LINEERROR>` blocks; there is no per-voucher success/fail array — you must regenerate and retry the failed subset.
8. `BILLALLOCATIONS` with `BILLTYPE="Agst Ref"` and a `NAME` that does not match any outstanding bill on the vendor is **silently treated as a new on-account reference** — it does not error. This is a correctness hazard for payment voucher export.
9. AlterID / LastAlterID are Tally's native incremental-sync primitives; any drift-detection design should filter collections by `$AlterID > <last seen>` rather than re-pulling full masters.
10. Recommended architecture: a lightweight **desktop bridge agent** (Windows service / Electron tray) running on the Tally machine, doing outbound HTTPS long-poll to the BillForge backend. The backend never connects inbound to the customer. This is the **only** viable cloud-to-Tally bridge.

---

## 2. Connectivity model

### 2.1 The localhost reality

Tally Prime's HTTP server binds to a local TCP port (default 9000) on the machine running Tally. It listens for `POST /` with an XML body. There is no built-in authentication, TLS, or rate limiting. Browsing `http://localhost:9000` returns the string `TallyPrime Server is Running` (or for ERP 9, `Tally.ERP 9 Server is running`) — a common liveness probe.

- **No cloud API exists.** Tally Solutions has never shipped a publicly-addressable cloud API for customer data. Any "Tally on Cloud" offering on the market is a third-party Windows VM (Citrix/RDP) with Tally.exe inside — not a cloud service.
- **Tally.NET "Remote Access"** is client-to-client remote UI: a remote Tally.exe authenticates via the Tally.NET Gateway and then tunnels encrypted XML to the host Tally.exe. The transport is proprietary Modified-DES; it is not documented, not publicly callable, and not XML-over-HTTPS. Useful only for human users, not server-to-server sync.
- **Tally Prime Server** (separate SKU) is multi-threaded and handles multi-user concurrency on a LAN, but still binds to a local/LAN address and uses the same XML protocol. It does not make Tally reachable from the public internet.

Conclusion: **no direct BillForge-cloud → customer-Tally connection is possible.** A bridge running inside the customer's network is mandatory for any non-file-based integration. This matches D-028 in MASTER-SYNTHESIS.

### 2.2 Bridge options, ranked

| Option | Feasibility | Notes |
|---|---|---|
| (A) Desktop bridge agent (system tray / Windows service) that dials out to BillForge over HTTPS | **Recommended** | Mirror of the AI Accountant, Zoho Books, ClearTax, Suvit, Biz Analyst approach. Works behind corporate firewall/NAT. Outbound HTTPS only. |
| (B) File-based (user downloads XML, imports via Tally F1 → Import Data) | **MVP today** | Zero infra but high friction; breaks master-data precheck and drift detection. Acceptable for Phase 0–5 as MASTER-SYNTHESIS already decided. |
| (C) Reverse SSH / ngrok-style tunnel to expose port 9000 | Not recommended | Security nightmare (no auth on 9000), IT teams will reject. |
| (D) VPN from BillForge infra to customer LAN | Not scalable | Per-tenant VPN setup; not viable for SaaS. |
| (E) Tally Prime Server in customer DMZ | Impractical | Still private network; requires port-forward + auth proxy in front. |
| (F) ODBC via Tally ODBC driver (also port 9000) | Read-only, Windows-only | Alternative for pulls but identical network constraint; no write path. Skip. |

### 2.3 Security model for the bridge (option A)

- No inbound ports opened on the customer side.
- Agent uses a tenant-scoped JWT/mTLS credential minted at onboarding; credential stored in Windows Credential Manager / DPAPI.
- Agent polls or holds a WebSocket / HTTP long-poll to the BillForge backend for pending commands (push a batch of vouchers, pull a ledger snapshot, ping).
- Agent replies with Tally's response body; backend parses and updates ExportBatch / drift tables.
- Because Tally itself has no auth, the bridge agent becomes the trust boundary. The agent must refuse commands that don't bear a valid backend signature.
- TLS terminates at BillForge; Tally-agent loopback traffic stays in-process on the customer machine.

---

## 3. Request/response envelope reference

### 3.1 Transport

| Aspect | Value | Source |
|---|---|---|
| Method | `POST` | TallyHelp "XML Integration" (implied; all examples and third-party clients use POST) |
| URL | `http://<tally-host>:9000/` | TallyHelp "XML Integration" |
| Content-Type | `text/xml; charset=utf-8` (or `application/xml`) | TallyHelp: responses return UTF-8 when request is `text/xml` / `UTF-8` |
| Body | One `<ENVELOPE>…</ENVELOPE>` XML document | All sources |
| XML prolog | `<?xml version="1.0" encoding="UTF-8"?>` recommended | MASTER-SYNTHESIS C-016 |

### 3.2 Canonical request envelope (Export — report)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Trial Balance</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>ACME Pvt Ltd</SVCURRENTCOMPANY>
        <SVFROMDATE>20250401</SVFROMDATE>
        <SVTODATE>20260331</SVTODATE>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>
```

### 3.3 Canonical request envelope (Export — Collection with inline TDL)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>BFVendorList</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>ACME Pvt Ltd</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="BFVendorList" ISINITIALIZE="Yes">
            <TYPE>Ledger</TYPE>
            <CHILDOF>$$GroupSundryCreditors</CHILDOF>
            <BELONGSTO>Yes</BELONGSTO>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <NATIVEMETHOD>GSTRegistrationType</NATIVEMETHOD>
            <NATIVEMETHOD>PartyGSTIN</NATIVEMETHOD>
            <NATIVEMETHOD>IncomeTaxNumber</NATIVEMETHOD>
            <NATIVEMETHOD>LedStateName</NATIVEMETHOD>
            <NATIVEMETHOD>MailingName</NATIVEMETHOD>
            <NATIVEMETHOD>Address</NATIVEMETHOD>
            <NATIVEMETHOD>PinCode</NATIVEMETHOD>
            <NATIVEMETHOD>Email</NATIVEMETHOD>
            <NATIVEMETHOD>LedgerMobile</NATIVEMETHOD>
            <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
            <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
            <NATIVEMETHOD>AlterID</NATIVEMETHOD>
            <NATIVEMETHOD>GUID</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
```

Notes:
- Collection `NAME` in `<TDLMESSAGE>` **must equal** the `<ID>` in the header.
- `CHILDOF` can be either a TDL expression (`$$GroupSundryCreditors` — a built-in group reference) or a literal string (`"Sundry Creditors"`). Literal string is portable across localisation; `$$Group…` is safer against rename/translation.
- `BELONGSTO=Yes` walks sub-groups (e.g. `Sundry Creditors > Suppliers > Overseas`). Leave off / `No` for direct children only.
- `NATIVEMETHOD` lists the object methods/fields to serialize. Without them Tally returns an inflated default projection including `LANGUAGENAME.LIST` etc.

### 3.4 Canonical request envelope (Import — masters)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>All Masters</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>ACME Pvt Ltd</SVCURRENTCOMPANY>
        <IMPORTDUPS>@@DUPCOMBINE</IMPORTDUPS>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <!-- one or more LEDGER / GROUP / STOCKITEM elements -->
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>
```

`IMPORTDUPS` values (affect masters, not vouchers):
- `@@DUPCOMBINE` — merge (combine opening balances, keep existing non-empty fields).
- `@@DUPIGNORE` — skip duplicates.
- `@@DUPASK` — Tally pops a UI dialog (unusable for server integration).

### 3.5 Success response (envelope)

```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <STATUS>1</STATUS>
  </HEADER>
  <BODY>
    <DATA>
      <IMPORTRESULT>
        <CREATED>2</CREATED>
        <ALTERED>0</ALTERED>
        <DELETED>0</DELETED>
        <LASTVCHID>119</LASTVCHID>
        <LASTMID>0</LASTMID>
        <COMBINED>0</COMBINED>
        <IGNORED>0</IGNORED>
        <ERRORS>0</ERRORS>
      </IMPORTRESULT>
    </DATA>
  </BODY>
</ENVELOPE>
```

`STATUS=1` means the envelope was parseable by Tally; **it does not mean all rows succeeded**. Always inspect `<ERRORS>` and (for export) `<LINEERROR>`.

### 3.6 Failure response (envelope)

```xml
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <STATUS>0</STATUS>
  </HEADER>
  <BODY>
    <DATA>
      <LINEERROR>Ledger 'Acme Foo Pvt Ltd' does not exist.</LINEERROR>
    </DATA>
  </BODY>
</ENVELOPE>
```

For envelope-level parse failures:

```xml
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><STATUS>0</STATUS></HEADER>
  <BODY>
    <DATA>
      <STATUS.LIST>
        <STATUS>
          <CODE>123</CODE>
          <DESC>Invalid Request</DESC>
        </STATUS>
      </STATUS.LIST>
    </DATA>
  </BODY>
</ENVELOPE>
```

---

## 4. Master data sync

### 4.1 Fetch all vendor ledgers (Sundry Creditors + subgroups)

**Request** — use §3.3 envelope. Response shape:

```xml
<ENVELOPE>
  <HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>
  <BODY>
    <DATA>
      <COLLECTION>
        <LEDGER NAME="Acme Foo Pvt Ltd" RESERVEDNAME="">
          <PARENT>Sundry Creditors</PARENT>
          <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
          <PARTYGSTIN>29AABCA1234C1Z5</PARTYGSTIN>
          <INCOMETAXNUMBER>AABCA1234C</INCOMETAXNUMBER>
          <LEDSTATENAME>Karnataka</LEDSTATENAME>
          <MAILINGNAME>Acme Foo Pvt Ltd</MAILINGNAME>
          <EMAIL>ap@acme.example</EMAIL>
          <OPENINGBALANCE>0.00</OPENINGBALANCE>
          <CLOSINGBALANCE>-145000.00</CLOSINGBALANCE>
          <ALTERID>47</ALTERID>
          <GUID>a1b2c3d4-e5f6-7890-abcd-ef0123456789-0000009b</GUID>
        </LEDGER>
        <LEDGER NAME="Beta Traders" RESERVEDNAME="">
          <!-- … -->
        </LEDGER>
      </COLLECTION>
    </DATA>
  </BODY>
</ENVELOPE>
```

Behaviour notes:
- The field named in `NATIVEMETHOD` appears in the response as the upper-cased tag. `Parent` → `<PARENT>`, `PartyGSTIN` → `<PARTYGSTIN>`, `IncomeTaxNumber` → `<INCOMETAXNUMBER>`. Minor differences exist across ERP 9 vs Prime — test both.
- `GUID` on a ledger is Tally's internal identifier (`<company-guid>-<master-id-hex>`). Use it for server-side dedup but **do not** rely on it for cross-company comparison.
- `ALTERID` is the master's version counter — increments on any edit. This is the incremental-sync cursor (§9.3).
- Ledgers created by "auto-create on import" (see §4.4 `ALLOWCREATION`) appear with `PARENT="Primary"` — filter them out or reclassify.

### 4.2 Pagination / limits

Tally has **no pagination** in the XML Collection API. The full filtered result set is streamed in one response. Practical limits:
- Responses > ~100 MB have been reported to stall the Tally UI (the process is single-threaded; exporting freezes the user). Keep fetched projections narrow.
- For large tenants with 10k+ vendors, incremental sync via `AlterID` (§9.3) is effectively mandatory.
- There is no `LIMIT` or `OFFSET` TDL attribute. You can approximate with `FILTER` using `$AlterID >= X AND $AlterID < Y`, but cursor-by-AlterID-range is the canonical pattern.

### 4.3 Fetch a single ledger by name (Object query)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Object</TYPE>
    <SUBTYPE>Ledger</SUBTYPE>
    <ID TYPE="Name">Acme Foo Pvt Ltd</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>ACME Pvt Ltd</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <FETCHLIST>
        <FETCH>Name</FETCH>
        <FETCH>Parent</FETCH>
        <FETCH>PartyGSTIN</FETCH>
        <FETCH>GSTRegistrationType</FETCH>
        <FETCH>LedStateName</FETCH>
        <FETCH>IncomeTaxNumber</FETCH>
        <FETCH>ClosingBalance</FETCH>
      </FETCHLIST>
    </DESC>
  </BODY>
</ENVELOPE>
```

If the ledger is missing, Tally returns `<STATUS>0</STATUS>` with a `<LINEERROR>Object does not exist.</LINEERROR>` — caller must treat this as a simple "not found".

### 4.4 Fetch Groups (to verify "Sundry Creditors" exists and find subgroups)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>BFGroupList</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>ACME Pvt Ltd</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="BFGroupList" ISINITIALIZE="Yes">
            <TYPE>Group</TYPE>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>Parent</NATIVEMETHOD>
            <NATIVEMETHOD>Reserved</NATIVEMETHOD>
            <NATIVEMETHOD>PrimaryGroup</NATIVEMETHOD>
            <NATIVEMETHOD>AlterID</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
```

Response items look like:

```xml
<GROUP NAME="Sundry Creditors" RESERVEDNAME="Sundry Creditors">
  <PARENT>Primary</PARENT>
  <PRIMARYGROUP>Current Liabilities</PRIMARYGROUP>
  <ALTERID>3</ALTERID>
</GROUP>
```

"Sundry Creditors" is a Tally-reserved group and will always exist in a fresh company; a missing result implies the Tally company is corrupted or using a non-standard chart of accounts — worth surfacing to the user.

### 4.5 Fetch connected company name

There is no direct "ping + company" endpoint. The idiomatic approach: query a tiny well-known Collection with `SVCURRENTCOMPANY` omitted, then read the `SVCURRENTCOMPANY` Tally echoes in the response header. Simpler: query the active company list from the built-in `List of Companies` report.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Companies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVISCURRENTCOMPANY>Yes</SVISCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>
```

Response:

```xml
<COLLECTION>
  <COMPANY NAME="ACME Pvt Ltd">
    <COMPANYNUMBER>1</COMPANYNUMBER>
    <STARTINGFROM>20240401</STARTINGFROM>
    <BOOKSFROM>20240401</BOOKSFROM>
    <GUID>40cf5e9a-…-0000000b</GUID>
    <STATENAME>Karnataka</STATENAME>
    <COUNTRYNAME>India</COUNTRYNAME>
    <GSTREGISTRATIONNUMBER>29AABCA1234C1Z5</GSTREGISTRATIONNUMBER>
  </COMPANY>
</COLLECTION>
```

Use the `<GUID>` as the tenant-to-Tally-company binding. Persist it on `TenantExportConfig`; if at next session the returned company GUID differs, flag the tenant — the user has switched / renamed the company and all ledger mappings are suspect.

---

## 5. Vendor push (create / alter a ledger)

### 5.1 Full-field Create example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>All Masters</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>ACME Pvt Ltd</SVCURRENTCOMPANY>
        <IMPORTDUPS>@@DUPCOMBINE</IMPORTDUPS>
      </STATICVARIABLES>
    </DESC>
    <DATA>
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <LEDGER NAME="Acme Foo Pvt Ltd" ACTION="Create">
          <NAME>Acme Foo Pvt Ltd</NAME>
          <PARENT>Sundry Creditors</PARENT>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <ISBILLWISEON>Yes</ISBILLWISEON>
          <AFFECTSSTOCK>No</AFFECTSSTOCK>
          <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
          <OPENINGBALANCE>0</OPENINGBALANCE>
          <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
          <PARTYGSTIN>29AABCA1234C1Z5</PARTYGSTIN>
          <GSTIN>29AABCA1234C1Z5</GSTIN>
          <LEDSTATENAME>Karnataka</LEDSTATENAME>
          <INCOMETAXNUMBER>AABCA1234C</INCOMETAXNUMBER>
          <PANIT>AABCA1234C</PANIT>
          <MAILINGNAME>Acme Foo Pvt Ltd</MAILINGNAME>
          <ADDRESS.LIST TYPE="String">
            <ADDRESS>Plot 42, Industrial Area</ADDRESS>
            <ADDRESS>Whitefield</ADDRESS>
            <ADDRESS>Bengaluru - 560066</ADDRESS>
          </ADDRESS.LIST>
          <PINCODE>560066</PINCODE>
          <EMAIL>ap@acme.example</EMAIL>
          <LEDGERPHONE>08040000000</LEDGERPHONE>
          <LEDGERMOBILE>9876543210</LEDGERMOBILE>
          <LEDGERCONTACT>Accounts Payable</LEDGERCONTACT>
          <BANKDETAILS.LIST>
            <BANKNAME>HDFC Bank</BANKNAME>
            <ACCOUNTNUMBER>50200012345678</ACCOUNTNUMBER>
            <BANKIFSCODE>HDFC0000123</BANKIFSCODE>
            <ACCOUNTHOLDERNAME>Acme Foo Pvt Ltd</ACCOUNTHOLDERNAME>
          </BANKDETAILS.LIST>
        </LEDGER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>
```

Field notes:
- `ACTION="Create"` fails if a ledger with the same `NAME` exists. Use `ACTION="Alter"` for update.
- `PARTYGSTIN` is the modern Tally Prime tag; `GSTIN` is the ERP-9 alias. Tally Prime accepts both. Emit both to be safe.
- `LEDSTATENAME` must exactly match one of Tally's known state names (§3.6 of MASTER-SYNTHESIS). Wrong state name will silently blank the field and break place-of-supply inference on downstream vouchers.
- `GSTREGISTRATIONTYPE` accepted values: `Regular`, `Composition`, `Unregistered/Consumer`, `Unknown`, `Regular - SEZ`, `Composition - SEZ`, `Tax Deductor`.
- `PANIT` / `INCOMETAXNUMBER` — both work, PANIT is the ERP 9 tag, INCOMETAXNUMBER is the Prime canonical. Emit both.
- `ISBILLWISEON=Yes` is **required** for Accounts Payable — without it, `BILLALLOCATIONS` entries on vouchers referencing this ledger are silently discarded.
- `COUNTRYOFRESIDENCE` defaults to `India` but required when GST is enabled.

### 5.2 Client-supplied GUID

Tally **does not accept** a client-supplied `<GUID>` on a Ledger master during Create — the GUID is always server-generated (company-guid suffix). On Alter, Tally resolves by `NAME=` attribute. Implication: we cannot use our own GUID for ledger idempotency; we must dedup by normalised `NAME` + optional GSTIN on our side, and persist Tally's returned GUID (once fetched) in `VendorMaster.tallyLedgerGuid`.

### 5.3 Name collision / matching strategy

Matching vendor records between BillForge and Tally is the central correctness problem. Rank matches in this order:

1. **GSTIN (deterministic)**. If both sides have a GSTIN, equality wins. Strip whitespace, upper-case.
2. **Tally LedgerGUID (persisted)**. Once we've observed a ledger and stored `tallyLedgerGuid` on VendorMaster, subsequent syncs are O(1).
3. **Exact name (normalised)**. Normalisation: Unicode NFKC, trim, collapse inner whitespace, casefold, strip trailing punctuation.
4. **Canonicalised name**. Expand common abbreviations: `Pvt` ↔ `Private`, `Ltd` ↔ `Limited`, `Co` ↔ `Company`, `&` ↔ `and`, remove honorifics (`M/s`, `Shri`, `Smt`). Drop trailing `Pvt Ltd` vs `Private Limited`. Prefer a deterministic canonical form over fuzzy.
5. **Token-set Jaccard** (fallback only, never auto-merge; surface as "possible match, confirm"). Threshold 0.7 as per RFC-BACKEND §4.3.7.

Blocking rule: never auto-create a Tally ledger when a GSTIN match exists but names differ — surface the conflict and let the user confirm.

### 5.4 ALLOWCREATION (avoid)

Tally exposes `<ALLOWCREATION>Yes</ALLOWCREATION>` in STATICVARIABLES for the voucher import path — if a voucher references an unknown ledger, Tally auto-creates it under `Primary`. **Do not use this**: it produces un-classified ledgers the user must manually re-parent, and it bypasses GSTIN/state population. Always create ledgers explicitly first, then import vouchers.

---

## 6. Voucher imports — revisited

### 6.1 GUID behaviour (confirmed)

Tally Prime accepts a client-supplied `<GUID>` on a VOUCHER. On re-import:
- If a voucher with the same GUID exists, behaviour depends on F12 setting "Overwrite voucher when voucher with same GUID exists".
  - `Yes` → voucher is altered in place (canonical idempotency path).
  - `No` → import is rejected with `LINEERROR: Voucher with same GUID already exists.`
- **The MASTER-SYNTHESIS assumption (D-030) that GUID is the idempotency key is correct and authoritative.** But: we must ship onboarding guidance for the user to enable "Overwrite voucher when voucher with same GUID exists" in Tally F12; otherwise re-exports fail. This is a concrete operational gap in the current plan.

`VOUCHERNUMBER` alone is not a dedup key. If two calls import the same voucher number on different GUIDs, Tally creates two vouchers. Separately, Tally has a user-configurable "Prevent duplicate voucher numbers" setting per voucher type — opinionated and off by default.

### 6.2 BILLALLOCATIONS semantics

`BILLTYPE` values:
- `New Ref` — creates a new outstanding bill. Used on Purchase, Debit Note party entries.
- `Agst Ref` — settles against an existing outstanding bill. Used on Payment, Receipt, Journal adjustments.
- `On Account` — advance/partial without specific bill reference.
- `Advance` — advance received (RCM implications on GST).

**Orphan behaviour (the hazard)**: if a Payment Voucher uses `BILLTYPE="Agst Ref"` with a `NAME` that matches no outstanding bill on the vendor, Tally does not return a LINEERROR. The allocation is silently recorded as an on-account credit for the vendor, and the original bill stays outstanding. Verified by community reports (eCom2Tally, Excel4Tally troubleshooting articles) and confirmed by absence of any "orphan reference" error in Tally's error taxonomy.

**Mitigation**: before generating a Payment Voucher, fetch the vendor's outstanding bills via a `Bills Outstanding` Collection query and verify the `REFERENCE` exists and has sufficient unallocated amount. This is a new precheck feature — call it **settlement precheck** — not currently in MASTER-SYNTHESIS.

Example outstanding-bills query:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>BFVendorBills</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>ACME Pvt Ltd</SVCURRENTCOMPANY>
        <LEDGERNAME>Acme Foo Pvt Ltd</LEDGERNAME>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="BFVendorBills" ISINITIALIZE="Yes">
            <TYPE>Bills</TYPE>
            <CHILDOF>##LEDGERNAME</CHILDOF>
            <FILTER>BFPendingOnly</FILTER>
            <NATIVEMETHOD>BillDate</NATIVEMETHOD>
            <NATIVEMETHOD>Name</NATIVEMETHOD>
            <NATIVEMETHOD>OpeningBalance</NATIVEMETHOD>
            <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="BFPendingOnly">$ClosingBalance &lt; 0</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>
```

### 6.3 Multi-invoice allocation in one payment voucher

```xml
<VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
  <DATE>20260415</DATE>
  <GUID>8f3b6c…-…-00012ab4</GUID>
  <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
  <VOUCHERNUMBER>PAY-2026-0042</VOUCHERNUMBER>
  <NARRATION>Settlement: INV-007, INV-011 | UTR HDFCN24011512345</NARRATION>

  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>HDFC Bank - Current</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-158000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>

  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Acme Foo Pvt Ltd</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>158000.00</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>INV-007</NAME>
      <BILLTYPE>Agst Ref</BILLTYPE>
      <AMOUNT>98000.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
    <BILLALLOCATIONS.LIST>
      <NAME>INV-011</NAME>
      <BILLTYPE>Agst Ref</BILLTYPE>
      <AMOUNT>60000.00</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </ALLLEDGERENTRIES.LIST>
</VOUCHER>
```

`BILLALLOCATIONS.LIST` is a repeated child of the single party `ALLLEDGERENTRIES.LIST`. Sum of allocation amounts must equal the party entry amount (positive side) — if it doesn't, Tally imports but splits the remainder as `On Account`, often silently.

---

## 7. Error taxonomy

### 7.1 Response parse ladder (recommended client logic)

```
1. HTTP status != 200           → transport error (retryable)
2. Response not well-formed XML → protocol error (non-retryable, log + alert)
3. <STATUS>0</STATUS>            → envelope-level failure
     inspect <LINEERROR> / <STATUS.LIST> / <DESC>
4. <STATUS>1</STATUS> + <IMPORTRESULT>:
     <ERRORS>0</ERRORS> and <LINEERROR> absent → full success
     <ERRORS>n</ERRORS> with n > 0             → partial failure
        scan body for <LINEERROR> blocks; each is one failed row
        correlate by ordinal position (Tally emits LINEERROR in the order
        messages were encountered, interleaved with success counters)
```

### 7.2 Common LINEERROR payloads and causes

| LINEERROR message | Cause | Recovery |
|---|---|---|
| `Ledger 'X' does not exist.` | Voucher references a ledger not present in Tally | Create ledger (§5), retry the single voucher. |
| `Voucher Totals do not match.` | Sum of `AMOUNT` entries ≠ 0 (Dr ≠ Cr) | Validate server-side before send; inspect `BILLALLOCATIONS` partial sums. |
| `Bill ‐ Allocation totals do not match.` | `BILLALLOCATIONS` sum ≠ party entry amount | Client bug; enforce sum invariant. |
| `Date is not within the financial period.` | `DATE` or `EFFECTIVEDATE` outside open accounting period | Block export client-side; surface to user ("open the FY in Tally first"). |
| `Currency 'USD' does not exist.` | Foreign currency not defined in Tally | Pre-create currency or coerce to base. |
| `Parent Group 'X' does not exist.` | Custom chart of accounts doesn't have `Sundry Creditors` | Rare; fall back to user-mapped parent from TenantExportConfig. |
| `Could not set value for GSTIN` | Invalid GSTIN length/format | Validate 15-char regex before send. |
| `No entries in voucher.` | All ledger entries were rejected (commonly cascading from ledger-not-found) | Re-synthesise after fixing root cause. |
| `Object does not exist.` | Object query target missing | Treat as 404. |
| `Voucher with same GUID already exists.` | Re-import with F12 overwrite = No | Flip F12 setting OR switch to `ACTION="Alter"`. |
| `Company is not loaded.` | `SVCURRENTCOMPANY` doesn't match an open company | Onboarding check (§4.5). Bridge should re-verify company GUID before every batch. |
| `Cannot import vouchers - company is locked` | Another user has edit lock | Retry with backoff (30-120 s). |

### 7.3 Partial-batch handling

A batch import of N vouchers with k failures returns `<CREATED>N-k</CREATED><ERRORS>k</ERRORS>` and k `<LINEERROR>` entries in the body. Critically, Tally does not return a voucher-number→error map. You must:

- Send each batch with a **deterministic order** (sort by voucher number).
- Parse LINEERROR occurrences in order and correlate to the voucher at the same ordinal index.
- Heuristic for older ERP-9 responses that sometimes omit ordinal hints: re-run failed invoices individually to get a clean 1:1 mapping (slow, reserve for reconciliation).

This means **Batch size tuning matters**: batches of 100 (per C-018) keep retry cost bounded. Smaller batches (10–25) for noisy tenants.

---

## 8. Version differences

### 8.1 Tally ERP 9 vs Tally Prime — what changes

| Area | ERP 9 | Prime |
|---|---|---|
| Core XML envelope | Identical | Identical |
| `ALLLEDGERENTRIES.LIST` | Supported | Supported (canonical) |
| `LEDGERENTRIES.LIST` (legacy) | Accepted | Accepted but discouraged |
| GSTIN field | `GSTIN` on ledger | `PARTYGSTIN` (preferred), `GSTIN` also accepted |
| PAN field | `PANIT` | `INCOMETAXNUMBER` (preferred), `PANIT` accepted |
| State field | `LEDSTATENAME` | `LEDSTATENAME` (same) |
| GUID on voucher | Supported | Supported; F12 toggle adds explicit overwrite semantics |
| AlterID | Supported | Supported |
| Bank details `BANKDETAILS.LIST` | Partial | Full in Prime 2.x+ |
| e-invoicing fields (`IRN`, `EINVOICEDETAILS`) | No | Yes (Prime 3.x+) |
| HTTP server behaviour | Same | Same |
| "Overwrite voucher by GUID" F12 setting | Present (different label) | Present, renamed in Prime 4.x |

Practical rule: emit both `GSTIN` and `PARTYGSTIN`, both `PANIT` and `INCOMETAXNUMBER`. Parse responses tolerantly (either tag).

### 8.2 Install base (2026)

Authoritative numbers are not public. Based on cross-referencing Tally Solutions press releases, third-party ERP market share trackers (6sense, Munimji), and partner commentary:
- Tally **Prime** is the only SKU actively sold since 2020; all new installs are Prime.
- Tally **ERP 9** has no end-of-life yet announced but is in "maintenance only" posture; estimated 20-30% of the install base still runs ERP 9, particularly in tier-2 cities and conservative MSMEs.
- Tally **Prime Server** is a tiny sliver (enterprise, multi-user LAN) — <5%.

Implication: BillForge must support both ERP 9 and Prime at the XML level. This is low-cost (pay the `GSTIN`/`PARTYGSTIN` dual-emit tax) but non-zero.

**Caveat**: these percentages are estimates from secondary sources; Tally Solutions does not publish a Prime/ERP-9 split.

### 8.3 Prime Server — relevance

Tally Prime Server is multi-threaded with concurrent request handling, which relaxes §9.3's single-in-flight constraint. For tenants on Prime Server, the bridge can issue parallel queries. Detection: the server header / company metadata response differs slightly but the only reliable signal is asking the user at onboarding. Treat as a V2 optimisation, not MVP.

---

## 9. Recommended sync architecture for BillForge

### 9.1 Onboarding flow

```
User action                     Bridge agent                    Backend
-----------                     ------------                    -------
Install agent.exe      --->     Register with backend    --->   Issue tenant-scoped
                                (shows pairing code)            agent token; store
                                                                bridge_agent row
User enters code  <-->          Pair exchange                  Mint mTLS cert

Open Tally, select              Ping http://localhost:9000
company "ACME"                  Receive "TallyPrime Server      
                                is Running"
                                
                                Query "List of Companies"
                                (§4.5)                  --->    Upsert TenantTallyCompany:
                                                                { companyGuid, name,
                                                                  stateName, gstin }

                                Query groups (§4.4)     --->    Assert Sundry Creditors
                                                                exists; persist custom
                                                                chart of accounts

                                Query all Sundry        --->    Bulk upsert VendorMaster:
                                Creditor ledgers                - tallyLedgerName
                                (§4.1)                          - tallyLedgerGuid
                                                                - tallyAlterId (cursor)
                                                                - GSTIN, state, PAN

                                Query TDS/GST/bank      --->    Populate TenantExportConfig
                                ledger shortlist                suggestion box

                                Set lastFullSyncAt =
                                NOW
User clicks "Done"
```

Cache policy:
- Ledger list refresh **TTL: 24h** OR on manual user action OR on export precheck miss.
- Company identity: verify GUID on every session start; mismatch → block exports + alert.
- AlterID cursor persisted per-collection per-tenant.

### 9.2 Pre-export vendor-existence check

```
                       Invoice batch N
                          │
                          ▼
          ┌──────── collect unique vendor keys ────────┐
          │       (GSTIN preferred, else name)         │
          └────────────────────┬───────────────────────┘
                               ▼
              lookup VendorMaster by GSTIN / fingerprint
                    │                         │
         all matched?                   missing or stale
                    │                         │
                    │                  ┌──────┴──────┐
                    │                  ▼             ▼
                    │           bridge online?   no bridge (file mode)
                    │                  │             │
                    │              query ledger     skip precheck;
                    │              by GSTIN/name    include hint in
                    │                  │            downloaded XML
                    │        ┌────┬────┴────────┐
                    │        ▼    ▼             ▼
                    │      found  not found    ambiguous
                    │        │    │             │
                    │        │    ▼             ▼
                    │        │  autoCreate    block batch;
                    │        │  enabled?      surface conflict
                    │        │    │ │          to user
                    │        │   Y N
                    │        │    │ └─► block invoice
                    │        │    ▼
                    │        │   create ledger (§5)
                    │        │    │
                    │        ▼    ▼
                    │      persist tallyLedgerGuid on VendorMaster
                    ▼            │
                    └────────────┴───► push vouchers batch (§6)
```

Round-trip budget:
- Warm path (cache hit, GSTIN match): zero Tally calls before push.
- Cold path per missing vendor: 1 Object query (§4.3) + 1 Import (§5) = 2 calls. At ~200 ms each over loopback, 1-3 s overhead for up to 7 new vendors per batch.
- Always precompute the full vendor set before pushing any vouchers, to avoid partial successes where voucher k imports but k+1 fails because vendor didn't exist at that instant.

### 9.3 Drift detection / periodic reconciliation

**Trigger**: scheduled cron inside bridge (every 15 min while Tally is open), plus on-demand from the backend.

**Algorithm** (uses AlterID cursor):

```
lastLedgerAlterId   = TenantSyncState.lastLedgerAlterId   // per tenant
lastVoucherAlterId  = TenantSyncState.lastVoucherAlterId

QUERY Collection "Ledger" WHERE Parent="Sundry Creditors" 
                           AND  BelongsTo=Yes 
                           AND  $AlterID > lastLedgerAlterId
      NATIVEMETHOD Name, PartyGSTIN, LedStateName, AlterID, GUID, …

for each ledger in response:
  match by GUID in VendorMaster
    if found  -> diff fields, update if changed (log audit row)
    if absent -> new-in-Tally drift: create VendorMaster, flag "ext_created"
  update lastLedgerAlterId = max(…, row.AlterID)

Similar loop over Voucher collection for post-sync drift in Tally
(user editing imported voucher in Tally). Compare BillForge.exportVersion
GUIDs; emit a "drift_voucher_edited" event if Tally's voucher has higher
AlterID than what we last pushed.
```

The AlterID filter in TDL uses `$AlterID > {value}` inside a `FILTER` + `SYSTEM` definition — see §6.2 example for the inline-formula pattern.

**Webhooks**: Tally has **no webhook / push mechanism**. All drift detection is pull-based. This is unavoidable.

### 9.4 Desktop bridge agent — minimum viable scope

**Language/runtime**: Go or .NET (single static binary, no VM dependency). Electron is feasible but the 100-150 MB footprint is hostile to Tally-machine deployments, which are often old Windows SKUs with limited disk. Recommended: **Go**, cross-compiled to `win/amd64`, packaged as a Windows service via NSSM or native SC.

**Minimum features (v1)**:

1. One-way outbound tunnel — HTTP long-poll or WebSocket to BillForge backend; the agent pulls work items.
2. Tally HTTP client: builds envelopes, POSTs to `http://localhost:9000`, parses responses, returns JSON summary to backend.
3. Local mutex: serialise calls; max one in-flight Tally request per Tally process.
4. Liveness: every 30 s, probe Tally server string and return to backend.
5. Secure credential storage (Windows Credential Manager / DPAPI).
6. Auto-update channel (signed releases).
7. Tray UI (Windows) showing: connected company, last sync, errors, "open logs" button.
8. Diagnostic export (ZIP of last N Tally requests/responses, sanitised).

**Not in v1**: ODBC fallback, Linux build, multi-company switching, schedule editor UI (leave scheduling to backend).

**Operator ergonomics**: ship an MSI that (a) installs as Windows service, (b) runs the interactive tray UI per logged-in user, (c) adds `localhost:9000` to the Windows Firewall allow-list for Tally (many deployments silently block it; see tallyhelp firewall article).

---

## 10. Open questions / unresolved points

| # | Question | Blocker to resolve | Safe assumption |
|---|---|---|---|
| O-1 | Does Tally Prime 5.x change any of the voucher import response tag names (e.g. `IMPORTRESULT` renamed)? | Need test against Prime 5 | Current tags still work; code must be tolerant of extra fields. |
| O-2 | What exactly is returned when an AlterID-filtered Collection matches zero rows — empty `<COLLECTION/>` or absent body? | Need live Tally | Code defensively: treat both as "no changes". |
| O-3 | Does "Overwrite voucher when same GUID exists" default to Yes or No in fresh Prime 4.x installs? | Need test install | Assume No → we must document F12 toggling in onboarding. |
| O-4 | Are there any write-side rate limits distinct from concurrency? (e.g. Tally throttles > 10 imports/sec even sequentially) | Need load test | Cap at 5 RPS per Tally instance; monitor response time and back off. |
| O-5 | Is there a way to query Tally's current F12 settings over XML to verify "Overwrite by GUID = Yes"? | Dig into TDL system variables | Unclear. Fall back to sending a probe import with a known-dupe GUID and observing the LINEERROR. |
| O-6 | Behaviour when user closes the Tally company mid-batch (response mid-flight) | Need test | Bridge must detect and pause queue; batch becomes partial-fail. |
| O-7 | Multi-company tenants (one Tally instance, many companies loaded) — does the bridge need `SVCURRENTCOMPANY` per request, or does Tally maintain "selected"? | Test | `SVCURRENTCOMPANY` per request is defensive and mandatory for multi-tenant SaaS. |
| O-8 | Legal / ToS: does Tally Solutions permit a redistributable connector that automates XML? | Legal review | Community connectors (Suvit, CredFlow, Biz Analyst, ClearTax) exist at scale — strong precedent, but confirm before GA. |

---

## 11. Sources

Official Tally documentation:
- [TallyHelp — XML Integration](https://help.tallysolutions.com/xml-integration/)
- [TallyHelp — Integration With TallyPrime](https://help.tallysolutions.com/integration-with-tallyprime/)
- [TallyHelp — Pre-requisites for Integrations](https://help.tallysolutions.com/pre-requisites-for-integrations/)
- [TallyHelp — Case Study 1: XML Request and Response Formats](https://help.tallysolutions.com/article/DeveloperReference/integration-capabilities/case_study_1.htm)
- [TallyHelp — Case Study 1 (td9rel54 mirror)](https://help.tallysolutions.com/docs/td9rel54/integration-capabilities/case_study_1.htm)
- [TallyHelp — Case Study II: Creation and Alteration of Vouchers](https://help.tallysolutions.com/article/DeveloperReference/integration-capabilities/case_study_2.htm)
- [TallyHelp — Sample XML](https://help.tallysolutions.com/sample-xml/)
- [TallyHelp — Understanding Tally XML Tags](https://help.tallysolutions.com/understanding-tally-xml-tags/)
- [TallyHelp — Objects and Collections](https://help.tallysolutions.com/article/DeveloperReference/tdlreference/objects_and_collections.htm)
- [TallyHelp — Collection Related Attributes](https://help.tallysolutions.com/what-are-collection-related-attributes-in-tdl/)
- [TallyHelp — General and Collection Enhancements](https://help.tallysolutions.com/article/DeveloperReference/tdlreference/general_and_collection_enhancements.htm)
- [TallyHelp — Import Data FAQ](https://help.tallysolutions.com/import-data-faq/)
- [TallyHelp — Integration using ODBC Interface](https://help.tallysolutions.com/article/DeveloperReference/integration-capabilities/using_odbc_interface.htm)
- [TallyHelp — Creating Party Ledgers for GST (ERP 9)](https://help.tallysolutions.com/article/Tally.ERP9/Tax_India/gst/creating_party_ledgers_for_gst.htm)
- [TallyHelp — Create Party Ledgers for GST in TallyPrime](https://help.tallysolutions.com/tally-prime/gst-master-setup/india-gst-creating-party-ledgers-for-gst-tally/)
- [TallyHelp — Pre-allocate Bills for Payment or Receipt](https://help.tallysolutions.com/article/Tally.ERP9/Voucher_Entry/Accounting_Vouchers/Pre_Allocate_Bills_for_Payment_Receipt.htm)
- [TallyHelp — Remote Access in TallyPrime](https://help.tallysolutions.com/remote-access-tally/)
- [TallyHelp — TallyPrime Server FAQ](https://help.tallysolutions.com/tally-prime-server/tally-prime-server-faq/)
- [TallyHelp — Synchronisation FAQ](https://help.tallysolutions.com/tally-prime/data-exchange-tally-prime/synchronisation-faq-tally/)
- [TallyHelp — Authentication Library: Get Data](https://help.tallysolutions.com/article/DeveloperReference/auth-lib/get_data.htm)
- [TallyHelp — Authentication Library: Get Company Name](https://help.tallysolutions.com/article/DeveloperReference/auth-lib/get_company_name_corresponding_to_the_connect_name.htm)
- [TallyHelp — XML Requests and Responses (Auth Library)](https://help.tallysolutions.com/developer-reference/tally-authentication-library/xml-requests-and-responses/)
- [TallyHelp — Firewall exceptions for TallyPrime](https://help.tallysolutions.com/add-tallyprime-exe-ports-to-firewall-exceptions/)
- [TallyHelp — Advanced Configuration (F12 server port)](https://help.tallysolutions.com/article/Tally.ERP9/Maintaining_Company_Data/F12_Config/advanced_configuration.htm)

Community references:
- [GitHub — NoumaanAhamed/tally-prime-api-docs](https://github.com/NoumaanAhamed/tally-prime-api-docs/blob/main/index.md)
- [Postman — TallyPrime collection](https://documenter.getpostman.com/view/13855108/TzeRpAMt)
- [TDL Integration blog — Tally XML Integration case study](http://tdlintegration.blogspot.com/2012/11/case-study-tally-xml-integration.html)
- [ghanshyamdigital.com — Exporting data from Tally Prime using XML](https://blog.ghanshyamdigital.com/how-to-use-xml-requests-for-exporting-data-from-tally-prime)
- [rtslink.com — Tally XML tags reference](https://www.rtslink.com/articles/tally-xml-tags-export/)
- [aaplautomation.com — Export Ledgers & Stock Items (PDF)](https://www.aaplautomation.com/tally_img/1616499479Export%20Ledgers%20&%20Stock%20Items%20of%20Selected%20Group%20in%20XML.pdf)
- [Excel4Tally blog — "Ledger does not exist" error](http://blog.excel4tally.com/ledger-does-not-exist-in-tally-tally-xml-import-error/)
- [Excel4Tally — Duplicate entry created when XML imported](http://blog.excel4tally.com/duplicate-entry-created-in-tally-when-xml-file-imported/)
- [Excel2Tally — How to control duplicate voucher import](https://knowledge.excel2tally.in/how-to-control-duplicate-voucher-import-in-tally/)
- [eCom2Tally — Controlling duplicate voucher import](https://ecom2tally.in/how-to-control-duplicate-voucher-import-in-tally/)
- [TallyPrimeBook — Directly create party ledgers using GSTIN](https://tallyprimebook.com/directly-create-party-ledgers-using-gstin-uin-in-tallyprime-5/)
- [GitHub — dhananjay1405/tally-database-loader](https://github.com/dhananjay1405/tally-database-loader/blob/main/docs/incremental-sync.md)
- [AI Accountant — Tally integration (concrete architecture reference)](https://www.aiaccountant.com/blog/tally-integration-with-ai-accountant)
- [Spectra Compunet — Differences between TallyPrime and TallyPrime Server](https://www.spectracompunet.com/blog/differences-between-tallyprime-and-tallyprime-server-1)
- [TallyAtCloud — Max concurrent users: single vs multi user](https://www.tallyatcloud.com/article/tally-prime-maximum-concurrent-users-explained-single-user-vs-multi-user-limits-server-cloud-access/836/0/1)
- [MarkIT Solutions — 5 ways to remotely access Tally](https://www.markitsolutions.in/blog-details/5-different-ways-to-remotely-access-tally)
- [winhelponline — Tally Error 404 (gateway)](https://www.winhelponline.com/blog/tally-error-404-unable-to-connect-to-tally-gateway-server/)
- [CData — Tally ODBC driver](https://www.cdata.com/drivers/tally/odbc/)

Caveats on source quality:
- Official Tally docs are fragmented across ERP 9, Prime, and Authentication Library sections; some pages 404; many use slightly different tag casing.
- Several details (GUID overwrite F12 default, concurrency behaviour under load, exact LINEERROR strings for every edge case) are only attested in community blogs or Q&A forums, not in Tally official docs. Those claims are flagged in the body of the document. Any production rollout must validate against a live Tally Prime install across ERP 9, Prime 3.x, Prime 4.x, Prime 5.x.
