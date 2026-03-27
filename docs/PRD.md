# Product Requirements Document: BillForge

> Last updated: 2026-03-27

---

## 1. Overview

### The Problem

**Source: constructed scenario, not collected from customer interviews.** This must be validated through Gate G2. The story below is our best hypothesis of what the workflow looks like, based on the first adopter's operational model. It has not been verified through timed observation or direct interviews with AP clerks.

An AP clerk at an Indian accounting services firm opens a PDF invoice from a client. She needs the vendor name, invoice number, total amount, and GST breakdown to enter into Tally. She scrolls to find the vendor header. Scrolls again for the invoice number. Flips to page two for the total. Cross-references the CGST and SGST lines. Types everything into Tally. Then opens the next PDF and does it again — 150 times a day.

The bottleneck is not the judgment call ("should I approve this?"). The bottleneck is the hunt ("where is the vendor name on this invoice?"). Every new invoice format from every new vendor restarts the search from scratch.

### Market Category

**Not yet defined.** BillForge needs to declare what category it competes in before external positioning. The options:

- **Invoice data entry software** — positions against manual processes and spreadsheets
- **AP automation tool** — positions against Tipalti, Stampli, Bill.com
- **India-first accounting assistant** — positions against the status quo (junior accountant + Tally)

The category choice changes how every benefit lands with buyers. Gate G2 (first adopter trigger) and G3 (competitive analysis) must inform this decision. Until then, we do not externally position BillForge in any category.

### Why BillForge Wins

**You never have to hunt through a PDF again.** For every extracted field, BillForge shows you the value alongside the exact region of the document where it was found. You glance, you confirm, you move on. The document's evidence comes to you — you don't go looking for it.

**You corrected it once; you'll never correct it again.** Every correction you make teaches the system. The next invoice from that vendor extracts correctly without your intervention. The system gets better because you used it.

**Your approved invoices export straight into Tally** with correct GST breakdown — CGST, SGST, IGST, Cess — ready to import. No manual re-entry, no mapping errors.

### Target Segment

Indian accounting services firms handling 100+ invoices per client per month, using Tally for accounting, processing invoices from multiple vendors in varying formats. This is specific and deliberate — not "Indian SMBs" broadly.

### What We Don't Yet Know

Three things must be validated before these claims become external positioning:

1. **The verification time.** We believe review drops from minutes to under 45 seconds per invoice. This is a hypothesis based on the interaction pattern. It must be confirmed by timing real AP clerks on real invoices — both their current process (baseline) and their BillForge process. Until then, it is an internal design target.

2. **The competitive landscape.** We believe Tally-native export with GST itemization is a gap in the market. This must be confirmed by naming specific competitors and documenting their specific shortfalls — ideally from the first adopter's own evaluation process.

3. **The learning loop timeline.** We believe correction rates for returning vendors decrease within 30 days. This must be confirmed with production telemetry from the first tenant.

---

## 2. Target Users

### First Adopter

An Indian accounting services firm. Each staff member handles invoices for a specific client. Invoices arrive at a client-specific Gmail inbox. The tenant admin assigns each inbox to the responsible team member. The workflow is flat: one person, one client, one inbox.

### What They Fired (To Be Documented)

**This section is intentionally incomplete.** Understanding what the first adopter was doing before BillForge — and what finally pushed them to change — is the most important input for positioning and go-to-market. The real competitive set is almost certainly not other invoice software; it's likely a manual process, a junior accountant, an Excel sheet, or just tolerating errors.

At least 5-8 interviews are required before this section can be filled — two data points are an anecdote, not a pattern:

1. **3-5 AP clerks:** What was frustrating in the moment? What did a bad day look like? What workarounds had they built? Time their actual current process — don't ask them to estimate.
2. **2-3 decision-makers:** When did they first think about this problem? How long did they tolerate it? What made them stop tolerating it on that specific day? What did they evaluate? What was their definition of "working" before BillForge? The timeline from first thought to active search reveals whether the market is passively aware or actively buying.

These interviews are **Gate G2** — they block all external positioning work. G2 should be an ongoing activity, not a one-time checkbox.

### Operational Model

| Who | What They Do Daily | Role | Key Constraint |
|-----|-------------------|------|----------------|
| **AP Clerk** | Sees assigned invoices already extracted. For each: glances at value + source evidence, corrects if wrong, approves. 100-200 invoices/day. | MEMBER | Approves up to a configured value limit. Above that, escalates to admin. |
| **Firm Admin** | Connects Gmail inboxes, assigns to team, configures approval rules, reviews escalated invoices, exports approved batches to Tally. | TENANT_ADMIN | Manages the operational configuration. |
| **Platform Operator** | Onboards firms, monitors health. Never sees invoice content. | PLATFORM_ADMIN | Sees metadata only — never invoice-level data. |
| **Auditor** | Read-only access to a configurable scope of invoices. | VIEWER | Cannot modify, approve, or export. |

### Role Extensibility

The flat model is deliberate for this adopter. The approval workflow engine supports multi-step, role-based, amount-conditional chains — built but gated behind configuration. This is an explicit bet on a second adopter type (firm with AP hierarchy) that has not yet been validated. See Gate G6.

---

## 3. Core Features

### 3.1 Source-Verified Review

**The underlying need:** "I'm afraid of approving an incorrect invoice and being held responsible for it." Source evidence is our solution to that need — it builds trust by showing proof. Other solutions to the same need (e.g., confidence-based auto-escalation, peer review) may emerge from customer interviews.

**The solution:** Every extracted field is paired with a cropped image of the exact document region where the value was found, plus a bounding box overlay on the full page. The reviewer doesn't search; the evidence is brought to them.

**What the reviewer does:**
- Scans extracted fields. Green confidence = likely correct. Red = needs checking.
- For any field, glances at the source evidence next to the value. Matches? Move on. Wrong? Click, correct, Enter.
- Every correction feeds the learning store for future invoices from that vendor.
- Clicks Approve. **Approval is always a deliberate human action.** The system pre-selects high-confidence invoices for batch approval but never auto-approves. The human decides; the system assists.

**Why switching away is costly:** Every correction a reviewer makes accumulates as vendor-specific learning data. A new entrant can replicate the source-evidence UI, but they can't replicate six months of learned corrections for 200 vendors. The moat is the accumulated data, not the technical architecture.

### 3.2 Extraction Learning

**The need:** "I've corrected this vendor's name three times already. Why do I have to do it again?"

**The solution:** Every correction is recorded per vendor and per invoice type. On future extractions, corrections are passed to the SLM as hints. Vendor-specific corrections override type-level corrections.

**Current mode: Assistive** (`LEARNING_MODE=assistive`). Corrections are fetched and stored in metadata but not passed to the SLM. The UI shows "N learned patterns available" so the reviewer sees the system is learning. This builds trust before the system operates autonomously.

**Decision trigger for active mode:** Correction rate for returning vendors declines by ≥20% over 30 days AND false correction rate (stale hints that made extraction worse) is below 5%. These are starting hypotheses — adjust based on production data, but having a threshold before go-live means you're instrumenting with intent.

**Constraints:** 6 corrections per grouping key (bounds SLM token cost), 90-day TTL (auto-prunes stale corrections). Both are engineering starting points, not validated thresholds. Instrument from day one: track correction rate per vendor before and after hints are applied.

### 3.3 Multi-Source Ingestion

Invoices arrive from whatever channel the client uses and appear in the dashboard ready for review.

| Source | Status | Description |
|--------|--------|-------------|
| Gmail (OAuth2) | Production | Per-tenant inbox. Polling at 1/2/4/8h. MessageId dedup. |
| S3 Upload | Production | Manual upload. Max 50 files, 20MB each. PDF/JPG/PNG. |
| Folder | Development | Local testing only. |

Every source implements `IngestionSource`. Adding Outlook or a custom IMAP source is an adapter implementation — the pipeline, checkpointing, and dedup are shared.

### 3.4 Staged Extraction Pipeline

High accuracy without high cost — expensive ML stages only trigger when cheaper ones aren't confident enough.

| Stage | What Happens | Cost |
|-------|-------------|------|
| Vendor Fingerprint | Match known vendor layout patterns | Free |
| OCR | Text + bounding boxes from all pages | Low |
| SLM Field Extraction | Structured fields from OCR blocks + page images + learned corrections | Medium |
| Deterministic Validation | Date/amount/currency consistency checks | Free |
| LLM Vision Re-extraction | Page image analysis when confidence < 85% | High |

The SLM classifies each invoice into one of 10 types (`gst-tax-invoice`, `receipt`, `credit-note`, etc.) during extraction — no extra ML call. Classification is displayed in the review UI and keys the learning store.

### 3.5 Confidence Scoring

| Band | Score | Reviewer Experience |
|------|-------|-------------------|
| Green | 91-100 | Pre-selected for batch approval. Quick glance, approve. |
| Yellow | 80-90 | Worth checking. Open detail panel, verify flagged fields. |
| Red | 0-79 | Needs review. Source evidence becomes critical. |

**Green does not mean auto-approved.** This is a hard constraint. If a CA ever asks "who approved this?", the answer must be a person, not a confidence score.

### 3.6 Approval Workflows

MEMBERs approve up to a configured value limit. Above that, invoices escalate to TENANT_ADMIN. This matches how the first adopter actually works.

Advanced mode (multi-step builder, role/amount conditions) is built but unvalidated — it's a bet on a second adopter type. See Gate G6.

### 3.7 Tally XML Export

Approved invoices export as Tally purchase voucher XML with full GST breakdown (CGST/SGST/IGST/Cess, configurable ledger names). Download as file or POST directly. Export batches tracked with audit trail.

**Open risk (Gate G4):** Header-level GST may not satisfy ITC reconciliation requirements during a GST audit. This must be validated with the first adopter's CA before the product goes live. If line-item detail is required, this moves from out-of-scope to blocker.

Tally is the first implementation of `AccountingExporter`. Adding QuickBooks or Zoho Books is an adapter — the batch tracking, approval checks, and download infrastructure are shared.

### 3.8 Multi-Tenant Data Isolation

Every collection partitioned by `tenantId`. Platform admin sees aggregate metrics only — never invoice content. VIEWER role has configurable scope via `ViewerScope`. Tenant modes: `test` (manual ingest) and `live` (auto-ingest). No mode transition API exists yet.

### 3.9 Integrations

All behind interface boundaries. Swapping or adding a provider is configuration, not code.

| Integration | Status | Boundary |
|-------------|--------|----------|
| Gmail (OAuth2) | Live | `IngestionSource` |
| Tally XML | Live | `AccountingExporter` |
| SendGrid / SMTP | Live | `InviteEmailSender` |
| Anumati (Account Aggregator) | Built, not validated | `IBankConnectionService` |
| S3 / MinIO | Live | `FileStore` |

**Anumati: explicit bet.** Infrastructure built for bank connection via India's Account Aggregator framework. Payment reconciliation is not in scope for the first adopter. This is a bet on the India-first strategy — the trigger for validating it is a specific customer request for payment-to-invoice matching. Until then, it carries maintenance cost with no validated return. If no customer requests this within 6 months of launch, descope it.

---

## 4. User Flows

### 4.1 The Reviewer's Day

**Priya** is an AP clerk. She handles invoices for 3 clients. Each client's invoices land in a dedicated Gmail inbox assigned to her.

**Before BillForge (to be validated through G2 interviews):** Priya opened each email, downloaded the PDF, scrolled through it to find the vendor name, invoice number, date, and total. She typed each value into Tally manually. For GST invoices, she cross-referenced CGST and SGST amounts. Each invoice took 3-5 minutes. By the end of 150 invoices, she was exhausted and error-prone.

**With BillForge:**

1. **Morning.** Dashboard shows 47 invoices ingested overnight. 38 green, 6 yellow, 3 red.
2. **Green batch.** Select All Green → scan vendor names and amounts → "Approve 38 invoices" → confirm. 30 seconds.
3. **Yellow invoice.** Detail panel opens. Next to "Total: ₹1,18,000" she sees a cropped image of the handwritten amount. Matches. Approve.
4. **Red invoice.** Confidence 62%. Vendor name wrong — source evidence shows "M/s Sharma & Associates", extracted value says "Sharma Associate." Click, correct, Enter. Check remaining fields with their source evidence. Approve.
5. **Her corrections teach the system.** Next month, Sharma invoices extract correctly.
6. **End of day.** Admin exports all approved invoices to Tally XML with GST breakdown. Invoices marked EXPORTED and locked.

### 4.2 Tenant Onboarding (Minimum Path to First Value)

1. Platform admin creates tenant → admin gets temporary password → forced to change on login
2. Connect one Gmail inbox (OAuth popup) → assign to self → click Ingest
3. Review extracted invoices → approve → export to Tally
4. **Time to first export target: under 30 minutes.** Additional config (team invites, workflow rules, more inboxes) is optional — not required for first value.

---

## 5. Requirements

### Differentiators

| ID | Requirement | Why |
|----|-------------|-----|
| D-1 | Source evidence (crop + overlay) alongside every extracted field | Eliminates the search — the core interaction |
| D-2 | Extraction learning per tenant/vendor/type with visible indicators | Accuracy compounds; switching cost works in customer's favor |
| D-3 | Tally XML with India GST itemization (CGST/SGST/IGST/Cess) | Market wedge — pending competitive validation (G3) |
| D-4 | Interface-driven architecture for all integrations | Adapter extensibility — new connectors without rewrites |

### Table Stakes

| ID | Requirement |
|----|-------------|
| TS-1 | OCR from PDF and image invoices |
| TS-2 | Confidence scoring with visual bands |
| TS-3 | Batch approval with confirmation |
| TS-4 | RBAC (4 roles) |
| TS-5 | Multi-tenant data isolation |
| TS-6 | Crash-safe ingestion with dedup |
| TS-7 | Audit trail (who approved what, when) |

---

## 6. Success Metrics

### Primary Signal

**Invoices successfully exported per tenant per month**, tracked by onboarding cohort at 30/60/90 days. Pair with correction rate per tenant — a tenant exporting high volume with flat correction rate means the learning moat isn't working.

**Individual reviewer activity** is also trackable (one-person-one-client model). A tenant can be "active" while one clerk has quietly stopped using BillForge and gone back to manual entry. Track per-reviewer export and approval activity from day one.

**Returned on day 2** is the habit formation signal. The transition from first use to habit is where most products fail. Track the cohort split: tenants who hit first export under 30 minutes vs those who took longer, and watch their 60/90-day volume. Also track absolute number of tenants reaching first export — not just median time for those who do.

### Leading Indicators

| Metric | Target | Validation Status |
|--------|--------|-------------------|
| Verification time (median) | < 45 seconds | Hypothesis — Gate G1 |
| Verification time (P90) | < 3 minutes | Hypothesis — must include red-confidence invoices |
| Correction rate for returning vendors | Declining month-over-month | Gate G5 |
| "Other" classification rate | < 15% | Needs production telemetry |
| Time to first Tally export (new tenant) | < 30 minutes | Pair with "returned on day 2" |
| Correction rate on first 50 invoices | Establish baseline | Calibrates learning timeline claims |

---

## 7. Pre-Launch Validation Gates

Hard dependencies. Each blocks specific external activities.

| Gate | Action | Owner | Blocks |
|------|--------|-------|--------|
| **G1** | Time 3+ AP clerks: baseline process vs BillForge. Record median and P90. | Product | Any "seconds not minutes" claim |
| **G2** | Interview first adopter's decision-maker: what they fired, why now, what they evaluated. Interview AP clerks: what was frustrating, what workarounds existed. | Product | All positioning and go-to-market |
| **G3** | Name 3-5 competitors. Document Tally support, GST capability, source-verified review. Source from first adopter's evaluation if possible. | Product | "India-first wedge" claim |
| **G4** | Call with first adopter's CA. Do NOT ask a hypothetical ("would you need line items?"). Instead: walk them through a real exported Tally file and ask them to simulate an ITC reconciliation. Ask: "Tell me about the last time you did an ITC reconciliation during an audit — what documents did you need?" Stories reveal behavior; hypotheticals reveal opinions. | Product + CA | Tally export value prop; may escalate line-item to blocker |
| **G5** | After 30 days production: measure correction rate for returning vendors (should decline) and false correction rate (stale hints making things worse). | Engineering | "Compounding accuracy" claim; active-mode decision |
| **G6** | Name a specific second adopter with documented AP hierarchy needs. If none: acknowledge workflow builder as a bet and stop investing. | Product | Workflow builder roadmap |

---

## 8. Open Questions

| Question | Owner | Status |
|----------|-------|--------|
| 6-correction cap sufficient? | Engineering | Instrument from day one; let data decide |
| 90-day TTL matches vendor format change frequency? | Product | Need stories from AP clerks about real format changes |
| Concurrent edit protection needed? | Product | Low risk with single-reviewer-per-client model |
| Anumati bank connection in scope? | Product | Explicit bet with 6-month trigger. Descope if no customer requests payment-to-invoice matching by then. |
| Tenant mode transition API (test → live)? | Engineering | Must exist before second adopter |

---

## 9. Out of Scope

| Item | Risk Level | Watch For |
|------|-----------|-----------|
| Line-item extraction | **HIGH** — May be required for ITC reconciliation. Gate G4 may escalate this to blocker. **Contingency plan:** If G4 escalates, minimum viable path is SLM-based line-item extraction from OCR blocks (extend the existing FieldVerifier response to include line items). Estimated effort: 2-3 weeks. Must be scoped before G4 call so the team isn't scrambling. | CA feedback, GST audit requirements |
| Payment reconciliation | Medium — Anumati infrastructure built but unvalidated | Whether bank data drives export decisions |
| Multi-currency | Low — adopter one is INR-only | International expansion |
| Webhooks | Low — no validated downstream automation use case | ERP workflow triggers |
| Collaborative editing | Low — single-reviewer-per-client model | Multiple reviewers on same invoices |

---

## 10. APIs & Dependencies

### Backend Routes

| Group | Prefix | Endpoints |
|-------|--------|-----------|
| Auth | `/api/auth` | Login, callback, password change |
| Invoices | `/api/invoices` | CRUD, approve, delete, retry, preview, crops, overlays |
| Jobs | `/api/jobs` | Ingest, upload, pause, SSE progress |
| Export | `/api/exports` | Tally export + download, history |
| Workflow | `/api/admin/approval-workflow` | Config CRUD, step approve/reject |
| Gmail | `/api/connect/gmail` | OAuth flow, status, polling |
| Admin | `/api/admin` | Users, invites, roles, mailboxes, viewer scope |
| Platform | `/api/platform` | Tenant onboarding, usage |
| Health | `/health` | Liveness + readiness |

### Dependencies (all behind interfaces)

| Dependency | Boundary |
|------------|----------|
| MongoDB 7 / DocumentDB | Direct (Mongoose) |
| Keycloak 26.0 | `OidcProvider` |
| S3 / MinIO | `FileStore` |
| invoice-ocr (FastAPI) | `OcrProvider` |
| invoice-slm (FastAPI) | `FieldVerifier` |
| Gmail API | `IngestionSource` |
| Tally | `AccountingExporter` |
| SendGrid / SMTP | `InviteEmailSender` |

---

## 11. Go-to-Market Readiness

| Persona | Key Concern | Status |
|---------|------------|--------|
| **Product Manager** | Value prop validated (G1), trigger documented (G2), competitors named (G3), second adopter exists (G6) | BLOCKED on G1, G2, G3 |
| **Account Auditor (CA)** | GST export meets ITC requirements (G4), audit trail complete, exports immutable, human always approves | BLOCKED on G4; others DONE |
| **Technical Architect** | Interface boundaries (8 total), learning loop instrumented, same image all envs, ML swap non-disruptive | DONE |
| **Software Engineer** | CI green, types match contracts, learning wired E2E, invoice type stored + displayed, coverage thresholds met | DONE |
