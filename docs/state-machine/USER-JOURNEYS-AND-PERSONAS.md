# User Journeys, Personas, and Role Model Overhaul

> Last updated: 2026-04-14
>
> This document maps every user path through BillForge by persona,
> identifies gaps in the current 4-role model for Indian accounting firms,
> and proposes a persona-aware role model + approval workflow overhaul.
>
> **Status (2026-04-14):** Runtime RBAC uses four base roles (PLATFORM_ADMIN, TENANT_ADMIN,
> MEMBER, VIEWER) with persona-based capability defaults (ap_clerk, senior_accountant, ca,
> tax_specialist, firm_partner, ops_admin, audit_clerk). Authentication is exclusively
> Keycloak OIDC -- users authenticate via the Keycloak login page, receive OIDC tokens,
> and the backend validates tokens via introspection using `OIDC_CLIENT_ID` and
> `OIDC_CLIENT_SECRET`. MongoDB user records are auto-created on first Keycloak login
> when `AUTH_AUTO_PROVISION_USERS=true`.
>
> **Tab visibility by role:**
> - PLATFORM_ADMIN: Platform Dashboard (tenant list, usage, onboarding). No tenant-level access.
> - TENANT_ADMIN / firm_partner: Overview, Invoices, Exports, Config, Connections tabs.
> - MEMBER roles (ap_clerk, senior_accountant, ca, tax_specialist): Overview, Invoices, Exports tabs. Config and Connections are hidden.
> - VIEWER / audit_clerk: Overview, Invoices (read-only), Exports (history only, no actions).

---

## 1. Current Role Model (4 Roles)

| Role | What They Do | What They Can't Do |
|------|-------------|-------------------|
| PLATFORM_ADMIN | Onboard tenants, monitor health, enable/disable tenants | See any invoice content, configure any tenant |
| TENANT_ADMIN | Manage users, configure workflows, connect Gmail, manage GL codes, approve/export invoices | Onboard tenants, see other tenants |
| MEMBER | Review invoices, approve (within workflow), export, upload files | Configure workflows, manage users, manage GL codes |
| VIEWER | Read-only access to scoped invoices | Approve, edit, export, upload, configure anything |

### Problem

This model was designed for "AP clerk reviews invoices, admin manages the team." With compliance features (TDS, PAN, GL codes, risk signals), the personas split further:

**Who actually works in an Indian accounting services firm?**

| Real Person | Current Role Mapping | What's Missing |
|-------------|---------------------|----------------|
| **AP Clerk** (data entry, 150 invoices/day) | MEMBER | Works, but can approve invoices they shouldn't — no value-based limits |
| **Senior Accountant** (reviews TDS sections, validates GL codes) | MEMBER | Same permissions as AP clerk — can't differentiate review authority |
| **Chartered Accountant (CA)** (signs off on compliance, TDS returns) | VIEWER or TENANT_ADMIN | VIEWER can't approve; TENANT_ADMIN can configure things a CA shouldn't |
| **Firm Partner** (oversees operations, sees all data, occasional overrides) | TENANT_ADMIN | Too much power — a partner shouldn't be managing Gmail mailboxes |
| **Tax Specialist** (handles TDS/GST compliance, reviews risk signals) | No good fit | Needs write access to TDS/GL fields but not general invoice approval |
| **Audit Clerk** (prepares reports, read-only access) | VIEWER | Works, but scope is too rigid (ViewerScope uses userId lists) |

---

## 2. Complete User Journey Maps (Current State)

### 2.1 Platform Admin Journey

```
Keycloak OIDC Login → Platform Dashboard
  ├── View tenant list (usage, document counts, connection status)
  ├── Onboard new tenant (POST /platform/tenants/onboard-admin)
  │     └── Creates tenant + admin user → KC user with temp password
  ├── Enable/disable tenant (PATCH /platform/tenants/:id/enabled)
  └── [END — no access to tenant data]
```

**Touchpoints:** 3 API endpoints, 1 view. No invoice-level access ever.

### 2.2 Tenant Admin Journey

```
Keycloak OIDC Login → Dashboard (Overview tab default)
  │
  ├── OVERVIEW TAB
  │     ├── KPI cards (total, approved, pending, exported, needs review)
  │     ├── Time-series charts (daily approvals, ingestion, exports)
  │     ├── Vendor analytics (top by approved/pending)
  │     └── Status distribution donut
  │
  ├── INVOICES TAB
  │     ├── Invoice list (filter, sort, paginate)
  │     ├── Select invoices → Batch approve / Delete / Retry
  │     ├── Click invoice → Detail panel
  │     │     ├── View extracted fields + source evidence
  │     │     ├── Edit fields (vendor, invoice#, date, amount, currency)
  │     │     ├── [NEW] View compliance panel (TDS, GL, PAN, risk signals)
  │     │     ├── [NEW] Override GL code / TDS section
  │     │     └── Approve / Reject (if workflow)
  │     ├── Upload files → S3 → Ingest
  │     ├── Start/Pause ingestion (SSE progress)
  │     └── Workflow approve/reject (if AWAITING_APPROVAL)
  │
  ├── EXPORTS TAB
  │     ├── Select approved invoices → Export to Tally
  │     ├── Download export file
  │     └── View export history
  │
  ├── CONFIG TAB (admin only)
  │     ├── Gmail connection (OAuth flow)
  │     ├── Approval workflow configuration (simple/advanced)
  │     ├── User management (invite, assign roles, enable/disable, remove)
  │     ├── Viewer scope management
  │     ├── [NEW] GL code management (CRUD + CSV import)
  │     └── [NEW] Compliance configuration (enable/disable, signal config)
  │
  └── CONNECTIONS TAB (admin only)
        ├── Gmail mailbox list + assignment
        └── Bank accounts (Anumati)
```

**Touchpoints:** ~35 API endpoints, 5 tabs. Does everything.

### 2.3 Member Journey

```
Keycloak OIDC Login → Dashboard (Overview tab default)
  │
  ├── OVERVIEW TAB (same as admin but scope = "mine")
  │
  ├── INVOICES TAB
  │     ├── Invoice list (filter, sort, paginate)
  │     ├── Select invoices → Batch approve / Delete / Retry
  │     ├── Click invoice → Detail panel
  │     │     ├── View extracted fields + source evidence
  │     │     ├── Edit fields
  │     │     ├── [NEW] View compliance panel
  │     │     ├── [NEW] Override GL code / TDS section
  │     │     └── Approve (if allowed by workflow)
  │     ├── Upload files
  │     └── Start ingestion
  │
  └── EXPORTS TAB
        ├── Export to Tally
        └── View export history
```

**Touchpoints:** ~20 API endpoints, 3 tabs. Same as admin minus config/connections.

### 2.4 Viewer Journey

```
Keycloak OIDC Login → Dashboard (Overview tab, scope = scoped)
  │
  ├── OVERVIEW TAB (scoped analytics)
  │
  ├── INVOICES TAB (read-only)
  │     ├── Invoice list (filtered to ViewerScope.visibleUserIds)
  │     ├── Click invoice → Detail panel (read-only)
  │     │     ├── View extracted fields + source evidence
  │     │     ├── [NEW] View compliance panel (read-only)
  │     │     └── No edit, no approve, no delete
  │     └── No upload, no ingestion
  │
  └── EXPORTS TAB (history only, no export actions)
```

**Touchpoints:** ~8 API endpoints, 3 tabs. Pure read-only.

---

## 3. What's Missing: India AP Persona Gaps

### Gap 1: No value-based approval limits for MEMBERs

**Problem:** Every MEMBER can approve any invoice regardless of amount. The PRD says "MEMBERs approve up to a configured value limit" but this is only implemented in the advanced workflow builder — which is unvalidated and not used by the first adopter.

**Impact:** An AP clerk can approve a ₹50L invoice that should require senior review.

**Fix:** Add `approvalLimitMinor` to the user profile. Invoices above this limit auto-escalate to the next approver level.

### Gap 2: No "compliance reviewer" role

**Problem:** The TDS section and GL code override capabilities are gated by `requireNotViewer` — meaning both AP clerks (MEMBER) and admins (TENANT_ADMIN) can change TDS sections. But in practice, only a senior accountant or CA should change TDS sections.

**Impact:** A junior AP clerk could change TDS from 194J (10%) to 194C (2%), reducing the deduction incorrectly. No audit trail of who is qualified to make this change.

**Fix:** New permission: `canOverrideTds` and `canOverrideGlCode`, configurable per user.

### Gap 3: No CA sign-off for compliance

**Problem:** There's no way to require a CA's approval specifically for TDS compliance before an invoice is exported. The approval workflow supports multi-step approval but doesn't distinguish between "payment approval" and "compliance sign-off."

**Impact:** Invoices can be exported with wrong TDS sections without a CA ever reviewing them.

**Fix:** Approval workflow needs a "compliance sign-off" step type that specifically requires a user with CA authority.

### Gap 4: VIEWER scope is too rigid

**Problem:** VIEWERs see invoices filtered by `approvedBy` userId list. A CA auditing TDS compliance needs to see ALL invoices with TDS data, not just those approved by specific users.

**Impact:** Compliance audit requires TENANT_ADMIN role to see all invoices — but that also gives configuration access.

**Fix:** Viewer scope should support filter-by-status, filter-by-compliance-state, and filter-by-date-range — not just filter-by-approver.

### Gap 5: No separation between operational admin and financial admin

**Problem:** TENANT_ADMIN manages Gmail mailboxes AND configures TDS rates AND manages users AND approves invoices. In a real firm, the person connecting Gmail is IT/ops; the person configuring TDS mappings is a senior accountant; the person managing users is the firm partner.

**Impact:** A single person must do everything, or everyone gets TENANT_ADMIN which is over-permissioned.

**Fix:** Split TENANT_ADMIN capabilities into configurable permissions.

---

## 4. Proposed Persona Model

### 4.1 Personas (India Accounting Firm)

| Persona | Description | Current Role | Proposed Capability Set |
|---------|-------------|-------------|------------------------|
| **AP Clerk** | Data entry, reviews 150 invoices/day, confirms extractions, basic approval | MEMBER | View, edit fields, approve (up to limit), upload, ingest |
| **Senior Accountant** | Reviews TDS sections, validates GL codes, approves higher-value invoices | MEMBER (over-permissioned) | Everything AP Clerk + override TDS/GL, approve (higher limit), review compliance signals |
| **CA (Chartered Accountant)** | Compliance sign-off, TDS return preparation, audit readiness | VIEWER (under-permissioned) | View all, approve compliance sign-off step, download compliance reports, override TDS when flagged |
| **Tax Specialist** | Manages TDS section mappings, GL code master, compliance config | No good fit | Configure TDS mappings, GL codes, compliance config. No user management. |
| **Firm Partner** | Oversight, all data access, occasional overrides, user management | TENANT_ADMIN (over-permissioned) | Everything except technical ops (Gmail, bank connections) |
| **IT/Ops Admin** | Gmail connections, bank connections, technical config | TENANT_ADMIN (shared) | Gmail, bank, infrastructure. No invoice approval. |
| **Audit Clerk** | Prepares compliance reports, read-only access to all compliance data | VIEWER | View all invoices + compliance data, download reports. No approval. |

### 4.2 Implementation Options

**Option A: Expand roles (simple, rigid)**
Add 2-3 new roles: `SENIOR_MEMBER`, `COMPLIANCE_OFFICER`, `CONFIG_ADMIN`

Pros: Simple to implement (add to enum, add middleware checks)
Cons: Still rigid — doesn't match real-world flexibility where a CA might also be the senior accountant

**Option B: Permission-based capabilities (flexible, complex)**
Keep 4 base roles but add a capabilities/permissions layer per user.

```typescript
UserCapabilities {
  approvalLimitMinor: number | null     // null = unlimited
  canOverrideTds: boolean               // default: false for MEMBER
  canOverrideGlCode: boolean            // default: true for all non-VIEWER
  canSignOffCompliance: boolean          // CA sign-off authority
  canConfigureTdsMappings: boolean       // tax specialist
  canConfigureGlCodes: boolean           // tenant admin, tax specialist
  canManageUsers: boolean               // tenant admin, firm partner
  canManageConnections: boolean          // IT/ops admin
  canExportToTally: boolean             // default: true for TENANT_ADMIN, MEMBER
  canDownloadComplianceReports: boolean  // CA, audit clerk
  canViewAllInvoices: boolean           // overrides ViewerScope (CA needs this)
}
```

Pros: Maps exactly to real-world personas, each user gets exactly what they need
Cons: More complex UI for assigning capabilities, more middleware checks

**Option C: Persona templates on top of roles (recommended)**

Keep the 4 base roles for backward compatibility. Add a `persona` field on `TenantUserRole` that pre-configures capabilities:

```typescript
TenantUserRole {
  tenantId: string
  userId: string
  role: "TENANT_ADMIN" | "MEMBER" | "VIEWER"     // base role (gates middleware)
  persona?: "ap_clerk" | "senior_accountant" | "ca" | "tax_specialist" | "firm_partner" | "ops_admin" | "audit_clerk"
  capabilities: UserCapabilities                    // auto-set from persona, overridable
}
```

**Persona → Capability mapping (defaults):**

| Persona | Base Role | approvalLimit | overrideTds | overrideGl | signOffCompliance | configTds | configGl | manageUsers | manageConn | export | complianceReports | viewAll |
|---------|-----------|---------------|-------------|------------|-------------------|-----------|----------|-------------|------------|--------|-------------------|---------|
| ap_clerk | MEMBER | ₹1L | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| senior_accountant | MEMBER | ₹10L | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ |
| ca | MEMBER | unlimited | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| tax_specialist | MEMBER | ✗ (no approval) | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| firm_partner | TENANT_ADMIN | unlimited | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| ops_admin | TENANT_ADMIN | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ |
| audit_clerk | VIEWER | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |

Pros: Backward compatible (base roles still work), self-documenting (persona name tells you what the user does), flexible (capabilities can be overridden per user), simple for tenant admin (pick a persona from dropdown, capabilities auto-fill)
Cons: More data model changes, frontend needs persona selector

---

## 5. Approval Workflow Overhaul

### 5.1 Current Workflow Limitations

| Limitation | Impact |
|-----------|--------|
| Steps only check `role` or `specific_users` or `any_member` | Can't check `persona` or `capabilities` |
| No "compliance sign-off" step type | CA can't be specifically required for TDS review |
| Amount condition only on `totalAmountMinor` | Can't condition on TDS amount, GL category, risk signal severity |
| No parallel approval paths | Can't have payment approval AND compliance approval in parallel |
| No auto-escalation on timeout | Invoice stuck in AWAITING_APPROVAL if approver is absent |

### 5.2 Proposed Workflow Extensions

**New step types:**

```typescript
WorkflowStep {
  order: number
  name: string
  type: "approval" | "compliance_signoff" | "escalation"  // NEW: step type
  approverType: "any_member" | "role" | "specific_users" | "persona" | "capability"  // NEW: persona + capability
  approverPersona?: string        // e.g., "ca", "senior_accountant"
  approverCapability?: string     // e.g., "canSignOffCompliance"
  rule: "any" | "all"
  condition?: {
    field: "totalAmountMinor" | "tdsAmountMinor" | "riskSignalMaxSeverity" | "glCodeSource"  // NEW: compliance fields
    operator: "gt" | "gte" | "lt" | "lte" | "eq" | "in"  // NEW: eq, in
    value: number | string | string[]
  }
  timeoutHours?: number           // NEW: auto-escalate after timeout
  escalateTo?: string             // NEW: persona or userId for escalation
}
```

**New workflow patterns:**

| Pattern | Description | Steps |
|---------|-------------|-------|
| **AP → Senior → CA** | Three-tier approval with escalation | 1. AP Clerk approves (≤ ₹1L). 2. Senior Accountant approves (≤ ₹10L). 3. CA signs off (all). |
| **Approval + Compliance Parallel** | Payment and TDS review happen independently | 1. Any MEMBER approves (payment). 2. CA signs off compliance (parallel, only if TDS present). |
| **Risk-Based Routing** | Critical signals require senior review | 1. AP Clerk approves (if no critical signals). 2. Senior Accountant if `riskSignalMaxSeverity = "critical"`. |
| **TDS-Specific Review** | High-value TDS requires CA | 1. Any MEMBER approves. 2. CA if `tdsAmountMinor > 5000000` (₹50K TDS). |

### 5.3 Value-Based Approval Limits

**Add to user profile (not workflow — user-level):**

```typescript
TenantUserRole {
  ...existing...
  persona?: string
  capabilities: {
    approvalLimitMinor: number | null  // null = unlimited
    ...other capabilities...
  }
}
```

**Enforcement:** When a MEMBER clicks "Approve", the backend checks:
1. Is `invoice.totalAmountMinor > user.capabilities.approvalLimitMinor`?
2. If yes → auto-route to next workflow step (escalation)
3. If no → approve directly (or start workflow if configured)

This replaces the current workflow amount condition — the limit is on the USER, not the STEP.

---

## 6. State Machine Updates for Personas

### New transitions

| From | To | Trigger | Guard |
|------|----|---------|-------|
| `PARSED` / `NEEDS_REVIEW` | `AWAITING_APPROVAL` | `POST /invoices/approve` | Amount exceeds user's `approvalLimitMinor` |
| `AWAITING_APPROVAL` | `AWAITING_COMPLIANCE` | Payment approval step passes | Compliance sign-off step configured |
| `AWAITING_COMPLIANCE` | `APPROVED` | CA signs off compliance | User has `canSignOffCompliance` capability |
| `AWAITING_APPROVAL` | Auto-escalate | Timeout (configurable hours) | `timeoutHours` exceeded on current step |

### New status (optional)

`AWAITING_COMPLIANCE` — only if we add parallel approval paths. Otherwise, compliance sign-off is just another step in AWAITING_APPROVAL.

**Decision needed:** Add `AWAITING_COMPLIANCE` as a separate status, or keep it as a workflow step within `AWAITING_APPROVAL`?

Recommendation: Keep as workflow step. Adding a new status affects every query, every UI filter, and every export check. A step type is cheaper.

---

## 7. Implementation Phasing

### Phase 1 (m21 — current): No changes to roles
- Current 4-role model continues to work
- Compliance features accessible to MEMBER + TENANT_ADMIN
- No persona or capability layer yet

### Phase 2 (m22): Persona templates + capabilities
1. Add `persona` and `capabilities` to `TenantUserRole` model
2. Add persona selector to user management UI (dropdown: AP Clerk, Senior Accountant, CA, etc.)
3. Add `approvalLimitMinor` enforcement in `approveInvoices()`
4. Add `canOverrideTds` / `canOverrideGlCode` checks on PATCH endpoint
5. Add `canDownloadComplianceReports` check on report endpoints

### Phase 3 (m23): Workflow overhaul
1. New step types: `compliance_signoff`, `escalation`
2. New approver types: `persona`, `capability`
3. New conditions: `tdsAmountMinor`, `riskSignalMaxSeverity`, `glCodeSource`
4. Timeout + auto-escalation
5. Parallel approval paths (if validated by second adopter)

---

## 8. Data Model Changes Required

### TenantUserRole extension

```typescript
{
  tenantId: string
  userId: string
  role: "PLATFORM_ADMIN" | "TENANT_ADMIN" | "MEMBER" | "VIEWER"
  persona: string | null  // "ap_clerk" | "senior_accountant" | "ca" | "tax_specialist" | "firm_partner" | "ops_admin" | "audit_clerk"
  capabilities: {
    approvalLimitMinor: number | null
    canOverrideTds: boolean
    canOverrideGlCode: boolean
    canSignOffCompliance: boolean
    canConfigureTdsMappings: boolean
    canConfigureGlCodes: boolean
    canManageUsers: boolean
    canManageConnections: boolean
    canExportToTally: boolean
    canDownloadComplianceReports: boolean
    canViewAllInvoices: boolean
  }
}
```

**Migration:** Existing users get persona = null (backward compatible). Capabilities default based on role:
- TENANT_ADMIN → all true, unlimited approval
- MEMBER → approve + edit + export, no config, no compliance sign-off
- VIEWER → all false except viewable scope

### Frontend types extension

```typescript
interface UserCapabilities {
  approvalLimitMinor: number | null;
  canOverrideTds: boolean;
  canOverrideGlCode: boolean;
  canSignOffCompliance: boolean;
  canConfigureTdsMappings: boolean;
  canConfigureGlCodes: boolean;
  canManageUsers: boolean;
  canManageConnections: boolean;
  canExportToTally: boolean;
  canDownloadComplianceReports: boolean;
  canViewAllInvoices: boolean;
}

type UserPersona = "ap_clerk" | "senior_accountant" | "ca" | "tax_specialist" | "firm_partner" | "ops_admin" | "audit_clerk";
```

### Session context extension

The `/api/session` response must include `persona` and `capabilities` so the frontend can gate UI elements per-capability rather than per-role.
