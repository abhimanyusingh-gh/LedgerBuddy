# BillForge System Analysis — Deterministic Application Model

> Generated: 2026-03-27 | Method: 10-stage codebase reverse-engineering

---

## 1. FULL GRAPH (JSON)

### Nodes

```json
{
  "nodes": [
    {
      "id": "N01",
      "route": "/login",
      "state": "UNAUTHENTICATED",
      "component": "LoginPage",
      "inputs": ["email", "password"],
      "actions": ["submit_login"],
      "guard": "!session"
    },
    {
      "id": "N02",
      "route": "/callback",
      "state": "AUTH_CALLBACK",
      "component": "App (bootstrapSession)",
      "inputs": ["token (query)", "next (query)"],
      "actions": ["store_token", "fetch_session", "redirect"],
      "guard": "none (URL param driven)"
    },
    {
      "id": "N03",
      "route": "/change-password",
      "state": "MUST_CHANGE_PASSWORD",
      "component": "App (inline modal)",
      "inputs": ["currentPassword", "newPassword", "confirmPassword"],
      "actions": ["submit_change_password"],
      "guard": "session && flags.must_change_password"
    },
    {
      "id": "N04",
      "route": "/onboarding",
      "state": "TENANT_SETUP_PENDING",
      "component": "App (inline card)",
      "inputs": ["tenantName", "adminEmail"],
      "actions": ["complete_onboarding"],
      "guard": "session && requiresTenantSetup && !isPlatformAdmin"
    },
    {
      "id": "N05",
      "route": "/tenant/overview",
      "state": "AUTHENTICATED_TENANT",
      "component": "OverviewDashboard",
      "inputs": ["dateFrom", "dateTo", "preset", "scope"],
      "actions": ["change_date_range", "change_scope"],
      "guard": "session && !isPlatformAdmin && activeTab==='overview'"
    },
    {
      "id": "N06",
      "route": "/tenant/invoices",
      "state": "AUTHENTICATED_TENANT",
      "component": "TenantInvoicesView",
      "inputs": ["searchQuery", "statusFilter", "dateFrom", "dateTo", "approvedBy", "sortColumn", "sortDir", "page", "pageSize", "tableDensity"],
      "actions": ["approve", "delete", "retry", "export", "upload", "ingest", "pause", "inline_edit", "rename", "select", "batch_approve", "batch_delete", "batch_export", "open_detail", "close_detail"],
      "guard": "session && !isPlatformAdmin && activeTab==='dashboard'"
    },
    {
      "id": "N07",
      "route": "/tenant/config",
      "state": "AUTHENTICATED_TENANT_ADMIN",
      "component": "TenantConfigTab",
      "inputs": ["inviteEmail", "workflowEnabled", "workflowMode", "simpleConfig", "advancedSteps"],
      "actions": ["invite_user", "change_role", "toggle_user_enabled", "remove_user", "save_workflow", "connect_gmail"],
      "guard": "session && isTenantAdmin && !isPlatformAdmin && activeTab==='config'"
    },
    {
      "id": "N08",
      "route": "/tenant/exports",
      "state": "AUTHENTICATED_TENANT",
      "component": "ExportHistoryDashboard",
      "inputs": ["dateFrom", "dateTo", "sortKey", "sortDir", "page", "pageSize"],
      "actions": ["download_batch", "change_filters"],
      "guard": "session && !isPlatformAdmin && activeTab==='exports'"
    },
    {
      "id": "N09",
      "route": "/tenant/connections",
      "state": "AUTHENTICATED_TENANT_ADMIN",
      "component": "BankConnectionsTab",
      "inputs": ["aaAddress", "displayName"],
      "actions": ["add_gmail_inbox", "remove_mailbox", "assign_mailbox_user", "remove_mailbox_assignment", "add_bank_account", "refresh_bank_balance", "revoke_bank_account"],
      "guard": "session && isTenantAdmin && !isPlatformAdmin && activeTab==='connections'"
    },
    {
      "id": "N10",
      "route": "/platform/dashboard",
      "state": "AUTHENTICATED_PLATFORM_ADMIN",
      "component": "PlatformAdmin sections",
      "inputs": ["tenantName", "adminEmail", "adminDisplayName", "mode"],
      "actions": ["onboard_tenant", "toggle_tenant_enabled", "select_tenant", "refresh_usage"],
      "guard": "session && isPlatformAdmin"
    },
    {
      "id": "N11",
      "route": "/health",
      "state": "SYSTEM",
      "component": "Backend health.ts",
      "inputs": [],
      "actions": [],
      "guard": "none (public)"
    },
    {
      "id": "N12",
      "route": "/bank/aa-callback",
      "state": "BANK_CONSENT_CALLBACK",
      "component": "Backend bankWebhooks.ts",
      "inputs": ["ecres", "iv", "sessionId"],
      "actions": ["process_consent", "redirect"],
      "guard": "none (public webhook)"
    },
    {
      "id": "N13",
      "route": "/connect/gmail",
      "state": "GMAIL_OAUTH_INITIATE",
      "component": "Backend gmailConnection.ts",
      "inputs": ["token (query)"],
      "actions": ["validate_token", "redirect_to_google"],
      "guard": "custom (session token in query, must be TENANT_ADMIN)"
    },
    {
      "id": "N14",
      "route": "/connect/gmail/callback",
      "state": "GMAIL_OAUTH_CALLBACK",
      "component": "Backend gmailConnection.ts",
      "inputs": ["code", "state"],
      "actions": ["exchange_token", "store_integration", "redirect"],
      "guard": "none (OAuth state validates)"
    }
  ]
}
```

### Edges

```json
{
  "edges": [
    {
      "from": "N01", "to": "N02",
      "trigger": "submit_login (email + password)",
      "conditions": ["email non-empty", "password non-empty"],
      "api_call": "POST /auth/token",
      "response": "{token} → stored in localStorage"
    },
    {
      "from": "N02", "to": "N03",
      "trigger": "session loaded with must_change_password=true",
      "conditions": ["flags.must_change_password === true"],
      "api_call": "GET /session",
      "response": "session context with flags"
    },
    {
      "from": "N02", "to": "N04",
      "trigger": "session loaded with requires_tenant_setup=true",
      "conditions": ["flags.requires_tenant_setup === true", "!isPlatformAdmin"],
      "api_call": "GET /session",
      "response": "session context with flags"
    },
    {
      "from": "N02", "to": "N06",
      "trigger": "session loaded, tenant setup complete",
      "conditions": ["!flags.requires_tenant_setup", "!isPlatformAdmin", "activeTab==='dashboard'"],
      "api_call": "GET /session",
      "response": "session context"
    },
    {
      "from": "N02", "to": "N10",
      "trigger": "session loaded, user is platform admin",
      "conditions": ["isPlatformAdmin"],
      "api_call": "GET /session",
      "response": "session context"
    },
    {
      "from": "N03", "to": "N06",
      "trigger": "password changed successfully",
      "conditions": ["newPassword.length >= 6", "newPassword === confirmPassword"],
      "api_call": "POST /auth/change-password",
      "response": "success → re-bootstrap session"
    },
    {
      "from": "N04", "to": "N06",
      "trigger": "onboarding completed",
      "conditions": ["isTenantAdmin", "tenantName non-empty"],
      "api_call": "POST /tenant/onboarding/complete",
      "response": "204 → re-bootstrap session"
    },
    {
      "from": "N05", "to": "N06",
      "trigger": "tab switch to Invoices",
      "conditions": [],
      "api_call": "none",
      "response": "setActiveTab('dashboard')"
    },
    {
      "from": "N06", "to": "N05",
      "trigger": "tab switch to Overview",
      "conditions": [],
      "api_call": "none",
      "response": "setActiveTab('overview')"
    },
    {
      "from": "N06", "to": "N07",
      "trigger": "tab switch to Config",
      "conditions": ["isTenantAdmin"],
      "api_call": "none",
      "response": "setActiveTab('config')"
    },
    {
      "from": "N06", "to": "N08",
      "trigger": "tab switch to Exports",
      "conditions": [],
      "api_call": "none",
      "response": "setActiveTab('exports')"
    },
    {
      "from": "N06", "to": "N09",
      "trigger": "tab switch to Connections",
      "conditions": ["isTenantAdmin"],
      "api_call": "none",
      "response": "setActiveTab('connections')"
    },
    {
      "from": "N06", "to": "N06",
      "trigger": "approve invoice(s)",
      "conditions": ["!isViewer", "status in [PARSED, NEEDS_REVIEW, PENDING]", "status !== FAILED_PARSE"],
      "api_call": "POST /invoices/approve",
      "response": "{modifiedCount} → reload list"
    },
    {
      "from": "N06", "to": "N06",
      "trigger": "delete invoice(s)",
      "conditions": ["!isViewer", "confirm dialog accepted"],
      "api_call": "POST /invoices/delete",
      "response": "{deletedCount} → reload list"
    },
    {
      "from": "N06", "to": "N06",
      "trigger": "retry invoice(s)",
      "conditions": ["!isViewer", "status in [FAILED_OCR, FAILED_PARSE, PARSED, NEEDS_REVIEW, PENDING]"],
      "api_call": "POST /invoices/retry",
      "response": "{modifiedCount} → reload list + SSE subscribe"
    },
    {
      "from": "N06", "to": "N06",
      "trigger": "export invoice(s) to Tally",
      "conditions": ["!isViewer", "status === APPROVED"],
      "api_call": "POST /exports/tally/download",
      "response": "{batchId} → GET /exports/tally/download/{batchId} → file download"
    },
    {
      "from": "N06", "to": "N06",
      "trigger": "upload files",
      "conditions": ["!isViewer", "files: .pdf/.jpg/.jpeg/.png", "max 50 files", "max 20MB each"],
      "api_call": "POST /jobs/upload (multipart)",
      "response": "{uploaded, count} → run ingestion"
    },
    {
      "from": "N06", "to": "N06",
      "trigger": "run ingestion",
      "conditions": ["!isViewer", "ingestion not already running"],
      "api_call": "POST /jobs/ingest",
      "response": "status → SSE subscribe for progress"
    },
    {
      "from": "N06", "to": "N06",
      "trigger": "inline edit field",
      "conditions": ["!isViewer", "status !== EXPORTED"],
      "api_call": "PATCH /invoices/{id}",
      "response": "updated invoice → reload detail"
    },
    {
      "from": "N07", "to": "N07",
      "trigger": "invite user",
      "conditions": ["isTenantAdmin", "email contains @"],
      "api_call": "POST /admin/users/invite",
      "response": "201 → reload user list"
    },
    {
      "from": "N07", "to": "N07",
      "trigger": "save workflow config",
      "conditions": ["isTenantAdmin", "if advanced+enabled: >=1 step"],
      "api_call": "PUT /admin/approval-workflow",
      "response": "config → show success"
    },
    {
      "from": "N09", "to": "N13",
      "trigger": "add Gmail inbox",
      "conditions": ["isTenantAdmin"],
      "api_call": "GET /integrations/gmail/connect-url",
      "response": "{connectUrl} → open popup window"
    },
    {
      "from": "N13", "to": "N14",
      "trigger": "Google OAuth consent granted",
      "conditions": [],
      "api_call": "redirect to Google",
      "response": "redirect to /connect/gmail/callback"
    },
    {
      "from": "N14", "to": "N09",
      "trigger": "Gmail OAuth callback complete",
      "conditions": ["code + state valid"],
      "api_call": "internal token exchange",
      "response": "redirect → ?gmail=connected → popup closes → parent reloads"
    },
    {
      "from": "N09", "to": "N12",
      "trigger": "add bank account",
      "conditions": ["isTenantAdmin", "aaAddress non-empty"],
      "api_call": "POST /bank/accounts",
      "response": "{redirectUrl} → window.location.assign()"
    },
    {
      "from": "N12", "to": "N09",
      "trigger": "bank consent callback",
      "conditions": [],
      "api_call": "none (webhook)",
      "response": "redirect to / or /?bank=error"
    },
    {
      "from": "N10", "to": "N10",
      "trigger": "onboard tenant",
      "conditions": ["isPlatformAdmin", "tenantName non-empty", "email contains @"],
      "api_call": "POST /platform/tenants/onboard-admin",
      "response": "{tenantId, tempPassword} → show password, reload usage"
    },
    {
      "from": "N10", "to": "N10",
      "trigger": "toggle tenant enabled",
      "conditions": ["isPlatformAdmin"],
      "api_call": "PATCH /platform/tenants/{id}/enabled",
      "response": "{enabled} → reload usage"
    },
    {
      "from": "ANY", "to": "N01",
      "trigger": "logout",
      "conditions": [],
      "api_call": "none (client-side token clear)",
      "response": "clearStoredSessionToken() → session=null"
    },
    {
      "from": "ANY", "to": "N01",
      "trigger": "session expired (401 on any API call)",
      "conditions": ["API returns 401"],
      "api_call": "any",
      "response": "error shown → user must re-login"
    }
  ]
}
```

---

## 3. STATE MACHINE

```json
{
  "states": [
    "UNAUTHENTICATED",
    "AUTH_LOADING",
    "MUST_CHANGE_PASSWORD",
    "TENANT_SETUP_PENDING",
    "AUTHENTICATED_TENANT",
    "AUTHENTICATED_TENANT_ADMIN",
    "AUTHENTICATED_PLATFORM_ADMIN",
    "GMAIL_OAUTH_FLOW",
    "BANK_CONSENT_FLOW",
    "SESSION_EXPIRED"
  ],
  "events": [
    "LOGIN_SUBMIT",
    "TOKEN_RECEIVED",
    "SESSION_LOADED",
    "PASSWORD_CHANGED",
    "ONBOARDING_COMPLETED",
    "TAB_SWITCH",
    "APPROVE_INVOICE",
    "DELETE_INVOICE",
    "RETRY_INVOICE",
    "EXPORT_INVOICE",
    "UPLOAD_FILES",
    "RUN_INGESTION",
    "PAUSE_INGESTION",
    "INLINE_EDIT",
    "INVITE_USER",
    "CHANGE_ROLE",
    "TOGGLE_USER_ENABLED",
    "REMOVE_USER",
    "SAVE_WORKFLOW",
    "CONNECT_GMAIL",
    "GMAIL_CALLBACK",
    "ADD_BANK_ACCOUNT",
    "BANK_CALLBACK",
    "REFRESH_BANK_BALANCE",
    "REVOKE_BANK_ACCOUNT",
    "ONBOARD_TENANT",
    "TOGGLE_TENANT_ENABLED",
    "CHANGE_PASSWORD",
    "LOGOUT",
    "API_401"
  ],
  "transitions": [
    {"from": "UNAUTHENTICATED", "event": "LOGIN_SUBMIT", "to": "AUTH_LOADING", "api": "POST /auth/token"},
    {"from": "AUTH_LOADING", "event": "TOKEN_RECEIVED", "to": "AUTH_LOADING", "api": "GET /session"},
    {"from": "AUTH_LOADING", "event": "SESSION_LOADED", "to": "MUST_CHANGE_PASSWORD", "condition": "flags.must_change_password"},
    {"from": "AUTH_LOADING", "event": "SESSION_LOADED", "to": "TENANT_SETUP_PENDING", "condition": "flags.requires_tenant_setup && !isPlatformAdmin"},
    {"from": "AUTH_LOADING", "event": "SESSION_LOADED", "to": "AUTHENTICATED_TENANT", "condition": "!isPlatformAdmin && role in [MEMBER, VIEWER]"},
    {"from": "AUTH_LOADING", "event": "SESSION_LOADED", "to": "AUTHENTICATED_TENANT_ADMIN", "condition": "!isPlatformAdmin && role === TENANT_ADMIN"},
    {"from": "AUTH_LOADING", "event": "SESSION_LOADED", "to": "AUTHENTICATED_PLATFORM_ADMIN", "condition": "isPlatformAdmin"},
    {"from": "AUTH_LOADING", "event": "API_401", "to": "UNAUTHENTICATED"},
    {"from": "MUST_CHANGE_PASSWORD", "event": "PASSWORD_CHANGED", "to": "AUTH_LOADING", "api": "POST /auth/change-password"},
    {"from": "TENANT_SETUP_PENDING", "event": "ONBOARDING_COMPLETED", "to": "AUTH_LOADING", "api": "POST /tenant/onboarding/complete", "guard": "isTenantAdmin"},
    {"from": "AUTHENTICATED_TENANT", "event": "TAB_SWITCH", "to": "AUTHENTICATED_TENANT"},
    {"from": "AUTHENTICATED_TENANT", "event": "APPROVE_INVOICE", "to": "AUTHENTICATED_TENANT", "guard": "!isViewer", "api": "POST /invoices/approve"},
    {"from": "AUTHENTICATED_TENANT", "event": "DELETE_INVOICE", "to": "AUTHENTICATED_TENANT", "guard": "!isViewer", "api": "POST /invoices/delete"},
    {"from": "AUTHENTICATED_TENANT", "event": "RETRY_INVOICE", "to": "AUTHENTICATED_TENANT", "guard": "!isViewer", "api": "POST /invoices/retry"},
    {"from": "AUTHENTICATED_TENANT", "event": "EXPORT_INVOICE", "to": "AUTHENTICATED_TENANT", "guard": "!isViewer && status===APPROVED", "api": "POST /exports/tally/download"},
    {"from": "AUTHENTICATED_TENANT", "event": "UPLOAD_FILES", "to": "AUTHENTICATED_TENANT", "guard": "!isViewer", "api": "POST /jobs/upload"},
    {"from": "AUTHENTICATED_TENANT", "event": "RUN_INGESTION", "to": "AUTHENTICATED_TENANT", "guard": "!isViewer", "api": "POST /jobs/ingest"},
    {"from": "AUTHENTICATED_TENANT", "event": "INLINE_EDIT", "to": "AUTHENTICATED_TENANT", "guard": "!isViewer && status!==EXPORTED", "api": "PATCH /invoices/{id}"},
    {"from": "AUTHENTICATED_TENANT_ADMIN", "event": "TAB_SWITCH", "to": "AUTHENTICATED_TENANT_ADMIN"},
    {"from": "AUTHENTICATED_TENANT_ADMIN", "event": "INVITE_USER", "to": "AUTHENTICATED_TENANT_ADMIN", "api": "POST /admin/users/invite"},
    {"from": "AUTHENTICATED_TENANT_ADMIN", "event": "CHANGE_ROLE", "to": "AUTHENTICATED_TENANT_ADMIN", "api": "POST /admin/users/{userId}/role"},
    {"from": "AUTHENTICATED_TENANT_ADMIN", "event": "TOGGLE_USER_ENABLED", "to": "AUTHENTICATED_TENANT_ADMIN", "api": "PATCH /admin/users/{userId}/enabled"},
    {"from": "AUTHENTICATED_TENANT_ADMIN", "event": "REMOVE_USER", "to": "AUTHENTICATED_TENANT_ADMIN", "api": "DELETE /admin/users/{userId}"},
    {"from": "AUTHENTICATED_TENANT_ADMIN", "event": "SAVE_WORKFLOW", "to": "AUTHENTICATED_TENANT_ADMIN", "api": "PUT /admin/approval-workflow"},
    {"from": "AUTHENTICATED_TENANT_ADMIN", "event": "CONNECT_GMAIL", "to": "GMAIL_OAUTH_FLOW", "api": "GET /integrations/gmail/connect-url"},
    {"from": "GMAIL_OAUTH_FLOW", "event": "GMAIL_CALLBACK", "to": "AUTHENTICATED_TENANT_ADMIN"},
    {"from": "AUTHENTICATED_TENANT_ADMIN", "event": "ADD_BANK_ACCOUNT", "to": "BANK_CONSENT_FLOW", "api": "POST /bank/accounts"},
    {"from": "BANK_CONSENT_FLOW", "event": "BANK_CALLBACK", "to": "AUTHENTICATED_TENANT_ADMIN"},
    {"from": "AUTHENTICATED_PLATFORM_ADMIN", "event": "ONBOARD_TENANT", "to": "AUTHENTICATED_PLATFORM_ADMIN", "api": "POST /platform/tenants/onboard-admin"},
    {"from": "AUTHENTICATED_PLATFORM_ADMIN", "event": "TOGGLE_TENANT_ENABLED", "to": "AUTHENTICATED_PLATFORM_ADMIN", "api": "PATCH /platform/tenants/{id}/enabled"},
    {"from": "*", "event": "CHANGE_PASSWORD", "to": "MUST_CHANGE_PASSWORD"},
    {"from": "*", "event": "LOGOUT", "to": "UNAUTHENTICATED"},
    {"from": "*", "event": "API_401", "to": "SESSION_EXPIRED"}
  ]
}
```

### Invoice Status State Machine

```json
{
  "states": ["PENDING", "PARSED", "NEEDS_REVIEW", "AWAITING_APPROVAL", "FAILED_OCR", "FAILED_PARSE", "APPROVED", "EXPORTED"],
  "transitions": [
    {"from": "PENDING", "event": "OCR_SUCCESS + SLM_SUCCESS", "to": "PARSED"},
    {"from": "PENDING", "event": "OCR_SUCCESS + LOW_CONFIDENCE", "to": "NEEDS_REVIEW"},
    {"from": "PENDING", "event": "OCR_FAILURE", "to": "FAILED_OCR"},
    {"from": "PENDING", "event": "PARSE_FAILURE", "to": "FAILED_PARSE"},
    {"from": "PARSED", "event": "APPROVE", "to": "APPROVED", "guard": "!isViewer"},
    {"from": "PARSED", "event": "APPROVE (with workflow)", "to": "AWAITING_APPROVAL"},
    {"from": "NEEDS_REVIEW", "event": "APPROVE", "to": "APPROVED", "guard": "!isViewer"},
    {"from": "NEEDS_REVIEW", "event": "APPROVE (with workflow)", "to": "AWAITING_APPROVAL"},
    {"from": "AWAITING_APPROVAL", "event": "ALL_STEPS_APPROVED", "to": "APPROVED"},
    {"from": "AWAITING_APPROVAL", "event": "STEP_REJECTED", "to": "NEEDS_REVIEW"},
    {"from": "APPROVED", "event": "EXPORT", "to": "EXPORTED"},
    {"from": "FAILED_OCR", "event": "RETRY", "to": "PENDING"},
    {"from": "FAILED_PARSE", "event": "RETRY", "to": "PENDING"},
    {"from": "PARSED", "event": "RETRY", "to": "PENDING"},
    {"from": "NEEDS_REVIEW", "event": "RETRY", "to": "PENDING"},
    {"from": "PENDING", "event": "RETRY", "to": "PENDING"},
    {"from": "*", "event": "DELETE", "to": "(removed)", "guard": "!isViewer"}
  ],
  "terminal_states": ["EXPORTED"],
  "non_approvable": ["FAILED_PARSE", "FAILED_OCR", "EXPORTED", "PENDING"]
}
```

---

## 4. VALIDATION REPORT

### 4.1 Route Guards

| Route/View | Frontend Guard | Backend Guard | Match |
|------------|---------------|---------------|-------|
| Login | `!session` | None (public) | OK |
| Session | `session` | `authenticate` | OK |
| Platform Dashboard | `isPlatformAdmin` | `requirePlatformAdmin` | OK |
| Platform Onboard | `isPlatformAdmin` | `requirePlatformAdmin` | OK |
| Platform Toggle | `isPlatformAdmin` | `requirePlatformAdmin` | OK |
| Platform Usage | `isPlatformAdmin` | `requirePlatformAdmin` | OK |
| Tenant Overview | `!isPlatformAdmin` | `requireNonPlatformAdmin` | OK |
| Tenant Invoices | `!isPlatformAdmin` | `requireNonPlatformAdmin + requireTenantSetupCompleted` | OK |
| Invoice Approve | `!isViewer` | `requireNotViewer` | OK |
| Invoice Delete | `!isViewer` | `requireNotViewer` | OK |
| Invoice Retry | `!isViewer` | `requireNotViewer` | OK |
| Invoice Edit | `!isViewer && status!==EXPORTED` | `requireNotViewer` (no status check in middleware) | PARTIAL — BE allows editing EXPORTED |
| File Upload | `!isViewer` | `requireNotViewer` | OK |
| Run Ingestion | `!isViewer` | `requireNotViewer` | OK |
| Export | `!isViewer` | `requireNotViewer` | OK |
| Config Tab | `isTenantAdmin` | `requireTenantAdmin` | OK |
| Connections Tab | `isTenantAdmin` | `requireTenantAdmin` | OK |
| User Invite | `isTenantAdmin` | `requireTenantAdmin` | OK |
| Role Change | `isTenantAdmin` | `requireTenantAdmin` | OK |
| Workflow Config | `isTenantAdmin` | `requireTenantAdmin` | OK |
| Gmail Connect | `isTenantAdmin` | custom token + TENANT_ADMIN check | OK |
| Bank Accounts | `isTenantAdmin` | `requireTenantAdmin` | OK |
| Workflow Approve | `!isViewer` | `requireNotViewer` | OK |
| Workflow Reject | `!isViewer` | `requireNotViewer` | OK |
| Health | none (not in FE) | none (public) | OK |
| Bank Webhooks | none (not in FE) | none (public) | OK |

### 4.2 Input Validations

| Input | Frontend Validation | Backend Validation | Match |
|-------|--------------------|--------------------|-------|
| Login email | required (non-empty) | required (non-empty) | OK |
| Login password | required (non-empty) | required (non-empty) | OK |
| Change password (new) | min 6 chars, must match confirm | min length not checked in route (service-level) | PARTIAL |
| Tenant name (onboard) | trimmed, non-empty | trimmed, non-empty | OK |
| Admin email (onboard) | trimmed | must contain "@" | FE WEAKER |
| Invite email | trimmed | must contain "@" | FE WEAKER |
| Bank aaAddress | required | trimmed, non-empty | OK |
| Workflow steps | >=1 if advanced+enabled | validated in service | OK |
| File upload types | .pdf/.jpg/.jpeg/.png | `isAllowedFileExtension` checks same set | OK |
| File upload size | no client check | 20MB limit (multer) | FE MISSING |
| File upload count | no client check | 50 file limit (multer) | FE MISSING |
| Invoice approve IDs | non-empty array | non-empty array | OK |
| Pagination page | min 1 | min 1 | OK |
| Pagination limit | 10/20/50/100 | min 1, max 100 | OK |
| Date range | none | from <= to, to <= 1 year from now | FE MISSING |

### 4.3 Contract Mismatches (Verified)

| ID | Type | Severity | Description |
|----|------|----------|-------------|
| CM-01 | enum_mismatch | Medium | FE `SessionContext.user.role` type has 3 values (PLATFORM_ADMIN, TENANT_ADMIN, MEMBER). BE returns 4 (includes VIEWER). FE handles VIEWER via separate `isViewer` prop derived from session, but the type is incomplete. Runtime-safe but type-unsafe. |
| CM-02 | enum_mismatch | Medium | FE `TenantUserSummary.role` type has 2 values (TENANT_ADMIN, MEMBER). BE can return VIEWER. User list may show unrecognized role string. |
| CM-03 | enum_mismatch | High | FE role assignment dropdown only offers TENANT_ADMIN and MEMBER. BE accepts VIEWER. No UI path to assign/change VIEWER role. |
| CM-04 | VERIFIED_NOT_MISMATCH | N/A | Gmail connectionState: BE route handler maps lowercase model values to uppercase FE values (connected→CONNECTED, requires_reauth→NEEDS_REAUTH, else→DISCONNECTED). Mapping correct. |
| CM-05 | missing_field | Low | FE sends displayName as required; BE treats it as optional (defaults to aaAddress). FE is stricter — no runtime issue. |
| CM-06 | VERIFIED_NOT_MISMATCH | N/A | SSE auth: BE middleware `resolveBearerToken()` falls back to `request.query.authToken` when no Authorization header. SSE auth works correctly. |
| CM-07 | missing_validation | Low | PATCH /invoices/{id} has no Zod schema. Relies on manual field extraction. Extra fields silently ignored. |
| CM-08 | missing_field | Low | FE expects `failedAll` count in invoice list response. If BE doesn't return it, FE may show 0. Need to verify BE aggregation logic. |

### 4.4 States

| State | Entry Condition | Exit Events | Reachable |
|-------|----------------|-------------|-----------|
| UNAUTHENTICATED | Initial / Logout / Token clear | LOGIN_SUBMIT | Yes |
| AUTH_LOADING | Login success | SESSION_LOADED, API_401 | Yes |
| MUST_CHANGE_PASSWORD | Session flag | PASSWORD_CHANGED | Yes |
| TENANT_SETUP_PENDING | Session flag, non-platform | ONBOARDING_COMPLETED | Yes |
| AUTHENTICATED_TENANT | Session loaded, MEMBER/VIEWER | TAB_SWITCH, invoice actions, LOGOUT | Yes |
| AUTHENTICATED_TENANT_ADMIN | Session loaded, TENANT_ADMIN | All tenant actions + admin actions | Yes |
| AUTHENTICATED_PLATFORM_ADMIN | Session loaded, isPlatformAdmin | ONBOARD_TENANT, TOGGLE_TENANT, LOGOUT | Yes |
| GMAIL_OAUTH_FLOW | Connect Gmail clicked | GMAIL_CALLBACK | Yes |
| BANK_CONSENT_FLOW | Add Bank clicked | BANK_CALLBACK | Yes |
| SESSION_EXPIRED | API_401 on any call | (manual re-login needed) | Yes |

### 4.5 Missing/Dead Transitions

| Issue | Description |
|-------|-------------|
| SESSION_EXPIRED has no auto-redirect | API 401 shows error message but no automatic redirect to login. User must manually refresh or click logout. |
| VIEWER cannot be assigned via UI | CM-03: No UI control to assign VIEWER role. Must be done via API or seed data. |
| MEMBER stuck on TENANT_SETUP_PENDING | If a MEMBER user is invited to a tenant that hasn't completed onboarding, they see the onboarding card but cannot complete it (only TENANT_ADMIN can). No way to navigate away or do anything. |
| EXPORTED invoices editable via API | FE blocks editing EXPORTED invoices, but BE `requireNotViewer` middleware doesn't check status. Direct API calls can modify EXPORTED invoice fields. |

---

## 5. CRITICAL ISSUES (Prioritized)

### P0 — Critical

| # | Issue | Type | Impact | Evidence |
|---|-------|------|--------|----------|
| 1 | **VIEWER role not assignable via UI** | Missing functionality | VIEWER users can only be created via API/seed. No UI path for tenant admins to assign, revoke, or configure VIEWER role. | CM-03: FE dropdown has 2 values; BE accepts 4. `TenantConfigTab.tsx` `onRoleChange` only passes TENANT_ADMIN or MEMBER. |
| 2 | **EXPORTED invoices editable via direct API** | Missing backend guard | Direct PATCH /invoices/{id} allows modifying parsed fields on EXPORTED invoices. FE blocks this but BE doesn't enforce status check. | `invoices.ts` PATCH handler has `requireNotViewer` but no status === EXPORTED guard. FE check in `TenantInvoicesView.tsx` only. |

### P1 — High

| # | Issue | Type | Impact | Evidence |
|---|-------|------|--------|----------|
| 3 | **TypeScript role type incomplete** | Type safety | `SessionContext.user.role` union type does not include "VIEWER". No compile-time safety for VIEWER handling. | `api.ts` type declaration and `types.ts` — VIEWER missing from role union. Runtime works because of string comparison. |
| 4 | **MEMBER on un-onboarded tenant is stuck** | Dead state | MEMBER invited to a tenant before onboarding completion sees the setup card but cannot proceed. No skip, no alternate tab, no instructions. | `App.tsx` line 639: `requiresTenantSetup && !isPlatformAdmin` renders onboarding card for all roles, but only TENANT_ADMIN can submit. |
| 5 | **No client-side file size/count validation** | Missing input validation | Users can select >50 files or files >20MB. Error only shows after upload attempt fails at multer. Poor UX. | `TenantInvoicesView.tsx` upload handler creates FormData without size/count checks. `constants.ts` defines MAX_UPLOAD_FILE_COUNT=50, MAX_UPLOAD_FILE_SIZE_BYTES=20MB but only enforced server-side. |
| 6 | **No client-side date range validation** | Missing input validation | FE allows from > to dates and dates >1 year in future. Backend rejects with 400 but no client feedback before submit. | `invoices.ts` calls `validateDateRange()` server-side. FE date inputs have no cross-field validation. |

### P2 — Medium

| # | Issue | Type | Impact | Evidence |
|---|-------|------|--------|----------|
| 7 | **Change password min length not enforced server-side** | Inconsistent validation | FE enforces 6 char min. BE route handler checks non-empty but not length. Keycloak may have its own policy. | `auth.ts` POST /auth/change-password: `if (!currentPassword \|\| !newPassword)`. No length check. |
| 8 | **Invite email validation weaker on FE** | Inconsistent validation | FE only trims email. BE checks for "@" character. Invalid emails (no @) accepted by FE, rejected by BE with 400. | `App.tsx` `handleInviteUser` trims only. `tenantAdmin.ts` and `tenantInviteService.ts` check `email.includes("@")`. |
| 9 | **No 401 auto-redirect to login** | UX gap | When session expires, user sees error message but must manually refresh or logout. No auto-redirect after delay. | `apiError.ts` normalizes 401 to error message. No session clear or redirect logic on 401 interceptor. |
| 10 | **Platform admin email validation weaker on FE** | Inconsistent validation | FE only trims. BE checks "@". | `App.tsx` `handlePlatformOnboardTenantAdmin` vs `platformAdmin.ts` route. |

### P3 — Low

| # | Issue | Type | Impact | Evidence |
|---|-------|------|--------|----------|
| 11 | **PATCH invoice no schema validation** | Missing validation | Extra/malformed fields silently ignored by BE. No contract enforcement. | `invoices.ts` PATCH handler: manual field extraction, no Zod. |
| 12 | **Bank displayName required on FE, optional on BE** | Contract drift | Minor UX friction — user must fill field that isn't required. | `api.ts` vs `bankAccounts.ts`. |
| 13 | **`failedAll` count potentially missing from response** | Potential rendering issue | Combined failure count in status filter may show 0 if BE doesn't aggregate. | `api.ts` fetchInvoices response type vs `invoices.ts` GET handler. |
