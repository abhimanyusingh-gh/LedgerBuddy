# LedgerBuddy Design Overhaul Plan

Anchored at the user-provided design system bundle (imported 2026-05-01 to `docs/design/system/`).

## Canvas reference

Canvas = `docs/design/system/`.

Every Pass 2 author + reviewer reads `docs/design/system/ui_kits/app/<Surface>.jsx` as the **structural** reference and `docs/design/system/colors_and_type.css` as the **token** reference. `docs/design/system/README.md` is the **rules** reference (32px row default, Indian numerals, Material Symbols only, no glassmorphism, light + dark parity, fixed status taxonomy, JetBrains Mono for amounts).

The user directive (2026-05-01) is **"I want the design to be precisely this"** — visual/structural fidelity to the bundle is non-negotiable. The earlier canvas-URL approach (`reference_design_canvas.md`) is superseded; remote canvas fetches were auth-gated and unreliable. The local bundle is now the ground truth.

> Discipline memory: see `~/.claude/projects/-Users-abhimanyusingh-IdeaProjects-LedgerBuddy/memory/feedback_design_system_fidelity.md`. Every Pass 2 author/reviewer brief includes its application section verbatim.

## Locked decisions

| # | Question | Locked answer |
|---|---|---|
| Q1 | Canvas access | RESOLVED — bundle at `docs/design/system/` replaces canvas URL. Per-PR sections anchor at `docs/design/system/ui_kits/app/<Surface>.jsx`. |
| Q2 | Refresh scope | **THOROUGH** — every already-passed surface gets a refresh PR diffed against the bundle (Chrome / Mailboxes / Client Orgs / Triage / Tenant Config / Action Required / Invoice Detail / Dashboard). |
| Q3 | InvoiceView snapshot | **YES** — a small `W3-7-pre` PR adds snapshot integration tests against current `InvoiceView` before the W3-7 decomposition. Captures behavior so the decomposition has a regression guard. |
| Q4 | `GlCodeDropdown` | **DELETE + dual-rebind in W2-1** — remove `frontend/src/components/compliance/GlCodeDropdown.tsx`; both InvoiceDetail and TenantConfig consume `<Combobox />` directly. No thin wrapper. File budget: still ≤20 for W2-1. |
| Q5 | Bundle-size headroom | **Track per-PR bundle delta in PR body**. The W4 revert of the `+100 KiB` headroom is **CONDITIONAL** on cumulative net delta after W3 being negative; otherwise the headroom stays. |
| Q6 | Platform admin | **IN SCOPE** (re-scoped 2026-05-01 after user provided platform admin designs in v2 bundle). Covered by new W3-13. |

## Surface inventory

Bundle reference column = path inside `docs/design/system/ui_kits/app/` unless noted.

| Surface | Bundle reference | Notes |
|---|---|---|
| Login | `Login.jsx` + `Login.css` + `Login.html` | Auth entry; bundle ships standalone HTML/CSS for marketing-style surface. |
| Onboarding / Signup | `Login.jsx` (signup variant — same shell, no dedicated onboarding kit in bundle) | If onboarding flow requires multi-step wizard, derive shell density from `Login.jsx` and step pattern from `PreExportModal.jsx` (multi-step modal idiom). Flag in PR body. |
| Sidebar | `Sidebar.jsx` | Chrome left rail. |
| TopNav | `TopNav.jsx` | Chrome top bar. |
| RealmSwitcher | `RealmSwitcher.jsx` | Cmd-K palette. |
| Dashboard | `Dashboard.jsx` | KPI cards + recent activity. |
| Action Required | `ActionRequiredQueue.jsx` | Default AP Clerk landing. |
| Invoices list | `Invoices.jsx` | Master list; pair with `DataTable.jsx` for table primitive. |
| Invoice Detail | `InvoiceDetail.jsx` | Split view; Source PDF + Extracted Fields + Compliance + Net Payable + Workflow Timeline + Risk Signals + Tally Mapping. |
| Reconciliation | `Reconciliation.jsx` + `BankStatements.jsx` + `StatementDetail.jsx` | Split-pane bank txns vs candidate invoices. |
| Mailboxes | `Mailboxes.jsx` | Tenant-level mailbox roster. |
| Triage | `Triage.jsx` | Cross-client-org ambiguity inbox. |
| Tenant Config | `TenantConfig.jsx` + `UserSettings.jsx` | Settings shell; `UserSettings.jsx` for the user-scoped sub-surface. |
| Connections (bank) | `BankStatements.jsx` | Shares chrome with Reconciliation; verify if a dedicated "Connections" kit emerges. |
| Vendors list | `VendorsV2.jsx` (chosen direction) | `Vendors.jsx` is the older variant; pick V2. Both retained in bundle for diff context. |
| Vendor detail | derived from `VendorsV2.jsx` patterns + `NewVendorModal.jsx` | No dedicated detail file in bundle; reuse list-row visual patterns + modal idiom. Flag any structural invention in PR body. |
| Exports — Tally | `TallySync.jsx` + `PreExportModal.jsx` | Full export flow + pre-flight checklist modal. |
| TDS Dashboard | `TdsDashboard.jsx` | Section-wise TDS aggregations. |
| Client Orgs | `ClientOrgs.jsx` + `NewClientOrgModal.jsx` | List + create modal. |
| Payments | `Payments.jsx` + `RecordPaymentModal.jsx` | Phase 3 surface. |
| Platform admin | `PlatformAdmin.jsx` + `PlatformAdmin.html` + `PlatformAdmin.css` + `PlatformAdminApp.jsx` + `PlatformAdminParts1.jsx` + `PlatformAdminParts2.jsx` | Platform-admin shell with separate HTML/CSS scaffold (similar to Login). Phase 0-2 surfaces under `frontend/src/features/platform-admin/`: PlatformAdminTopNav, PlatformActivityMonitor, PlatformOnboardSection, PlatformUsageOverviewSection, PlatformAnalyticsDashboard, PlatformSection. |
| New Tally connection | `NewTallyModal.jsx` | Connection-creation modal. |
| TDS bank mapping | `TdsBankMapModal.jsx` | Settings-scoped modal. |
| Team member | `TeamMemberModal.jsx` | Invite + role assignment modal. |

Shared primitives in the bundle: `DataTable.jsx`, `DateRange.jsx`, `data.jsx` (fixtures), `app.css` (shell styles).

## Wave plan (19 PRs total)

### Wave 1 — Token + DS foundation (1 PR)

**W1-1 — Adopt bundle tokens into DS** (FE, ≤20 files)
- Diff `docs/design/system/colors_and_type.css` against `frontend/src/styles.css`; reconcile every CSS custom property (light + dark).
- Add any net-new tokens (severity ramp, status taxonomy, JetBrains Mono amount style).
- Update `frontend/src/components/ds/` primitives only where the bundle introduces a new variant slot — no surface-level migration in this PR.
- Bundle reference: `docs/design/system/colors_and_type.css`, `docs/design/system/preview/*` (token previews).
- Bundle delta: tracked in PR body.

### Wave 2 — DS primitive rebinds (3 PRs)

**W2-1 — GlCode → Combobox dual-rebind** (FE, ≤20 files)
- Delete `frontend/src/components/compliance/GlCodeDropdown.tsx`.
- Both InvoiceDetail and TenantConfig call sites consume `<Combobox />` directly (per the existing `Combobox` API in the DS).
- Update tests at the call sites; remove orphaned tests for the deleted wrapper.
- Bundle reference: `docs/design/system/ui_kits/app/InvoiceDetail.jsx`, `docs/design/system/ui_kits/app/TenantConfig.jsx`.

**W2-2 — DataTable primitive alignment** (FE, ≤20 files)
- Reconcile `frontend/src/components/ds/DataTable.tsx` against `docs/design/system/ui_kits/app/DataTable.jsx`.
- Density (32px row default), header treatment, sort affordance, sticky-column behaviour.
- No surface-level adoption in this PR — primitive only; downstream surfaces in W3.

**W2-3 — DateRange + status badges primitive alignment** (FE, ≤20 files)
- `DateRange.jsx` → DS primitive.
- Status badge taxonomy (`docs/design/system/preview/status_badges.html`) baked into the DS `<StatusBadge>` component.

### Wave 3 — Surface Pass-2 (13 PRs)

> Each Wave-3 PR is a Pass 2 design PR per `feedback_fe_functional_design_split.md`. File budget ≤20. Bundle delta in PR body.

**W3-1 — Login + Auth shell Pass 2** — bundle: `Login.jsx` + `Login.css` + `Login.html`.

**W3-2 — Invoices list Pass 2** — bundle: `Invoices.jsx` + `DataTable.jsx`.

**W3-3 — Reconciliation split-pane Pass 2** — bundle: `Reconciliation.jsx` + `BankStatements.jsx` + `StatementDetail.jsx`.

**W3-4 — Vendors list + detail Pass 2** — bundle: `VendorsV2.jsx` + `NewVendorModal.jsx` (detail derived from list-row patterns).

**W3-5 — Tally export flow Pass 2** — bundle: `TallySync.jsx` + `PreExportModal.jsx` + `NewTallyModal.jsx`.

**W3-6 — TDS Dashboard Pass 2** — bundle: `TdsDashboard.jsx` + `TdsBankMapModal.jsx`.

**W3-7-pre — InvoiceView snapshot integration tests** (FE, ≤5 files)
- Capture current InvoiceView behavior under integration-style snapshot tests so the W3-7 decomposition has a regression guard.
- Files: `InvoiceView.snapshot.test.tsx`, `InvoiceView.fixtures.ts`, possibly a `jest.setup.ts` tweak.
- Lands BEFORE W3-7. Per `feedback_test_value_per_pr.md`, justify each new test file in PR body.

**W3-7 — InvoiceView decomposition + Pass 2** — bundle: `InvoiceDetail.jsx`. Decomposes the existing monolithic InvoiceView; W3-7-pre snapshots gate behavior.

**W3-8 — Already-passed-surface refresh batch A** — Action Required + Triage + Dashboard + Invoice Detail (chrome-only diff, no logic) — bundles: `ActionRequiredQueue.jsx`, `Triage.jsx`, `Dashboard.jsx`, `InvoiceDetail.jsx` (chrome).

**W3-9 — Chrome refresh** (Sidebar + TopNav + RealmSwitcher diffed against bundle) — bundles: `Sidebar.jsx`, `TopNav.jsx`, `RealmSwitcher.jsx`.

**W3-10 — Mailboxes refresh** — bundle: `Mailboxes.jsx`.

**W3-11 — Client Orgs refresh** — bundles: `ClientOrgs.jsx` + `NewClientOrgModal.jsx`.

**W3-13 — Platform admin Pass 2** — bundle: `PlatformAdmin.{jsx,html,css}` + `PlatformAdminApp.jsx` + `PlatformAdminParts{1,2}.jsx`. Scope: `frontend/src/features/platform-admin/{PlatformAdminTopNav,PlatformActivityMonitor,PlatformOnboardSection,PlatformUsageOverviewSection,PlatformAnalyticsDashboard,PlatformSection}.tsx`. Bundle ships standalone HTML/CSS shell similar to Login — translate Parts1/Parts2 into our typed React; consume DS primitives from W1+W2; preserve existing routing + auth gating; no functional changes.

> Tenant Config, Payments, and TeamMemberModal map to phase-aligned surfaces; their Pass 2 work lands inside the relevant phase issue (not a standalone W3 PR).

### Wave 4 — Cleanup (2 PRs)

**W4-1 — Revert +100 KiB bundle-size headroom** (FE, ≤5 files, CONDITIONAL)
- **CONDITIONAL** on cumulative bundle-size delta after W3 being **negative**.
- If cumulative delta is positive or zero, the +100 KiB headroom **stays** and this PR is skipped (record the call in the wave wrap-up).
- If cumulative delta is negative, revert the temporary headroom in `frontend/<bundle-budget-config>` (verify path at execution time).

**W4-2 — Prune redundant design-system reference files** (docs-only, ≤10 file deletions, MANDATORY)
- Issue: **#388**.
- Once Wave 1-3 land, ~60 of the 64 imported reference files in `docs/design/system/` become redundant — JSX recreations have been translated into our typed React; prototype CSS mirrored in `frontend/src/styles.css`; preview HTML cards no longer needed for QA.
- **Delete** (5 directories):
  - `docs/design/system/ui_kits/` (33 JSX + `app.css` + `index.html` + `Login.html/css` + per-surface README)
  - `docs/design/system/preview/` (16 token preview HTML cards + `ui-kit-action.png`)
  - `docs/design/system/screenshots/` (3 PNG)
  - `docs/design/system/uploads/` (2 PNG)
  - `docs/design/system/assets/` (logo + favicon — duplicates of `frontend/public/`)
- **Keep** (4 files, load-bearing forever):
  - `docs/design/system/README.md` — design manifesto + content rules + visual foundations + hard rules (no-emoji, Indian numerals, Material Symbols only, 32px row default, light+dark parity, fixed status taxonomy)
  - `docs/design/system/SKILL.md` — agent skill manifest
  - `docs/design/system/colors_and_type.css` — canonical token reference for any future redesign
  - `docs/design/system/IMPORT-MANIFEST.md` — provenance record (add `Pruned <YYYY-MM-DD>, see #388` header noting that the manifest now describes the original bundle, not the current state)
- Update `feedback_design_system_fidelity.md` memory to note that bundle JSX kits no longer exist post-prune (token + manifesto refs still valid).
- Verify no live code/docs reference deleted files: `git grep "docs/design/system/ui_kits\|docs/design/system/preview\|docs/design/system/screenshots\|docs/design/system/uploads"` should return zero hits.

## PR count summary

| Wave | PRs |
|---|---|
| W1 | 1 |
| W2 | 3 |
| W3 | 13 (W3-1 … W3-8 + W3-7-pre + W3-9 + W3-10 + W3-11 + W3-13) |
| W4 | 2 (W4-1 conditional, W4-2 mandatory) |
| **Total** | **19** |

Average files/PR: each ≤20 per `feedback_pr_workflow.md`. W3-7-pre, W4-1, and W4-2 are deliberately small (≤5-10 files each).

## Discipline reminders (apply to every Wave-2/3/4 PR)

- `feedback_design_system_fidelity.md` — bundle is the structural + token reference; replicate precisely.
- `feedback_no_inline_css.md` — no inline `style={{}}`, even when the bundle prototype uses it.
- `feedback_fe_functional_design_split.md` — Pass 2 is design-only; no functional changes bundled in.
- `reference_url_abstraction_directive.md` — typed URL provider for any URL touch.
- `feedback_type_safety_per_pr.md` — branded types for semantic IDs; no raw `string`.
- `feedback_code_reuse.md` — extend DS primitives before inventing new ones.
- `feedback_exports_only_when_consumed.md` — knip-clean.
- `feedback_pr_workflow.md` — ≤20 files per PR; never merge; raise PR and stop for user review.
- `feedback_full_test_suite_before_pr.md` — full BE + FE jest before push.
- `feedback_reviewer_per_pr.md` — bot reviewer agent per PR; opens side-by-side diff vs bundle reference.
