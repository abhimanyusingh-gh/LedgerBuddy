interface PlatformAdminTopNavProps {
  userEmail: string;
  onLogout: () => void;
}

export function PlatformAdminTopNav({ userEmail, onLogout }: PlatformAdminTopNavProps) {
  return (
    <header className="platform-top-nav">
      <div className="platform-top-nav-left">
        <div className="platform-brand">
          <div className="platform-brand-icon">
            <span className="material-symbols-outlined">account_balance</span>
          </div>
          <h2>BillForge</h2>
        </div>
      </div>

      <div className="platform-top-nav-right">
        <div className="platform-account">
          <span>Platform Admin</span>
          <strong>{userEmail}</strong>
        </div>
        <button type="button" className="app-button app-button-primary" onClick={onLogout}>
          <span className="material-symbols-outlined">logout</span>
          Logout
        </button>
      </div>
    </header>
  );
}
