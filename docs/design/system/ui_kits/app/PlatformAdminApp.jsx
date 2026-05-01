// PlatformAdminApp.jsx — composes the platform admin console
function PlatformAdminApp({ onSwitchToTenant, dark, onToggleTheme }) {
  const [tab, setTab] = React.useState("dashboard");
  const [selectedId, setSelectedId] = React.useState(null);
  const [tenants, setTenants] = React.useState(window.PA_TENANTS);
  const [success, setSuccess] = React.useState(null);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all");

  const counts = {
    tenants: tenants.length,
    failedDocuments: window.PA_FAILED_DOCS.length,
  };
  const selected = tenants.find(t => t.id === selectedId);
  const onToggleEnabled = (id, enable) =>
    setTenants(ts => ts.map(t => t.id === id ? { ...t, state: enable ? "active" : "disabled" } : t));

  return (
    <div className="pa-shell" data-screen-label={"Platform admin · " + tab}>
      <PlatformAdminTopNav activeTab={tab} onTabChange={setTab} counts={counts} onSwitchToTenant={onSwitchToTenant} dark={dark} onToggleTheme={onToggleTheme} />
      <main className="pa-main">
        {tab === "dashboard" && (
          <>
            <PlatformKpis tenants={tenants} />
            <div className="pa-row-grid">
              <div className="pa-card">
                <div className="pa-card-head">
                  <span className="material-symbols-outlined" style={{ color: "var(--accent)" }}>insights</span>
                  <h2>Documents processed · 14 days</h2>
                  <span className="pa-card-sub">across all tenants</span>
                </div>
                <div className="pa-card-body">
                  <PlatformChart docs={window.PA_DOCS_14D} fails={window.PA_FAIL_14D} />
                </div>
              </div>
              <PlatformActivityMonitor activity={window.PA_ACTIVITY.slice(0, 8)} scope="all tenants" />
            </div>
            <PlatformTenantsTable tenants={tenants} selectedId={selectedId} onSelect={setSelectedId} onToggleEnabled={onToggleEnabled} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />
          </>
        )}
        {tab === "tenants" && (
          <PlatformTenantsTable tenants={tenants} selectedId={selectedId} onSelect={setSelectedId} onToggleEnabled={onToggleEnabled} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />
        )}
        {tab === "failed" && (
          <PlatformFailedDocs docs={window.PA_FAILED_DOCS} />
        )}
        {tab === "activity" && (
          <PlatformActivityMonitor activity={window.PA_ACTIVITY} scope="all tenants" />
        )}
        {tab === "onboard" && (
          <PlatformOnboardSection inline success={success} onCreated={setSuccess} onDismissSuccess={() => setSuccess(null)} />
        )}
      </main>
      {selected ? <PlatformTenantDetail tenant={selected} onClose={() => setSelectedId(null)} onToggleEnabled={onToggleEnabled} /> : null}
    </div>
  );
}
window.PlatformAdminApp = PlatformAdminApp;
