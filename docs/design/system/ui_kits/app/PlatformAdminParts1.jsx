// PlatformAdminTopNav.jsx — distinct top nav for the LedgerBuddy super-admin console
function PlatformAdminTopNav({ activeTab, onTabChange, counts, onSwitchToTenant, onToggleTheme, dark }) {
  const tab = (id, icon, label, badge) => (
    <button className={"pa-tab" + (activeTab === id ? " active" : "")} onClick={() => onTabChange(id)}>
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
      <span>{label}</span>
      {badge ? <span className="pa-tab-badge">{badge}</span> : null}
    </button>
  );
  return (
    <header className="pa-topnav">
      <div className="brand-row">
        <span className="pa-mark">₹</span>
        <span className="pa-name">LedgerBuddy</span>
        <span className="pa-scope-pill">
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>shield_person</span>
          Platform admin
        </span>
      </div>
      <div className="pa-tabs">
        {tab("dashboard", "dashboard", "Overview")}
        {tab("tenants", "groups", "Tenants", counts.tenants)}
        {tab("failed", "error", "Failed documents", counts.failedDocuments)}
        {tab("activity", "schedule", "Activity")}
        {tab("onboard", "add_business", "Onboard")}
      </div>
      <div className="pa-spacer" />
      <div className="pa-search">
        <span className="material-symbols-outlined">search</span>
        <input placeholder="Search tenants, users, documents…" />
        <span className="lb-kbd">/</span>
      </div>
      <button className="iconbtn" onClick={onSwitchToTenant} title="Switch to tenant view">
        <span className="material-symbols-outlined">swap_horiz</span>
      </button>
      <button className="iconbtn" onClick={onToggleTheme} title="Toggle theme">
        <span className="material-symbols-outlined">{dark ? "light_mode" : "dark_mode"}</span>
      </button>
      <div style={{ width: 32, height: 32, borderRadius: 999, border: "1px solid var(--line)", background: "var(--accent-soft-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 12px var(--font-sans)" }}>OP</div>
    </header>
  );
}
window.PlatformAdminTopNav = PlatformAdminTopNav;

// PlatformKpis.jsx — KPI hero strip
function PlatformKpis({ tenants }) {
  const active = tenants.filter(t => t.state === "active").length;
  const trial = tenants.filter(t => t.state === "trial").length;
  const disabled = tenants.filter(t => t.state === "disabled").length;
  const totalDocs = tenants.reduce((a, t) => a + t.docsToday, 0);
  const totalFails = tenants.reduce((a, t) => a + t.failedDocs, 0);
  const failPct = ((totalFails / Math.max(totalDocs, 1)) * 100).toFixed(1);
  const totalMrr = tenants.reduce((a, t) => a + t.mrr, 0);
  const seatsSold = tenants.reduce((a, t) => a + t.seats, 0);
  const seatsUsed = tenants.reduce((a, t) => a + t.seatsUsed, 0);
  const bridgeOk = tenants.filter(t => t.bridge === "online").length;
  const bridgeBad = tenants.length - bridgeOk;
  return (
    <div className="pa-kpi-grid">
      <div className="pa-kpi">
        <div className="pa-kpi-label">Tenants</div>
        <div className="pa-kpi-value">{tenants.length}</div>
        <div className="pa-kpi-sub">{active} active · {trial} trial · {disabled} disabled</div>
      </div>
      <div className="pa-kpi accent">
        <div className="pa-kpi-label">MRR</div>
        <div className="pa-kpi-value">₹ {totalMrr.toLocaleString("en-IN")}</div>
        <div className="pa-kpi-sub"><span className="pa-kpi-up">▲ 8.2%</span> vs last month</div>
      </div>
      <div className="pa-kpi">
        <div className="pa-kpi-label">Seats sold</div>
        <div className="pa-kpi-value">{seatsSold}</div>
        <div className="pa-kpi-sub">{seatsUsed} active · {Math.round((seatsUsed/seatsSold)*100)}% utilization</div>
      </div>
      <div className="pa-kpi">
        <div className="pa-kpi-label">Docs · today</div>
        <div className="pa-kpi-value">{totalDocs.toLocaleString("en-IN")}</div>
        <div className="pa-kpi-sub"><span className="pa-kpi-up">▲ 14%</span> vs 7-day avg</div>
      </div>
      <div className="pa-kpi alert">
        <div className="pa-kpi-label">Failed · today</div>
        <div className="pa-kpi-value">{totalFails}</div>
        <div className="pa-kpi-sub">{failPct}% failure rate · threshold 3%</div>
      </div>
      <div className="pa-kpi">
        <div className="pa-kpi-label">Tally bridges</div>
        <div className="pa-kpi-value" style={{ color: bridgeBad ? "var(--amber)" : "var(--emerald)" }}>{bridgeOk}<span style={{ color: "var(--ink-muted)", font: "500 14px var(--font-mono)" }}> / {tenants.length}</span></div>
        <div className="pa-kpi-sub">{bridgeBad} offline or lagging</div>
      </div>
    </div>
  );
}
window.PlatformKpis = PlatformKpis;

// PlatformChart.jsx — 14-day documents + failures stacked bar chart
function PlatformChart({ docs, fails }) {
  const max = Math.max(...docs);
  const W = 560, H = 180, pad = 24;
  const barW = (W - pad * 2) / docs.length - 4;
  return (
    <div>
      <svg className="pa-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {/* gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <line key={i} x1={pad} x2={W - pad} y1={pad + (H - pad * 2) * p} y2={pad + (H - pad * 2) * p}
                stroke="var(--line-soft)" strokeDasharray={p === 1 ? "" : "2,3"} />
        ))}
        {docs.map((v, i) => {
          const h = (v / max) * (H - pad * 2);
          const fh = (fails[i] / max) * (H - pad * 2);
          const x = pad + i * (barW + 4);
          const y = H - pad - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={h - fh} rx="2" fill="var(--accent)" opacity="0.85" />
              <rect x={x} y={H - pad - fh} width={barW} height={fh} rx="2" fill="var(--warn)" />
              {i === docs.length - 1 ? (
                <text x={x + barW / 2} y={y - 6} textAnchor="middle"
                      style={{ font: "700 10px var(--font-mono)", fill: "var(--ink)" }}>{v}</text>
              ) : null}
            </g>
          );
        })}
        {/* x-axis labels */}
        <text x={pad} y={H - 6} style={{ font: "500 10px var(--font-mono)", fill: "var(--ink-muted)" }}>14 d ago</text>
        <text x={W - pad} y={H - 6} textAnchor="end" style={{ font: "500 10px var(--font-mono)", fill: "var(--ink-muted)" }}>today</text>
      </svg>
      <div className="pa-chart-legend">
        <span><span className="pa-legend-dot" style={{ background: "var(--accent)" }} />Documents processed</span>
        <span><span className="pa-legend-dot" style={{ background: "var(--warn)" }} />OCR / parse failures</span>
      </div>
    </div>
  );
}
window.PlatformChart = PlatformChart;

// PlatformOnboardSection.jsx — create new tenant + first admin user
function PlatformOnboardSection({ inline, success, onCreated, onDismissSuccess }) {
  const [form, setForm] = React.useState({ tenantName: "", adminEmail: "", adminName: "", plan: "Practice", region: "Mumbai", seats: 8 });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const ready = form.tenantName.length > 2 && /\S+@\S+\.\S+/.test(form.adminEmail) && form.adminName.length > 1;
  return (
    <div className="pa-card" style={inline ? { margin: 0, marginBottom: 14 } : {}}>
      <div className="pa-card-head">
        <span className="material-symbols-outlined" style={{ color: "var(--accent)" }}>add_business</span>
        <h2>Onboard new tenant</h2>
        <span className="pa-card-sub">Creates a tenant org + first admin user. The admin receives a temporary password.</span>
      </div>
      {success ? (
        <div className="pa-success-banner">
          <span className="material-symbols-outlined" style={{ color: "var(--emerald)" }}>check_circle</span>
          <span><b>{success.tenantName}</b> created. Temporary password for <code className="pa-temp-pw">{success.adminEmail}</code>: <code className="pa-temp-pw">{success.tempPassword}</code></span>
          <button className="pa-btn pa-btn-ghost pa-btn-sm" style={{ marginLeft: "auto" }} onClick={onDismissSuccess}>Dismiss</button>
        </div>
      ) : null}
      <div className="pa-card-body">
        <div className="pa-onboard">
          <label>Tenant name<input value={form.tenantName} onChange={e => set("tenantName", e.target.value)} placeholder="e.g. Khan & Associates, CA" /></label>
          <label>Admin name<input value={form.adminName} onChange={e => set("adminName", e.target.value)} placeholder="Mahir Khan" /></label>
          <label>Admin email<input value={form.adminEmail} onChange={e => set("adminEmail", e.target.value)} placeholder="admin@firm.in" /></label>
          <label>Plan
            <select value={form.plan} onChange={e => set("plan", e.target.value)}>
              <option>Solo</option><option>Practice</option><option>Enterprise</option>
            </select>
          </label>
          <label>Region
            <select value={form.region} onChange={e => set("region", e.target.value)}>
              {["Mumbai","Bangalore","Delhi","Pune","Ahmedabad","Chennai","Kolkata","Hyderabad","Gurgaon","Other"].map(r=><option key={r}>{r}</option>)}
            </select>
          </label>
          <label>Seats<input type="number" min={1} value={form.seats} onChange={e => set("seats", Number(e.target.value))} /></label>
        </div>
        <div className="pa-onboard-actions">
          <span style={{ font: "500 11.5px var(--font-sans)", color: "var(--ink-soft)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: "middle", marginRight: 4 }}>info</span>
            Welcome email sent to <b style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{form.adminEmail || "admin@…"}</b> with sign-in link.
          </span>
          <span style={{ marginLeft: "auto" }} />
          <button className="pa-btn pa-btn-ghost" onClick={() => setForm({ tenantName: "", adminEmail: "", adminName: "", plan: "Practice", region: "Mumbai", seats: 8 })}>Reset</button>
          <button className="pa-btn pa-btn-primary" disabled={!ready} style={!ready ? { opacity: .5, cursor: "not-allowed" } : {}}
                  onClick={() => ready && onCreated({ tenantName: form.tenantName, adminEmail: form.adminEmail, tempPassword: "Tmp-" + Math.random().toString(36).slice(2, 10) + "!" })}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span> Create tenant
          </button>
        </div>
      </div>
    </div>
  );
}
window.PlatformOnboardSection = PlatformOnboardSection;
