# LedgerBuddy Design System — Import Manifest

- **Source**: `/Users/abhimanyusingh/Downloads/LedgerBuddy Design System.zip` (user-provided 2026-05-01)
- **Purpose**: Authoritative design ground truth for every Pass 2 author + reviewer.
- **Excluded**: `frontend/src/` (stale duplicate of repo code; importing would shadow live source).
- **Imported file count**: 70 (verified via `find docs/design/system -type f | wc -l`, excluding this manifest). Includes 6 v2 delta files imported 2026-05-01.

## v2 delta (imported 2026-05-01)

User provided `LedgerBuddy Design System-2.zip`. Two kinds of delta vs v1:

**6 new Platform Admin files:**
- `ui_kits/app/PlatformAdmin.css`
- `ui_kits/app/PlatformAdmin.html`
- `ui_kits/app/PlatformAdmin.jsx`
- `ui_kits/app/PlatformAdminApp.jsx`
- `ui_kits/app/PlatformAdminParts1.jsx`
- `ui_kits/app/PlatformAdminParts2.jsx`

**4 refreshed files** (v1 versions superseded by v2):
- `ui_kits/app/Login.css` — auth-shell background gradient palette swap (cool blue → warm tan); 78 new lines for `.demo-creds*` styling. Affects W3-1 Login Pass 2 (warmer palette is the production direction).
- `ui_kits/app/Login.jsx` — adds `DEMO_CREDS` object + `loginRoleFor(email)` helper for the kit's role-aware demo flow. Prototype-only; production uses Keycloak, not baked creds.
- `ui_kits/app/Login.html` — kit entry-point routes to `PlatformAdmin.html` when role === "platform". Prototype-only.
- `ui_kits/app/index.html` — same role-aware redirect addition. Prototype-only.

All other v2 files are byte-identical to v1; not re-imported.

> **Do not import any of these files into production code paths.** They are reference only. Pass 2 authors translate the JSX/CSS structure into typed React + DS-token stylesheets in `frontend/src/`; they do not copy or `import` from `docs/design/system/`.

## Imported files

```
docs/design/system/README.md
docs/design/system/SKILL.md
docs/design/system/colors_and_type.css
docs/design/system/assets/favicon.svg
docs/design/system/assets/logo.svg
docs/design/system/preview/accent_and_ink.html
docs/design/system/preview/buttons.html
docs/design/system/preview/compliance_pills.html
docs/design/system/preview/density_row.html
docs/design/system/preview/iconography.html
docs/design/system/preview/keyboard.html
docs/design/system/preview/logo.html
docs/design/system/preview/net_payable.html
docs/design/system/preview/radii_shadows.html
docs/design/system/preview/realm_hierarchy.html
docs/design/system/preview/severity.html
docs/design/system/preview/spacing.html
docs/design/system/preview/status_badges.html
docs/design/system/preview/status_colors.html
docs/design/system/preview/surfaces.html
docs/design/system/preview/type_body.html
docs/design/system/preview/type_display.html
docs/design/system/preview/ui-kit-action.png
docs/design/system/screenshots/01-mapper.png
docs/design/system/screenshots/02-mapper.png
docs/design/system/screenshots/03-mapper.png
docs/design/system/ui_kits/app/ActionRequiredQueue.jsx
docs/design/system/ui_kits/app/BankStatements.jsx
docs/design/system/ui_kits/app/ClientOrgs.jsx
docs/design/system/ui_kits/app/Dashboard.jsx
docs/design/system/ui_kits/app/DataTable.jsx
docs/design/system/ui_kits/app/DateRange.jsx
docs/design/system/ui_kits/app/InvoiceDetail.jsx
docs/design/system/ui_kits/app/Invoices.jsx
docs/design/system/ui_kits/app/Login.css
docs/design/system/ui_kits/app/Login.html
docs/design/system/ui_kits/app/Login.jsx
docs/design/system/ui_kits/app/Mailboxes.jsx
docs/design/system/ui_kits/app/NewClientOrgModal.jsx
docs/design/system/ui_kits/app/NewTallyModal.jsx
docs/design/system/ui_kits/app/NewVendorModal.jsx
docs/design/system/ui_kits/app/Payments.jsx
docs/design/system/ui_kits/app/PlatformAdmin.css
docs/design/system/ui_kits/app/PlatformAdmin.html
docs/design/system/ui_kits/app/PlatformAdmin.jsx
docs/design/system/ui_kits/app/PlatformAdminApp.jsx
docs/design/system/ui_kits/app/PlatformAdminParts1.jsx
docs/design/system/ui_kits/app/PlatformAdminParts2.jsx
docs/design/system/ui_kits/app/PreExportModal.jsx
docs/design/system/ui_kits/app/README.md
docs/design/system/ui_kits/app/RealmSwitcher.jsx
docs/design/system/ui_kits/app/Reconciliation.jsx
docs/design/system/ui_kits/app/RecordPaymentModal.jsx
docs/design/system/ui_kits/app/Sidebar.jsx
docs/design/system/ui_kits/app/StatementDetail.jsx
docs/design/system/ui_kits/app/TallySync.jsx
docs/design/system/ui_kits/app/TdsBankMapModal.jsx
docs/design/system/ui_kits/app/TdsDashboard.jsx
docs/design/system/ui_kits/app/TeamMemberModal.jsx
docs/design/system/ui_kits/app/TenantConfig.jsx
docs/design/system/ui_kits/app/TopNav.jsx
docs/design/system/ui_kits/app/Triage.jsx
docs/design/system/ui_kits/app/UserSettings.jsx
docs/design/system/ui_kits/app/Vendors.jsx
docs/design/system/ui_kits/app/VendorsV2.jsx
docs/design/system/ui_kits/app/app.css
docs/design/system/ui_kits/app/data.jsx
docs/design/system/ui_kits/app/index.html
docs/design/system/uploads/Screenshot 2026-04-28 at 5.48.57 PM.png
docs/design/system/uploads/Screenshot 2026-05-01 at 1.03.53 PM.png
```

## How to use

- **Authors** (Pass 2 design PRs): read `ui_kits/app/<Surface>.jsx` for structural reference and `colors_and_type.css` for token reference. Translate to typed React + DS-token stylesheets in `frontend/src/`.
- **Reviewers** (Pass 2 reviews): open the bundle reference side-by-side with the PR diff; flag structural drift, token drift, and rule violations from `README.md`.
- **Surface mapping**: see `docs/design/DESIGN-OVERHAUL-PLAN.md` "Surface inventory" table, "Bundle reference" column.
- **Discipline rule**: `~/.claude/projects/-Users-abhimanyusingh-IdeaProjects-LedgerBuddy/memory/feedback_design_system_fidelity.md`.
