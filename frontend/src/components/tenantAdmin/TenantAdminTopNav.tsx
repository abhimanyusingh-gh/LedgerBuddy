import { useMemo, useState } from "react";

interface TenantAdminTopNavProps {
  userEmail: string;
  onLogout: () => void;
}

export function TenantAdminTopNav({ userEmail, onLogout }: TenantAdminTopNavProps) {
  const [searchValue, setSearchValue] = useState("");
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
          <h2>FinParse</h2>
        </div>
        <div className="tenant-nav-divider" />
        <nav aria-label="Workspace navigation" className="tenant-nav-links">
          <button type="button" className="tenant-nav-link tenant-nav-link-active">
            Dashboard
          </button>
        </nav>
      </div>

      <div className="tenant-top-nav-right">
        <label className="tenant-search" aria-label="Search invoices">
          <span className="material-symbols-outlined">search</span>
          <input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            type="text"
            placeholder="Search invoices..."
          />
        </label>
        <button type="button" className="tenant-icon-button" aria-label="Notifications">
          <span className="material-symbols-outlined">notifications</span>
        </button>
        <button type="button" className="tenant-icon-button" aria-label="Settings">
          <span className="material-symbols-outlined">settings</span>
        </button>
        <div className="tenant-avatar" aria-label={`Signed in as ${userEmail}`} title={userEmail}>
          {avatarLabel}
        </div>
        <button type="button" className="app-button app-button-secondary" onClick={onLogout}>
          Logout
        </button>
      </div>
    </header>
  );
}
