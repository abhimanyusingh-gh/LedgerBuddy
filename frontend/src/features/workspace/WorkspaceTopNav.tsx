import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionRequiredTrigger } from "@/features/invoices/ActionRequiredTrigger";
import { TenantBadge, ActiveRealmBadge, type ClientOrgOption } from "@/components/workspace/HierarchyBadges";
import { RealmSwitcher } from "@/features/workspace/RealmSwitcher";
import { useTenantClientOrgs } from "@/hooks/useTenantClientOrgs";

export const REALM_SWITCHER_SHORTCUT = {
  key: "k",
  withMeta: true
} as const;

interface WorkspaceTopNavProps {
  userEmail: string;
  tenantName: string;
  onLogout: () => void;
  onChangePassword: () => void;
  counts: { total: number; approved: number; pending: number; failed: number };
  themeToggle?: React.ReactNode;
  onSelectActionInvoice?: (invoiceId: string) => void;
  onGoToOnboarding?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable;
}

export function WorkspaceTopNav({
  userEmail,
  tenantName,
  onLogout,
  onChangePassword,
  counts,
  themeToggle,
  onSelectActionInvoice,
  onGoToOnboarding
}: WorkspaceTopNavProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const { clientOrgs, isLoading, isError, refetch } = useTenantClientOrgs();

  const openSwitcher = useCallback(() => setSwitcherOpen(true), []);
  const closeSwitcher = useCallback(() => setSwitcherOpen(false), []);

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      const isShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === REALM_SWITCHER_SHORTCUT.key;
      if (!isShortcut) return;
      if (isEditableTarget(event.target)) {
        const tag = (event.target as HTMLElement).tagName.toLowerCase();
        if (tag !== "input" && tag !== "textarea") return;
      }
      event.preventDefault();
      setSwitcherOpen((prev) => !prev);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const avatarLabel = useMemo(() => {
    const trimmed = userEmail.trim();
    if (!trimmed) return "U";
    return trimmed[0].toUpperCase();
  }, [userEmail]);

  const badgeOrgs: ClientOrgOption[] | undefined = isLoading || isError ? undefined : clientOrgs;

  return (
    <header className="tenant-top-nav">
      <div className="tenant-top-nav-left">
        <div className="tenant-brand">
          <div className="tenant-brand-icon">
            <span className="material-symbols-outlined">account_balance_wallet</span>
          </div>
          <h2>LedgerBuddy</h2>
        </div>
        <div className="tenant-nav-divider" />
        <span className="workspace-hierarchy-badges" data-testid="workspace-hierarchy-badges">
          <TenantBadge tenantName={tenantName} />
          <span className="workspace-hierarchy-badge-separator" aria-hidden="true">·</span>
          <ActiveRealmBadge clientOrgs={badgeOrgs} onOpenSwitcher={openSwitcher} />
        </span>
        <div className="tenant-nav-divider" />
        <span className="toolbar-icon-wrap">
          <span className="tenant-nav-stat">{counts.total} invoices</span>
          <span className="toolbar-icon-label">
            {counts.approved} approved, {counts.pending} pending
            {counts.failed > 0 ? <span className="nav-failed-badge">, {counts.failed} failed</span> : null}
          </span>
        </span>
      </div>

      <div className="tenant-top-nav-right">
        <ActionRequiredTrigger onSelectInvoice={onSelectActionInvoice} />
        {themeToggle ?? null}
        <div className="tenant-avatar" aria-label={`Signed in as ${userEmail}`} title={userEmail}>
          {avatarLabel}
        </div>
        <button type="button" className="app-button app-button-secondary" onClick={onChangePassword}
          aria-label="Change Password" title="Change Password">
          <span className="material-symbols-outlined">key</span>
        </button>
        <button type="button" className="app-button app-button-secondary" onClick={onLogout}>
          Logout
        </button>
      </div>

      <RealmSwitcher
        open={switcherOpen}
        onClose={closeSwitcher}
        clientOrgs={clientOrgs}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => { void refetch(); }}
        onGoToOnboarding={onGoToOnboarding}
      />
    </header>
  );
}
