export function LoginBrandPanel() {
  return (
    <aside className="login-brand-panel" aria-hidden="true">
      <div className="login-brand-overlay" />
      <div className="login-brand-content">
        <div className="login-brand-header">
          <span className="material-symbols-outlined">analytics</span>
          <h1>LedgerBuddy</h1>
        </div>

        <div className="login-brand-copy">
          <h2>
            Intelligent Invoice
            <br />
            Processing for Modern Teams.
          </h2>
          <p>Automate your accounts payable with AI-driven extraction and seamless ERP integration.</p>
        </div>
      </div>
      <div className="login-brand-orb login-brand-orb-bottom" />
      <div className="login-brand-orb login-brand-orb-top" />
    </aside>
  );
}
