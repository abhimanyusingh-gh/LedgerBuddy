import { useMemo } from "react";

interface TenantAdminTopNavProps {
  userEmail: string;
  onLogout: () => void;
  onChangePassword: () => void;
  counts: { total: number; approved: number; pending: number };
}

export function TenantAdminTopNav({ userEmail, onLogout, onChangePassword, counts }: TenantAdminTopNavProps) {
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
          <h2>BillForge</h2>
        </div>
        <div className="tenant-nav-divider" />
        <span className="toolbar-icon-wrap">
          <span className="tenant-nav-stat">{counts.total} invoices</span>
          <span className="toolbar-icon-label">{counts.approved} approved, {counts.pending} pending review</span>
        </span>
      </div>

      <div className="tenant-top-nav-right">
        <div className="tenant-avatar" aria-label={`Signed in as ${userEmail}`} title={userEmail}>
          {avatarLabel}
        </div>
        <button type="button" className="app-button app-button-secondary" onClick={onChangePassword}
          aria-label="Settings" title="Change Password">
          <span className="material-symbols-outlined">settings</span>
        </button>
        <button type="button" className="app-button app-button-secondary" onClick={onLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
