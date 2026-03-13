interface PlatformAdminTopNavProps {
  userEmail: string;
  onLogout: () => void;
  onChangePassword: () => void;
  counts: { tenants: number; failedDocuments: number };
}

export function PlatformAdminTopNav({ userEmail, onLogout, onChangePassword, counts }: PlatformAdminTopNavProps) {
  return (
    <header className="platform-top-nav">
      <div className="platform-top-nav-left">
        <div className="platform-brand">
          <div className="platform-brand-icon">
            <span className="material-symbols-outlined">account_balance</span>
          </div>
          <h2>BillForge</h2>
        </div>
        <div className="tenant-nav-divider" />
        <span className="toolbar-icon-wrap">
          <span className="tenant-nav-stat">{counts.tenants} tenants</span>
          <span className="toolbar-icon-label platform-failed-label">
            {counts.failedDocuments} failed
          </span>
        </span>
      </div>

      <div className="platform-top-nav-right">
        <div className="platform-account">
          <span>Platform Admin</span>
          <strong>{userEmail}</strong>
        </div>
        <button type="button" className="app-button app-button-secondary" onClick={onChangePassword}
          aria-label="Settings" title="Change Password">
          <span className="material-symbols-outlined">settings</span>
        </button>
        <button type="button" className="app-button app-button-primary" onClick={onLogout}>
          <span className="material-symbols-outlined">logout</span>
          Logout
        </button>
      </div>
    </header>
  );
}
