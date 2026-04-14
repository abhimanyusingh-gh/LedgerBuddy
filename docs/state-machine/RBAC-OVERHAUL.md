# RBAC Overhaul: Full Capability-Based Permission System

> Last updated: 2026-04-14
>
> **Problem:** The legacy permission system used coarse role guards (`requireTenantAdmin`, `requireNotViewer`).
> Tenant access now uses persona-aligned roles plus capability checks, so route/UI gates must map to
> capabilities directly instead of broad "member/viewer" style buckets.
>
> **Solution:** Replace role-based middleware with capability-based middleware. Every route and
> every UI element checks specific capabilities, not roles.
>
> **Current base roles:** PLATFORM_ADMIN, TENANT_ADMIN, MEMBER, VIEWER.
> VIEWER is read-only with configurable data scope via ViewerScope.
> Persona-based capability defaults (ap_clerk, senior_accountant, ca, tax_specialist,
> firm_partner, ops_admin, audit_clerk) resolve specific permissions per role.
> Authentication is Keycloak-only (OIDC). All OIDC env vars use the `OIDC_*` prefix.

---

## 1. Current Permission Architecture (What's Wrong)

```
Request → requireAuth → requireTenantAdmin OR requireNotViewer → Route Handler
```

**Guards today:**
| Guard | Logic | Problem |
|-------|-------|---------|
| `requireAuth` | Has valid JWT | Fine |
| `requireTenantAdmin` | `role === "TENANT_ADMIN"` | CA can't configure TDS; ops admin can configure everything |
| `requireNotViewer` | `role !== "audit_clerk"` | Too coarse: AP clerk can override TDS sections; tax specialist can approve invoices |
| `requirePlatformAdmin` | `isPlatformAdmin` | Fine — platform admin is a separate concern |
| `requireNonPlatformAdmin` | `!isPlatformAdmin` | Fine |

**What breaks:**
- AP clerk (`ap_clerk`) can call `PUT /admin/approval-workflow` — should be firm_partner only
- Tax specialist (`tax_specialist`) can call `POST /invoices/approve` — they shouldn't approve
- Ops admin (TENANT_ADMIN) can call `POST /invoices/approve` — they manage infra, not invoices
- Audit clerk (`audit_clerk`) can't download compliance reports — but that's their job

---

## 2. Target Permission Architecture

```
Request → requireAuth → resolveCapabilities → requireCap("canApproveInvoices") → Route Handler
```

### 2.1 Middleware Stack

**Step 1: `resolveCapabilities` (runs once per request after auth)**
- Loads `TenantUserRole` for the authenticated user
- Attaches `req.capabilities` to the request
- Falls back to `getRoleDefaults(role)` if no stored capability overrides exist

**Step 2: `requireCap(capName)` (per-route)**
- Checks `req.capabilities[capName] === true`
- Returns 403 with specific message if denied

### 2.2 Capability Map → Route Assignment

| Capability | Routes Protected | Current Guard |
|-----------|-----------------|---------------|
| `canApproveInvoices` | `POST /invoices/approve`, `POST /invoices/:id/workflow-approve` | `requireNotViewer` |
| `canEditInvoiceFields` | `PATCH /invoices/:id` (parsed fields) | `requireNotViewer` |
| `canDeleteInvoices` | `POST /invoices/delete` | `requireNotViewer` |
| `canRetryInvoices` | `POST /invoices/retry` | `requireNotViewer` |
| `canUploadFiles` | `POST /jobs/upload` | `requireNotViewer` |
| `canStartIngestion` | `POST /jobs/ingest` | `requireNotViewer` |
| `canOverrideTds` | `PATCH /invoices/:id` (tdsSection field) | `requireNotViewer` |
| `canOverrideGlCode` | `PATCH /invoices/:id` (glCode field) | `requireNotViewer` |
| `canSignOffCompliance` | `POST /invoices/:id/workflow-approve` (compliance_signoff step) | None |
| `canConfigureTdsMappings` | `PUT /compliance/tds-rates/:section` | `requirePlatformAdmin` |
| `canConfigureGlCodes` | `POST/PUT/DELETE /admin/gl-codes` | `requireTenantAdmin` |
| `canManageUsers` | `GET/POST/PATCH/DELETE /admin/users/*` | `requireTenantAdmin` |
| `canManageConnections` | `POST /connect/gmail/*`, `POST /bank/*` | `requireTenantAdmin` |
| `canExportToTally` | `POST /exports/tally/*` | `requireNotViewer` |
| `canExportToCsv` | `POST /exports/csv` | `requireNotViewer` |
| `canDownloadComplianceReports` | `GET /reports/*` | None (was open to all auth) |
| `canViewAllInvoices` | `GET /invoices` (bypass scoped filters) | Capability gate |
| `canConfigureWorkflow` | `PUT /admin/approval-workflow` | `requireTenantAdmin` |
| `canConfigureCompliance` | `PUT /admin/compliance-config` | `requireTenantAdmin` |
| `canManageCostCenters` | `POST/PUT/DELETE /admin/cost-centers` | `requireTenantAdmin` |
| `canSendVendorEmails` | `POST /invoices/:id/vendor-email/send` | `requireNotViewer` |

### 2.3 Updated Persona → Capability Defaults

| Capability | ap_clerk | sr_acct | ca | tax_spec | partner | ops_admin | audit_clerk |
|-----------|----------|---------|-----|----------|---------|-----------|-------------|
| canApproveInvoices | ✓ (limit) | ✓ (limit) | ✓ | ✗ | ✓ | ✗ | ✗ |
| canEditInvoiceFields | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| canDeleteInvoices | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| canRetryInvoices | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| canUploadFiles | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| canStartIngestion | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ |
| canOverrideTds | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| canOverrideGlCode | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| canSignOffCompliance | ✗ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ |
| canConfigureTdsMappings | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ |
| canConfigureGlCodes | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| canManageUsers | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✗ |
| canManageConnections | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| canExportToTally | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| canExportToCsv | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| canDownloadComplianceReports | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| canViewAllInvoices | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✓ |
| canConfigureWorkflow | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| canConfigureCompliance | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ |
| canManageCostCenters | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| canSendVendorEmails | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ |
| approvalLimitMinor | ₹1L | ₹10L | ∞ | 0 | ∞ | 0 | 0 |

---

## 3. Implementation Plan

### Backend Changes

**Step 1: Add `resolveCapabilities` middleware**
- Runs after `requireAuth`
- Loads capabilities from `TenantUserRole`
- Attaches to `req.authContext.capabilities`
- Cached per request (single DB lookup)

**Step 2: Replace all `requireTenantAdmin` / `requireNotViewer` calls**
- Each route gets a specific `requireCap("capName")` guard
- `requireTenantAdmin` becomes `requireCap("canManageUsers")` on user routes
- `requireNotViewer` becomes the specific capability for that action

**Step 3: Approval limit enforcement**
- `invoiceService.approveInvoices()` checks `capabilities.approvalLimitMinor`
- If invoice amount > limit → auto-escalate to workflow

### Frontend Changes

**Step 1: Store capabilities in session state**
- `fetchSessionContext()` now returns `user.capabilities`
- Store in App.tsx state alongside `session`

**Step 2: Replace role-based UI gates with capability gates**
- `isViewer` → `!capabilities.canApproveInvoices`
- `isTenantAdmin` → `capabilities.canManageUsers` (for user management)
- `isTenantAdmin` → `capabilities.canConfigureGlCodes` (for GL codes)
- Upload button: `capabilities.canUploadFiles`
- Approve button: `capabilities.canApproveInvoices`
- Export button: `capabilities.canExportToTally || capabilities.canExportToCsv`
- TDS override dropdown: `capabilities.canOverrideTds`
- GL override dropdown: `capabilities.canOverrideGlCode`
- Config tab: `capabilities.canManageUsers || capabilities.canConfigureWorkflow || capabilities.canConfigureGlCodes`
- Connections tab: `capabilities.canManageConnections`

**Step 3: Compliance report download**
- Only visible when `capabilities.canDownloadComplianceReports`

---

## 4. Migration Strategy

If `capabilities` is not set on a user's `TenantUserRole`, fallback to `getRoleDefaults(role)`:
- TENANT_ADMIN → all capabilities true
- ap_clerk → approve + edit + upload + export, no admin config
- audit_clerk → read-only with reports + full invoice visibility

Legacy `MEMBER/VIEWER` role values are retired and no longer accepted in runtime role enums.

---

## 5. Files to Change

| File | Change |
|------|--------|
| `auth/requireCapability.ts` | Already created — verify it attaches to req properly |
| `auth/middleware.ts` | Add `resolveCapabilities` middleware |
| `auth/personaDefaults.ts` | Expand capability map and role defaults |
| `models/TenantUserRole.ts` | Add 10 new capability fields to schema |
| `routes/invoices.ts` | Replace `requireNotViewer` with specific caps |
| `routes/export.ts` | `requireCap("canExportToTally")` |
| `routes/csvExport.ts` | `requireCap("canExportToCsv")` |
| `routes/glCodes.ts` | `requireCap("canConfigureGlCodes")` |
| `routes/tdsRates.ts` | `requireCap("canConfigureTdsMappings")` |
| `routes/tenantAdmin.ts` | `requireCap("canManageUsers")` |
| `routes/approvalWorkflow.ts` | `requireCap("canConfigureWorkflow")` |
| `routes/tenantComplianceConfig.ts` | `requireCap("canConfigureCompliance")` |
| `routes/costCenters.ts` | `requireCap("canManageCostCenters")` |
| `routes/complianceReports.ts` | `requireCap("canDownloadComplianceReports")` |
| `routes/vendorCommunication.ts` | `requireCap("canSendVendorEmails")` |
| `routes/jobs.ts` | `requireCap("canUploadFiles")` / `requireCap("canStartIngestion")` |
| `routes/session.ts` | Already updated to return capabilities |
| `services/invoiceService.ts` | Check `approvalLimitMinor` in `approveInvoices()` |
| `frontend/src/App.tsx` | Replace `isTenantAdmin`/`isViewer` with capability checks |
| `frontend/src/types.ts` | Already has `UserCapabilities` type |
| `frontend/src/components/tenantAdmin/*.tsx` | Gate UI elements by capability |
