import { useMemo } from "react";
import { ActionRequiredTrigger } from "@/features/invoices/ActionRequiredTrigger";
import { TenantBadge, ActiveRealmBadge, type ClientOrgOption } from "@/components/workspace/HierarchyBadges";

interface WorkspaceTopNavProps {
  userEmail: string;
  tenantName: string;
  clientOrgs?: ClientOrgOption[];
  onOpenRealmSwitcher?: () => void;
  onLogout: () => void;
  onChangePassword: () => void;
  counts: { total: number; approved: number; pending: number; failed: number };
  themeToggle?: React.ReactNode;
  onSelectActionInvoice?: (invoiceId: string) => void;
}

export function WorkspaceTopNav({
  userEmail,
  tenantName,
  clientOrgs,
  onOpenRealmSwitcher,
  onLogout,
  onChangePassword,
  counts,
  themeToggle,
  onSelectActionInvoice
}: WorkspaceTopNavProps) {
  const avatarLabel = useMemo(() => {
    const trimmed = userEmail.trim();
    if (!trimmed) {
      return "U";
    }
    return trimmed[0].toUpperCase();
  }, [userEmail]);

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
          <ActiveRealmBadge clientOrgs={clientOrgs} onOpenSwitcher={onOpenRealmSwitcher} />
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
    </header>
  );
}
