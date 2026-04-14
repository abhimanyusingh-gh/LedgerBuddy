# BillForge -- Product Requirements Document for CA and Accounting Firms in India

> **Implementation Status (2026-04-14)**
>
> This document serves as the domain reference for BillForge's India-focused feature set.
> Features marked [IMPLEMENTED] are live in the current codebase. Features marked [PLANNED]
> are designed but not yet built. Authentication is Keycloak-only (OIDC). Roles are
> PLATFORM_ADMIN, TENANT_ADMIN, MEMBER, VIEWER at the base level, with persona-based
> capability defaults (ap_clerk, senior_accountant, ca, tax_specialist, firm_partner,
> ops_admin, audit_clerk). See `docs/state-machine/RBAC-OVERHAUL.md` for the full
> capability system.

---

## 1. Executive Summary

BillForge is an AI-powered invoice processing platform purpose-built for Indian accounting practices. It takes the most tedious, error-prone work in a CA firm -- receiving invoices, keying in data, splitting GST components, verifying TDS applicability, cross-referencing PAN and GSTIN, and exporting to Tally -- and automates it end to end. For firm owners managing dozens of clients, each with hundreds of invoices per quarter, BillForge transforms a manual bottleneck into a streamlined, auditable pipeline.

The platform is designed around the realities of Indian compliance. It understands CGST, SGST, IGST, and Cess at the line-item level. It auto-detects TDS sections and rates based on vendor PAN category and GL classification. It validates GSTIN format, cross-references PAN with GSTIN, flags MSME payment deadlines, and checks for e-invoice IRN where required. Every extracted value is traced back to the exact location in the source document -- a bounding box on the original PDF -- giving your team the confidence to approve and export without re-checking the physical invoice.

BillForge operates as a multi-tenant platform, meaning each of your clients gets their own isolated workspace with its own chart of accounts, TDS mappings, approval workflows, and user permissions. Your firm partner sees aggregate analytics across all clients. Your senior accountants review and approve. Your AP clerks upload and manage day-to-day data. Your tax specialists handle TDS/TCS overrides. And your external auditors get read-only viewer access to exactly the data they need -- nothing more, nothing less.

---

## 2. The Problem

CA and accounting firms in India face a set of interlocking challenges that grow worse with every new client added to the practice.

**Manual data entry at scale.** When a client sends 200 purchase invoices for quarterly GST filing, each one must be opened, read, and keyed into your working sheet or Tally. A single invoice may require entry of 15 or more fields: invoice number, date, vendor name, GSTIN, PAN, line items with HSN/SAC codes, individual tax rates, CGST, SGST or IGST amounts, Cess, total, bank details, and due date. Multiply that across 30 clients and a small firm is staring at thousands of manual entries every quarter.

**GST compliance complexity.** Determining whether to apply CGST+SGST (intra-state) or IGST (inter-state) requires knowing both the supplier and recipient GSTIN state codes. HSN/SAC classification must be correct for rate determination. A wrong split means mismatch notices from the GST portal, leading to hours of reconciliation work and potential penalties for your client.

**TDS and TCS intricacy.** Each invoice may attract TDS under a different section -- 194C for contractor payments, 194J for professional fees, 194H for commission -- with different rates depending on whether the vendor is a company (PAN category "C"), an individual, or has no PAN at all (triggering the 20% penalty rate under Section 206AA). TCS adds another layer, with tenant-specific rates that change with Finance Act amendments. Getting this wrong exposes your client to interest and penalty under Section 201.

**Error-prone verification.** Manually verifying that the PAN on an invoice matches the PAN embedded in the vendor's GSTIN is tedious but critical. A mismatch may indicate an invalid invoice. Similarly, detecting that a vendor has changed their bank account details -- a common vector for payment fraud -- is nearly impossible when processing at volume.

**Juggling personal and business clients.** Firms serving a mix of proprietorship, partnership, LLP, and corporate clients need different compliance workflows, different GL structures, and different approval hierarchies for each. A single shared spreadsheet cannot accommodate this.

**Tally export friction.** After all the verification work, the final step -- getting data into Tally -- often involves manual voucher creation or error-prone XML file generation. GST ledger entries must be split correctly, TDS payable ledgers must reference the right section, and the narration must carry enough context for audit trail.

**Difficulty scaling.** The direct consequence of all the above: firms cannot take on more clients without hiring proportionally more staff. A firm handling 20 clients with 4 staff members cannot handle 40 clients without 8 staff members, because the work is linear and manual.

---

## 3. The Solution: BillForge

BillForge addresses each of these pain points through an integrated platform built from the ground up for Indian accounting practices.

**AI-Powered Extraction.** Invoices enter the system through upload, email ingestion, or folder watch. OCR reads every line. An AI language model then extracts structured fields -- vendor name, invoice number, date, line items with HSN/SAC, tax breakdowns, PAN, GSTIN, bank details -- and produces a confidence score for each field. The system highlights exactly where on the source document each value was found.

**India-First Compliance Engine.** BillForge automatically splits GST into CGST/SGST or IGST based on extracted GSTIN data. It detects the applicable TDS section from GL category and PAN type, calculates the TDS amount and net payable, validates PAN format and cross-references it with GSTIN, checks for MSME payment deadlines, and flags missing e-invoice IRN for high-value transactions. Every compliance check produces a clear risk signal -- not a hidden score, but a visible, actionable finding.

**One Client, One Workspace.** Each client is a separate tenant with its own chart of accounts, vendor master, TDS section mappings, TCS rates, approval workflows, and user access list. Data is completely isolated. Your team members can be assigned to specific clients with specific roles.

**Role-Based Team Access.** From firm partner (full control across clients) to audit clerk (read-only access for external auditors), BillForge maps to how your firm actually operates. Roles control who can upload, who can edit, who can approve, who can export, and who can only view.

**One-Click Tally Export.** When invoices are approved, BillForge generates Tally-compatible XML with purchase vouchers that include the correct party ledger, GL-mapped purchase ledger, CGST/SGST/IGST/Cess ledger entries, and TDS payable ledger entries. Download the file and import it directly into Tally ERP or TallyPrime.

**Bank Statement Reconciliation.** Upload a bank statement (PDF or CSV), and BillForge automatically matches debit transactions to approved invoices based on amount, invoice number, vendor name, and date proximity. TDS and TCS adjustments are factored into the matching. Unmatched transactions and suggested matches are presented for manual review.

---

## 4. Key Features

### 4a. Invoice Capture [IMPLEMENTED]

BillForge supports three methods for getting invoices into the system:

- **Manual upload.** Drag and drop PDF, image (JPEG, PNG), or scanned invoice files directly into the web interface. Multiple files can be uploaded in a single batch.
- **Email ingestion via Gmail.** Connect your client's accounts payable inbox (or a dedicated BillForge inbox) via Gmail OAuth. The system polls the inbox on a configurable schedule, extracts invoice attachments from emails, and feeds them into the processing pipeline. Mailbox assignments can be scoped to specific team members.
- **Folder watch / S3 ingestion.** For firms with automated document management, BillForge monitors an S3-compatible storage folder and ingests new files automatically. This supports integration with document scanners, ERP systems, or other tools that deposit files into a shared location.

Each ingested invoice receives a unique identifier and tracks its source (email, upload, or folder), attachment filename, and receipt timestamp.

### 4b. AI Extraction and Verification [IMPLEMENTED]

The extraction pipeline operates in two stages:

**Stage 1: OCR.** The document is processed by an OCR engine that produces a full text transcript along with block-level data -- the text, page number, and bounding box coordinates for every recognized region of the document. OCR confidence is measured at the block level.

**Stage 2: SLM (Small Language Model) Extraction.** The OCR output is fed to an AI language model specifically tuned for invoice extraction. The SLM identifies and extracts:

- Invoice number, date, and due date
- Vendor name
- Total amount and currency
- Line items with description, HSN/SAC code, quantity, rate, amount, tax rate, and per-item CGST/SGST/IGST
- GST summary: GSTIN, subtotal, CGST, SGST, IGST, Cess, total tax
- PAN and bank account details (account number, IFSC)
- Invoice type classification (purchase, service, expense) and category
- TDS section suggestion based on content classification

**Confidence scoring.** Each extracted invoice receives an overall confidence score (0-100) calculated from OCR confidence (65% weight), field completeness (35% weight), and penalty deductions for risk signals and compliance issues. Scores are color-coded: green (91+), yellow (80-90), red (below 80). Invoices above a configurable threshold are automatically flagged as ready for approval.

**Source traceability.** This is a critical differentiator. Every extracted field is linked back to its source location in the original document through:

- **Bounding box coordinates** that pinpoint the exact region on the page where the value was found
- **OCR block references** identifying which text block contributed to the extraction
- **Field overlay images** that show a cropped view of the source region with the relevant area highlighted
- **Per-field confidence** indicating how certain the AI is about each individual extraction

When a senior accountant reviews an invoice, they can click on any extracted field -- say, the total amount or the GSTIN -- and immediately see where on the original PDF that value came from, with the relevant region highlighted. This eliminates the need to manually search through the source document to verify a number.

### 4c. GST and Compliance Engine [IMPLEMENTED]

The compliance engine runs automatically on every extracted invoice and produces a structured compliance record with the following components:

**PAN Validation**
- L1 validation: Format check (ABCDE1234F pattern)
- L2 validation: Cross-reference with GSTIN (PAN embedded in positions 3-12 of the GSTIN must match)
- Source tracking: Whether PAN was extracted from the invoice, derived from GSTIN, or entered manually
- Risk signals for format-invalid PAN and PAN/GSTIN mismatch

**TDS Auto-Detection and Calculation**
- Section detection based on GL category and vendor PAN type (company, individual, HUF, firm, etc.), using configurable section-mapping rules with priority-based resolution
- Rate lookup from a maintained rate table with rates for companies, individuals, and no-PAN scenarios
- Threshold awareness: single-transaction and annual thresholds per section
- Automatic calculation: TDS amount = taxable base (subtotal before GST) x applicable rate
- Net payable computation: total invoice amount minus TDS
- Risk signals: TDS_SECTION_AMBIGUOUS when multiple sections could apply, TDS_NO_PAN_PENALTY_RATE when vendor PAN is missing (20% penalty rate under 206AA), TDS_BELOW_THRESHOLD when amount is below the deduction threshold

**TCS Configuration**
- Tenant-level TCS rate configuration with effective date, enable/disable toggle, and change history
- Role-based access control for TCS rate modification (configurable per tenant)
- Automatic TCS computation on invoice amounts
- Full audit trail of every rate change with timestamp, user, reason, and effective date

**GSTIN Validation**
- Format validation against the 15-character GSTIN pattern
- PAN derivation from GSTIN for cross-verification

**IRN (Invoice Reference Number) Validation**
- Format validation for the 64-character hex IRN
- Risk signal when high-value invoices from GSTIN-registered vendors lack an IRN (e-invoicing threshold check)

**MSME Compliance**
- Udyam number format validation
- Vendor classification tracking (micro, small, medium)
- 45-day payment deadline monitoring with warning at 30 days and critical alert at 45 days
- Risk signals: MSME_PAYMENT_DUE_SOON, MSME_PAYMENT_OVERDUE

**Vendor Bank Account Monitoring**
- Bank account details are hashed and tracked per vendor
- Automatic detection when a vendor submits an invoice with different bank details than previously seen
- Critical fraud risk signal (VENDOR_BANK_CHANGED) when bank account changes
- Bank name derivation from IFSC prefix (HDFC, ICICI, SBI, Axis, Kotak, etc.)

**Email Sender Verification**
- Domain tracking per vendor
- Risk signals when invoice is received from a freemail domain (Gmail, Yahoo) but vendor previously used a corporate domain
- Domain mismatch detection when sender domain does not match vendor's known email domains

**Duplicate Invoice Detection**
- Cross-references vendor name and invoice number against existing records
- Content hash comparison to distinguish genuine resubmissions from duplicates
- Critical fraud risk signal with reference to the original invoice

**GL Code Auto-Suggestion**
- Vendor history-based suggestion: learns from past GL code assignments per vendor, weighted by recency and frequency
- Description-based matching: falls back to token-matching against the chart of accounts when no vendor history exists
- Confidence scoring with suggested alternatives when confidence is below 60%
- Usage tracking: every GL code assignment improves future suggestions

**Cost Center Assignment**
- Vendor history-based suggestion: learns from past cost center assignments
- GL-linked fallback: suggests cost center linked to the assigned GL code
- Usage tracking for progressive learning

### 4d. Review and Approval Workflow [IMPLEMENTED]

BillForge provides a configurable multi-step approval workflow:

**Simple mode** offers a straightforward configuration:
- Team member approval (any team member can approve)
- Optional: Manager review (admin-level sign-off)
- Optional: Final sign-off (second admin-level approval)

**Advanced mode** allows full customization:
- Unlimited approval steps in sequence
- Each step can require approval from: any team member, a specific role (e.g., Senior Accountant), specific named users, or users with a particular capability
- Approval rules: "any one" or "all" approvers at each step
- Conditional steps: can be configured to activate only when conditions are met (e.g., only require Manager review when invoice total exceeds Rs 5,00,000, or when risk signal severity is critical)
- Step types: standard approval, compliance sign-off, or escalation
- Timeout and escalation: configurable timeout per step with escalation targets

**Workflow behavior:**
- Invoices in PARSED or NEEDS_REVIEW status can be submitted to the approval workflow
- Each step tracks who approved, when, their role, and any notes
- Rejection at any step returns the invoice to NEEDS_REVIEW with the rejection reason logged
- Editing an invoice's parsed fields while in the approval workflow automatically resets the workflow
- Disabling the workflow returns all AWAITING_APPROVAL invoices to NEEDS_REVIEW

**Viewer access:** External auditors and read-only stakeholders can be assigned the VIEWER role (audit_clerk persona), which provides visibility into invoice data, compliance records, and risk signals without the ability to upload, edit, approve, or export. Data scope can be configured per viewer through ViewerScope.

### 4e. Export and Integration [IMPLEMENTED]

**Tally XML Export**

BillForge generates Tally-compatible XML files that can be imported directly into Tally ERP 9 or TallyPrime. The generated purchase vouchers include:

- Voucher type: Purchase
- Party ledger: mapped from extracted vendor name
- Purchase ledger: mapped from GL code suggestion or configurable default
- Date: from extracted invoice date (falls back to receipt date)
- Voucher number: from extracted invoice number
- GST entries: separate ledger entries for CGST, SGST, IGST, and Cess with configurable ledger names
- TDS entries: dedicated TDS Payable ledger entry with section reference (e.g., "TDS Payable - 194C")
- GSTIN: included in the party GSTIN field
- Narration: source reference, attachment name, and BillForge internal ID for audit trail

The export supports both single-invoice and batch export. Batch export generates a single XML file with all selected invoices. Export history is maintained with batch ID, timestamp, success/failure counts, and the ability to re-download previously generated XML files.

**Tally Mapping Preview**

Before export, the user can review a field-by-field mapping table showing:
- What was extracted (detected value)
- What Tally field it maps to
- What value will actually be sent
- Tooltips explaining the Tally XML path for each field

**CSV Export**

For firms that need to import into systems other than Tally, BillForge also supports CSV export of invoice data.

**Bank Statement Reconciliation**

- Upload bank statements in PDF or CSV format
- Automatic parsing of transactions (date, description, reference, debit, credit, balance)
- Intelligent matching against approved and exported invoices:
  - Amount matching with 10% tolerance (accounting for TDS and TCS adjustments)
  - Invoice number matching against transaction description
  - Vendor name matching against transaction description
  - Date proximity scoring (bonus for transactions within 3 days of approval)
- Match confidence scoring: automatic match above 50, suggested match between 30-50, unmatched below 30
- Manual match and unmatch capabilities
- Reconciliation status tracked on the invoice compliance record
- Bank payment verification signal added to invoice risk signals upon match

### 4f. Practice Management [IMPLEMENTED]

**Multi-Tenant Architecture**

Each client is a separate tenant with complete data isolation:
- Separate document storage (S3/MinIO)
- Independent chart of accounts (GL codes)
- Independent TDS section mappings and rate tables
- Independent TCS configuration with audit trail
- Independent cost center structure
- Independent vendor master
- Independent approval workflows
- Independent compliance configuration (which checks to enable, which risk signals to suppress)

**Platform Analytics Dashboard**

For the firm partner or practice manager, BillForge provides a cross-tenant analytics view:
- Total documents processed, approved, and exported across all clients
- Status distribution (approved, exported, needs review, failed)
- Documents by tenant (bar chart)
- OCR and SLM token usage by tenant
- User count by tenant
- KPI summary: total documents, approved count, approved amount, pending amount, exported count, needs review count

**Tenant-Level Analytics Dashboard**

Within each client workspace:
- KPIs: total invoices, approved count, approved amount (in Rs), pending amount, exported count, needs review count
- Daily trend charts: approvals, ingestion volume, exports
- Status breakdown donut chart
- Top vendors by approved amount and pending amount
- Burndown chart showing processing pipeline velocity
- Date range presets: today, this week, this month, this quarter, custom range
- Scope toggle: view your own activity or all team activity
- Period-over-period trend comparison

**User Management** [IMPLEMENTED]
- Invite users by email with automatic Keycloak account creation
- Temporary password workflow with mandatory password change on first login
- Role assignment and modification
- User enable/disable toggle
- User removal
- Per-user capability overrides (granular permissions beyond role defaults)

### 4g. Source Traceability [IMPLEMENTED]

Source traceability is not a feature -- it is a design principle that runs through the entire platform.

**Field-level provenance:** Every extracted field (invoice number, vendor name, date, amount, GSTIN, PAN, line item details) carries a provenance record that includes:
- Source (OCR, SLM, manual edit)
- Page number in the original document
- Bounding box coordinates (absolute and normalized)
- OCR block index reference
- Per-field confidence score

**Visual verification in the UI:** The Source Preview panel displays the original invoice with interactive field highlighting. Users click on field chips (e.g., "Invoice Number: INV-2024-001 -- page 1") to see the relevant region of the source document with a bounding box overlay. Crop images provide a zoomed-in view of the exact source region for each field.

**Line item provenance:** Individual line items carry both row-level and field-level provenance, tracing each description, amount, HSN/SAC code, and tax component back to the source document.

**Audit trail:** Every status change, workflow step, field edit, risk signal dismissal, compliance override, and export action is recorded in the invoice's processing issues log with timestamp and user identification.

---

## 5. Role Hierarchy [IMPLEMENTED]

BillForge's role system maps directly to how CA and accounting firms are structured. Each role carries a default set of capabilities that can be customized per user.

| Role | Firm Equivalent | Key Capabilities |
|------|----------------|-----------------|
| **Firm Partner** | Managing partner, senior partner | Full control: all invoices, all configurations, all users, all exports, compliance sign-off, workflow configuration, cost center management, vendor communications |
| **Tenant Admin** | Office manager, engagement lead | User management, connection management (email/bank), workflow configuration, GL code configuration, TCS configuration, compliance configuration, full invoice access |
| **Senior Accountant** | Audit manager, review head | Invoice review and approval, field editing, TDS and GL code overrides, compliance review, Tally export, CSV export, compliance report download |
| **CA (Chartered Accountant)** | Signing CA, audit partner | Compliance sign-off, TDS override, GL code override, approval with configurable limits, compliance report download, vendor communications |
| **Tax Specialist** | GST consultant, TDS specialist | TDS mapping configuration, TDS and GL code overrides, TCS configuration, compliance sign-off, export capabilities |
| **AP Clerk** | Data entry operator, accounts assistant | Invoice upload, ingestion trigger, field editing on own uploads, limited approval capability |
| **IT/Ops Admin** | Systems administrator | Connection management (email, bank accounts), user management, technical configuration |
| **Audit Clerk (Viewer)** | External auditor, statutory auditor's team | Read-only access to invoices, compliance data, risk signals, and export history. Cannot upload, edit, approve, delete, or export. Data scope can be configured to limit which invoices are visible. |

**Capability granularity:** Beyond role-based defaults, each user can have individual capabilities toggled:
- Approval limit (maximum invoice amount in Rs the user can approve)
- Upload and ingestion permissions
- Field editing permissions
- Delete and retry permissions
- TDS and GL code override permissions
- Compliance sign-off authority
- Configuration access (TDS mappings, GL codes, workflows, compliance settings, cost centers)
- Export permissions (Tally, CSV, compliance reports)
- Invoice visibility scope (own vs. all)
- Vendor communication permissions

---

## 6. India-Specific Compliance [IMPLEMENTED]

### GST: Automatic Tax Split

When BillForge extracts a GST-registered invoice, it identifies:
- **Supplier GSTIN** from the invoice
- **Tax components** at both the summary and line-item level

The system breaks down:
- **CGST + SGST** for intra-state supplies
- **IGST** for inter-state supplies
- **Cess** where applicable (luxury goods, tobacco, etc.)

Each component flows into the Tally export as a separate ledger entry with configurable ledger names (e.g., "CGST Input A/c", "SGST Input A/c", "IGST Input A/c", "GST Cess Input A/c").

**Example:** Your client receives a purchase invoice from a Mumbai-based vendor:
- Subtotal: Rs 1,00,000
- CGST @ 9%: Rs 9,000
- SGST @ 9%: Rs 9,000
- Total: Rs 1,18,000

BillForge extracts all four values, validates the arithmetic, and generates a Tally voucher with three ledger entries: party ledger (Rs 1,18,000 credit), purchase ledger (Rs 1,00,000 debit), CGST ledger (Rs 9,000 debit), and SGST ledger (Rs 9,000 debit).

### HSN/SAC Code Extraction

Line items are extracted with their HSN (for goods) or SAC (for services) codes, enabling downstream classification and rate verification. This supports both GSTR-1 filing and Input Tax Credit reconciliation.

### TDS: Section and Rate Auto-Detection

BillForge maintains a configurable TDS section mapping that resolves the applicable section based on:
1. **GL category** of the expense (e.g., "Professional Fees" maps to 194J)
2. **Vendor PAN type** (Company "C", Individual "P", HUF "H", Firm "F", etc.)

The resolution follows a priority-based cascade:
1. Tenant-specific mapping for the exact GL category + PAN category
2. Tenant-specific mapping for the GL category with wildcard PAN category
3. Global default mapping for the GL category + PAN category
4. Global default mapping with wildcard

**Rate determination** uses a maintained rate table with three rate tiers per section:
- Company rate (e.g., 194J: 10%)
- Individual rate (e.g., 194J: 10%)
- No-PAN penalty rate (20% under Section 206AA)

**Threshold awareness:** The system knows single-transaction and annual thresholds per section and flags when an invoice falls below the deduction threshold.

**Example:** An invoice from a vendor providing legal services (PAN: AABCL1234A, category "C" for Company):
- GL category: Legal & Professional Fees
- Mapped section: 194J
- Rate for company: 10%
- Subtotal: Rs 2,50,000
- TDS: Rs 25,000
- Net payable: Rs 2,25,000 (after adjusting against total invoice including GST)

### TCS: Tenant-Level Configuration

Tax Collected at Source is configured per client with:
- Rate in percentage (e.g., 0.1%)
- Effective date
- Enable/disable toggle
- Role-based access control for who can modify the TCS rate
- Complete change history with: previous rate, new rate, who changed it, when, reason, and effective date

TCS amounts are automatically computed on invoice totals and factored into bank reconciliation matching.

### PAN Validation with GSTIN Cross-Reference

BillForge performs multi-level PAN validation:
- **Level 1 (L1):** Format validation -- does the PAN match the ABCDE1234F pattern?
- **Level 2 (L2):** GSTIN cross-reference -- does the PAN match positions 3-12 of the vendor's GSTIN?
- **GSTIN derivation:** If no PAN is extracted but a valid GSTIN is present, BillForge derives the PAN from the GSTIN automatically

When PAN is missing entirely, the system triggers a critical TDS risk signal because Section 206AA requires deduction at 20% (the penalty rate). It also auto-generates a vendor communication draft requesting the PAN.

### GSTIN Validation

GSTIN format is validated against the standard 15-character pattern (2-digit state code + 10-character PAN + entity code + Z + check digit). Invalid GSTIN triggers a compliance risk signal and an auto-generated vendor communication requesting correction, because an invalid GSTIN jeopardises Input Tax Credit eligibility.

### Vendor Master with Compliance Status

BillForge maintains a per-tenant vendor master that is automatically built and enriched with each invoice:
- Vendor name and aliases
- PAN and PAN category
- GSTIN
- Bank account history (hashed for security, with change detection)
- Email domains
- Default GL code (learned from usage patterns)
- Default cost center (learned from usage patterns)
- MSME classification and Udyam number
- Invoice count and last invoice date

The vendor master enables progressive learning: the more invoices processed for a vendor, the more accurate GL code suggestions, TDS section detection, and compliance checks become.

### Risk Signal Dashboard

Every compliance check produces a risk signal with:
- **Code:** Machine-readable identifier (e.g., PAN_GSTIN_MISMATCH, VENDOR_BANK_CHANGED)
- **Category:** Financial, Compliance, Fraud, or Data Quality
- **Severity:** Critical, Warning, or Info
- **Message:** Human-readable explanation
- **Confidence penalty:** How much this signal reduces the invoice confidence score

Risk signals can be:
- **Dismissed** by authorized users (with user identification logged)
- **Acted on** through workflow actions
- **Suppressed** at the tenant configuration level (e.g., a client may choose to disable MSME tracking)
- **Severity-overridden** per tenant (e.g., escalate a warning to critical for a specific client)

**Risk signals currently detected:**

| Signal | Category | Severity | Trigger |
|--------|----------|----------|---------|
| TOTAL_AMOUNT_ABOVE_EXPECTED | Financial | Warning | Invoice exceeds configured maximum |
| TOTAL_AMOUNT_BELOW_MINIMUM | Financial | Info | Unusually low amount |
| DUE_DATE_TOO_FAR | Data Quality | Warning | Due date exceeds expected range |
| MISSING_MANDATORY_FIELDS | Data Quality | Warning | Vendor name or amount missing |
| PAN_FORMAT_INVALID | Compliance | Warning | PAN does not match expected format |
| PAN_GSTIN_MISMATCH | Compliance | Warning | PAN does not match GSTIN |
| TDS_SECTION_AMBIGUOUS | Compliance | Warning | Multiple sections could apply |
| TDS_NO_PAN_PENALTY_RATE | Compliance | Critical | Missing or invalid PAN triggers 20% rate |
| TDS_BELOW_THRESHOLD | Compliance | Info | Amount below deduction threshold |
| IRN_MISSING | Compliance | Warning | High-value invoice lacks e-invoice IRN |
| IRN_FORMAT_INVALID | Compliance | Warning | IRN does not match expected format |
| MSME_PAYMENT_DUE_SOON | Compliance | Warning | MSME invoice approaching 45-day deadline |
| MSME_PAYMENT_OVERDUE | Compliance | Critical | MSME invoice past 45-day deadline |
| VENDOR_BANK_CHANGED | Fraud | Critical | Vendor bank details differ from history |
| SENDER_FREEMAIL | Fraud | Warning | Invoice from freemail but vendor uses corporate email |
| SENDER_DOMAIN_MISMATCH | Fraud | Warning | Sender domain does not match vendor |
| SENDER_FIRST_TIME | Fraud | Info | First invoice from this email domain |
| DUPLICATE_INVOICE_NUMBER | Fraud | Critical | Same vendor + invoice number seen before |
| BANK_PAYMENT_VERIFIED | Financial | Info | Payment matched to bank statement |

### Automated Vendor Communication [IMPLEMENTED]

When compliance issues are detected, BillForge generates email drafts for vendor communication:
- **PAN missing:** Request PAN for TDS compliance
- **IRN missing:** Request e-invoice reissuance with IRN and QR code
- **Bank account changed:** Request bank detail verification
- **GSTIN invalid:** Request corrected invoice for ITC eligibility

Each template is populated with invoice-specific details (vendor name, invoice number, date, tenant name) and can be reviewed before sending.

---

## 7. Tally Integration [IMPLEMENTED]

### How It Works

1. **Approve invoices** through the BillForge review workflow
2. **Select invoices** for export (individually or in bulk)
3. **Preview the mapping** -- see exactly what values will be sent to Tally for each field
4. **Generate the XML file** -- BillForge produces a Tally-compatible XML import file
5. **Import into Tally** -- open Tally ERP 9 or TallyPrime, use the import function to load the XML

### What the XML Contains

Each invoice becomes a Purchase voucher with:

```
Company Name        --> From tenant configuration
Voucher Type        --> Purchase
Voucher Number      --> Extracted invoice number
Date                --> Extracted invoice date
Party Ledger        --> Extracted vendor name
Purchase Ledger     --> Mapped from GL code or default "Purchase Account"
GSTIN               --> Extracted supplier GSTIN
Narration           --> Source reference + attachment name + BillForge ID
```

**Ledger entries generated per voucher:**

| Entry | Ledger | Debit/Credit | Amount |
|-------|--------|-------------|--------|
| Party | Vendor Name | Credit | Total invoice amount |
| Purchase | GL Code Name or Purchase Account | Debit | Subtotal (net of GST) |
| CGST | CGST Input A/c (configurable) | Debit | CGST amount |
| SGST | SGST Input A/c (configurable) | Debit | SGST amount |
| IGST | IGST Input A/c (configurable) | Debit | IGST amount |
| Cess | GST Cess Input A/c (configurable) | Debit | Cess amount |
| TDS | TDS Payable - [Section] | Credit | TDS amount |

**When TDS applies:** The party ledger entry is adjusted to the net payable amount (total minus TDS), and a TDS Payable entry is added.

### Configuration

Per tenant, you configure:
- **Company name** (must match the Tally company name)
- **Default purchase ledger** (used when no GL code is assigned)
- **GST ledger names** (CGST, SGST, IGST, Cess ledger names)
- **TDS ledger prefix** (e.g., "TDS Payable" -- section is appended automatically)

### Export History

Every export is tracked with:
- Batch ID and timestamp
- Total invoices selected, successfully exported, and skipped/failed
- Reason for any skipped invoices (missing vendor name, missing invoice number, invalid amount)
- Who initiated the export
- Downloadable XML file (retained for re-download)

---

## 8. Security and Data [IMPLEMENTED]

**Multi-Tenant Isolation.** Every client's data is stored in a separate logical partition. Invoices, vendor records, compliance data, GL codes, workflows, and exports for one client are completely invisible to users of another client. Platform admins can see aggregate analytics but do not access individual invoice data through the tenant interface.

**Keycloak SSO.** Authentication is handled through Keycloak, an enterprise-grade identity provider. Users authenticate via OpenID Connect. Password policies, brute-force protection, and session management are enforced at the identity layer.

**Role-Based Access Control.** Every API endpoint enforces role and capability checks. Write operations (upload, edit, approve, export, delete) are blocked for viewer roles. Sensitive operations (TDS override, compliance sign-off, user management) require specific capabilities that are only granted to appropriate roles.

**Audit Trail.** Every action on an invoice is logged: status changes, field edits, workflow approvals and rejections, risk signal dismissals, compliance overrides, and export events. Each log entry includes the user's identity, timestamp, and context. This audit trail is immutable and available for review by firm partners and auditors.

**Secure Storage.** Documents are stored in S3-compatible object storage (AWS S3 or MinIO) with tenant-scoped access. Bank account numbers are never stored in plain text -- only cryptographic hashes are retained for change detection.

**Temporary Password Enforcement.** New users invited to the platform receive a temporary password and are required to change it on first login via Keycloak's mandatory action flow.

---

## 9. Why BillForge for Your Firm

**Handle 10x more clients without hiring.** When invoice data entry, GST splitting, TDS detection, and Tally export are automated, your team's capacity multiplies. An AP clerk who manually processes 50 invoices per day can review and approve 500 AI-extracted invoices in the same time. A senior accountant who spends half their day on data verification can focus on advisory work and client relationships.

**Eliminate GST mismatch notices.** BillForge extracts and validates GSTIN, splits CGST/SGST/IGST based on the actual values on the invoice, and preserves HSN/SAC codes at the line-item level. The Tally export carries this structure through to the books. When GSTR-2B reconciliation happens, your client's purchase register matches.

**Never miss a TDS deadline or threshold.** Automatic section detection and rate calculation mean TDS is computed correctly on every invoice. The system flags when no PAN is available (triggering the 20% penalty rate), when the amount is below the deduction threshold, and when the section is ambiguous. Your tax specialist can review edge cases rather than calculating every invoice.

**Catch fraud before it costs your client.** Vendor bank account change detection, duplicate invoice flagging, email sender verification, and IRN validation run automatically. A critical risk signal on a vendor bank change is worth far more than the cost of the entire platform.

**Give your team the right access -- not more, not less.** Your AP clerks upload and manage data. Your senior accountants review and approve. Your tax specialist handles TDS overrides. Your external auditors see exactly what they need in read-only mode. No one has access beyond their role.

**Every number traced back to the source document.** When a client questions a number, when an auditor asks where a figure came from, when a GST notice requires supporting evidence -- click on any field and see exactly where it was extracted from the original invoice. Bounding box on the PDF. OCR block reference. Confidence score. No ambiguity.

**Works with your existing Tally setup.** BillForge does not replace Tally. It feeds Tally. The generated XML files import directly into your existing Tally company with your existing ledger structure. You configure the ledger names once, and every export maps correctly.

---

## 10. Pricing Model

BillForge is designed with a pricing structure that aligns cost with value for Indian CA and accounting firms.

### Suggested Model: Per-Tenant + Per-Invoice

| Component | Structure | Indicative Range |
|-----------|-----------|------------------|
| **Platform fee** | Monthly, per firm | Rs 2,000 -- Rs 10,000/month depending on plan tier |
| **Per-tenant fee** | Monthly, per client workspace | Rs 500 -- Rs 2,000/month per active tenant |
| **Per-invoice fee** | Per invoice processed | Rs 3 -- Rs 8 per invoice (extraction + compliance) |
| **Tally export** | Per export batch | Included in per-invoice fee |
| **Bank reconciliation** | Per statement uploaded | Rs 100 -- Rs 500 per statement |

### Plan Tiers (Illustrative)

| Plan | Tenants Included | Invoices/Month | Users | Monthly Price |
|------|-----------------|---------------|-------|--------------|
| **Starter** | Up to 5 clients | 500 | 3 | Rs 5,000 |
| **Professional** | Up to 20 clients | 2,500 | 10 | Rs 15,000 |
| **Enterprise** | Unlimited clients | 10,000+ | Unlimited | Custom pricing |

### Value Proposition

Consider a firm with 15 clients processing an average of 150 invoices per client per quarter (2,250 invoices/quarter):

- **Current cost:** 2 full-time data entry staff at Rs 20,000/month each = Rs 1,20,000/quarter
- **BillForge cost:** Professional plan at Rs 15,000/month = Rs 45,000/quarter
- **Savings:** Rs 75,000/quarter, plus the freed staff capacity can be redeployed to advisory work

The pricing is subject to adjustment based on market feedback and will be finalised before general availability.

---

*BillForge is built for the Indian accounting profession. Not adapted from a Western tool. Not a generic OCR wrapper. A purpose-built platform that understands GST, TDS, TCS, PAN, GSTIN, HSN, SAC, MSME compliance, and Tally -- because that is what your practice runs on every day.*
