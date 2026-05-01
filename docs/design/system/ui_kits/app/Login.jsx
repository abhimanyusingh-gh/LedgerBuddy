// Login.jsx — auth gate for LedgerBuddy. States: signin, magic_sent, forgot,
// reset, twofa, twofa_setup, invite, locked, signed_out.
// Caller passes `state` + `onAuthenticated` (to enter app) and `onSetState`
// (so flows like "Sign back in" return to signin).

function LoginMi({ name, style }) {
  return <span className="material-symbols-outlined" style={style}>{name}</span>;
}

function LoginBrandRow({ light }) {
  return (
    <div className="brand-row">
      <span className="mark">₹</span>
      <span className="name" style={light ? { color: "white" } : undefined}>LedgerBuddy</span>
    </div>
  );
}

function LoginBrandPanel() {
  return (
    <aside className="auth-left">
      <div className="brand-panel-top">
        <LoginBrandRow light />
        <span className="ver">v 4.12 · Apr 2026</span>
      </div>
      <div className="brand-panel-body">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "600 11px var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "rgba(255,255,255,.55)", marginBottom: 14 }}>
          <span style={{ width: 6, height: 6, background: "#4ade80", borderRadius: 999, boxShadow: "0 0 0 4px rgba(74,222,128,.15)" }} />
          Built for Indian CA practices
        </div>
        <h1 className="brand-tagline">
          From inbox to <em>Tally voucher</em> in <em>under a minute</em>.
        </h1>
        <p className="brand-sub">
          AP automation for chartered accountants. Ingests bills, reconciles GST &amp; TDS, and posts straight to Tally — across every client org you manage.
        </p>
        <div className="proof-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ font: "700 11px var(--font-sans)", textTransform: "uppercase", letterSpacing: ".1em", color: "rgba(255,255,255,.85)" }}>Today across the firm</span>
            <span style={{ font: "600 10.5px var(--font-mono)", color: "rgba(255,255,255,.5)" }}>14-Apr-2026 · IST</span>
          </div>
          <div className="proof-row">
            <div className="proof-icon"><LoginMi name="bolt" style={{ fontSize: 16 }} /></div>
            <div className="text"><div className="t">128 invoices ingested</div><div className="s">across 8 client orgs · ₹4.21 Cr value</div></div>
            <span className="ts">10:21</span>
          </div>
          <div className="proof-row">
            <div className="proof-icon accent"><LoginMi name="cloud_upload" style={{ fontSize: 16 }} /></div>
            <div className="text"><div className="t">12 vouchers exported to Tally</div><div className="s">Batch B-2604-014 · Sundaram Textiles</div></div>
            <span className="ts">17:32</span>
          </div>
          <div className="proof-row">
            <div className="proof-icon warn"><LoginMi name="receipt_long" style={{ fontSize: 16 }} /></div>
            <div className="text"><div className="t">2 GSTIN mismatches caught</div><div className="s">Held before payment · saved ₹38,400 ITC</div></div>
            <span className="ts">14:08</span>
          </div>
        </div>
      </div>
      <div className="brand-foot">
        <span className="quote">"It replaced 11 hours of data entry a week. Mahir Khan, CA."</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,.6)" }}>
          <span style={{ width: 4, height: 4, background: "#4ade80", borderRadius: 999 }} />
          All systems operational
        </span>
      </div>
    </aside>
  );
}

function LoginShell({ children, hideTopHelp }) {
  return (
    <div className="auth-shell">
      <LoginBrandPanel />
      <div className="auth-right">
        <div className="top-row">
          <LoginBrandRow />
          {!hideTopHelp ? (
            <a href="#" className="help" onClick={e => e.preventDefault()}>
              <LoginMi name="help" style={{ fontSize: 16 }} />
              Help &amp; status
            </a>
          ) : <span />}
        </div>
        <div className="auth-card-wrap">
          <div className="auth-card">{children}</div>
        </div>
        <div className="auth-bottom">
          <div className="legal">© 2026 LedgerBuddy Technologies Pvt Ltd</div>
          <div className="trust">
            <span className="ok">SOC 2 TYPE II</span>
            <span className="dot" />
            <span>ISO 27001</span>
            <span className="dot" />
            <span>India data residency</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Demo credentials ----------
// Two demo identities baked into the kit. The signin form detects whether the
// email matches the platform-ops domain and routes to PlatformAdmin.html;
// everything else lands in the tenant workspace at index.html.
const DEMO_CREDS = {
  tenant: {
    email: "reena@khan-ca.in",
    password: "Demo-Pass-2026!",
    role: "tenant",
    label: "Tenant admin",
    sub: "Reena Patel · Khan & Associates, CA",
    icon: "business_center",
  },
  platform: {
    email: "ops@ledgerbuddy.in",
    password: "Platform-Ops-2026!",
    role: "platform",
    label: "Platform admin",
    sub: "LedgerBuddy ops · super-admin scope",
    icon: "admin_panel_settings",
  },
};
function loginRoleFor(email) {
  return /@ledgerbuddy\.in$/i.test((email || "").trim()) ? "platform" : "tenant";
}

// ---------- States ----------
function LoginSignIn({ onAuthenticated, onSetState }) {
  const [email, setEmail] = React.useState(DEMO_CREDS.tenant.email);
  const [pw, setPw] = React.useState(DEMO_CREDS.tenant.password);
  const [showPw, setShowPw] = React.useState(false);
  const [remember, setRemember] = React.useState(true);
  const role = loginRoleFor(email);
  const auth = (r) => onAuthenticated?.(r || role);
  const submit = (e) => { e?.preventDefault?.(); auth(); };
  const fillDemo = (which) => {
    const c = DEMO_CREDS[which];
    setEmail(c.email);
    setPw(c.password);
  };

  return (
    <LoginShell>
      <div className="auth-eyebrow"><LoginMi name="login" /> Welcome back</div>
      <h1 className="auth-h">Sign in to LedgerBuddy</h1>
      <p className="auth-sub">Use your work account, or sign in with email &amp; password.</p>

      <div className="demo-creds">
        <div className="demo-creds-head">
          <span className="demo-creds-eyebrow"><LoginMi name="key" style={{ fontSize: 14 }} /> Demo credentials</span>
          <span className="demo-creds-sub">Click a card to autofill, then Sign in.</span>
        </div>
        <div className="demo-creds-grid">
          {[DEMO_CREDS.tenant, DEMO_CREDS.platform].map((c) => {
            const active = email.trim().toLowerCase() === c.email.toLowerCase();
            return (
              <button
                key={c.role}
                type="button"
                className={"demo-card" + (active ? " active" : "") + (c.role === "platform" ? " platform" : "")}
                onClick={() => fillDemo(c.role)}
              >
                <span className="demo-card-icon"><LoginMi name={c.icon} style={{ fontSize: 18 }} /></span>
                <span className="demo-card-body">
                  <span className="demo-card-row">
                    <span className="demo-card-label">{c.label}</span>
                    {c.role === "platform" ? <span className="demo-card-tag">super-admin</span> : null}
                  </span>
                  <span className="demo-card-sub">{c.sub}</span>
                  <span className="demo-card-creds">
                    <span className="k">email</span> <span className="v">{c.email}</span>
                    <span className="k">pwd</span> <span className="v">{c.password}</span>
                  </span>
                </span>
                <span className="demo-card-check"><LoginMi name={active ? "check_circle" : "radio_button_unchecked"} style={{ fontSize: 18 }} /></span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="btn-stack">
        <button className="btn" onClick={() => auth()}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.71-1.57 2.69-3.89 2.69-6.61z" fill="#4285F4"/><path d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.27c-.81.54-1.84.86-3.04.86a5.27 5.27 0 0 1-4.96-3.66H.96v2.34A8.99 8.99 0 0 0 9 18z" fill="#34A853"/><path d="M4.04 10.75A5.4 5.4 0 0 1 3.74 9c0-.6.1-1.2.3-1.75V4.91H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.96 4.09l3.08-2.34z" fill="#FBBC05"/><path d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58A8.99 8.99 0 0 0 9 0 8.99 8.99 0 0 0 .96 4.91l3.08 2.34A5.27 5.27 0 0 1 9 3.58z" fill="#EA4335"/></svg>
          Continue with Google Workspace
        </button>
        <button className="btn" onClick={() => auth()}>
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#F25022" d="M0 0h8.5v8.5H0z"/><path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z"/><path fill="#00A4EF" d="M0 9.5h8.5V18H0z"/><path fill="#FFB900" d="M9.5 9.5H18V18H9.5z"/></svg>
          Continue with Microsoft 365
        </button>
      </div>

      <div className="divider">or sign in with email</div>

      <form onSubmit={submit}>
        <div className="field">
          <label>Work email</label>
          <div className="input-with-icon">
            <LoginMi name="alternate_email" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-muted)", fontSize: 18 }} />
            <input className="input mono" style={{ paddingLeft: 38 }} value={email} onChange={e => setEmail(e.target.value)} autoFocus />
            <span className={"role-pill " + role} title={role === "platform" ? "Platform admin scope" : "Tenant scope"}>
              <LoginMi name={role === "platform" ? "admin_panel_settings" : "business_center"} style={{ fontSize: 13 }} />
              {role === "platform" ? "Platform" : "Tenant"}
            </span>
          </div>
        </div>
        <div className="field">
          <div className="field-row"><label>Password</label><a href="#" onClick={e => { e.preventDefault(); onSetState("forgot"); }}>Forgot?</a></div>
          <div className="input-with-icon">
            <LoginMi name="lock" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-muted)", fontSize: 18 }} />
            <input className="input mono" type={showPw ? "text" : "password"} style={{ paddingLeft: 38 }} value={pw} onChange={e => setPw(e.target.value)} placeholder="Enter password" />
            <button type="button" className="trail-btn" onClick={() => setShowPw(s => !s)} title={showPw ? "Hide" : "Show"}>
              <LoginMi name={showPw ? "visibility_off" : "visibility"} style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>
        <div className="checkrow" style={{ marginBottom: 16 }}>
          <input id="remember" type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          <label htmlFor="remember">Keep me signed in for 30 days on this device</label>
        </div>

        <button type="submit" className="btn primary">
          Sign in
          <LoginMi name="arrow_forward" style={{ fontSize: 18 }} />
        </button>
      </form>

      <div className="foot-link">
        New to LedgerBuddy? <a href="#" onClick={e => e.preventDefault()}>Talk to sales</a> · CAs only
      </div>
    </LoginShell>
  );
}

function LoginMagicSent({ onSetState }) {
  return (
    <LoginShell>
      <div className="big-icon accent"><LoginMi name="mark_email_read" /></div>
      <h1 className="auth-h">Check your inbox</h1>
      <p className="auth-sub">We sent a sign-in link to <b style={{ color: "var(--ink)" }}>reena@khan-ca.in</b>. The link is valid for 15 minutes and works on this device only.</p>
      <div className="sent-card">
        <div className="icon"><LoginMi name="schedule" /></div>
        <div>
          <div style={{ font: "700 13px var(--font-sans)", color: "var(--ink)", marginBottom: 2 }}>Didn't get it?</div>
          <div style={{ font: "500 12.5px var(--font-sans)", color: "var(--ink-soft)" }}>Check spam, or wait <b>00:42</b> to resend. Make sure your firm allows mail from <span style={{ fontFamily: "var(--font-mono)" }}>auth@ledgerbuddy.in</span>.</div>
        </div>
      </div>
      <button className="btn primary" disabled><LoginMi name="restart_alt" /> Resend link in 42s</button>
      <div style={{ height: 8 }} />
      <button className="btn" onClick={() => onSetState("signin")}><LoginMi name="arrow_back" /> Use a different sign-in method</button>
    </LoginShell>
  );
}

function LoginForgot({ onSetState }) {
  return (
    <LoginShell>
      <div className="auth-eyebrow"><LoginMi name="key" /> Recover access</div>
      <h1 className="auth-h">Forgot your password?</h1>
      <p className="auth-sub">Enter your work email and we'll send you a link to reset it. The link expires in 30 minutes.</p>
      <div className="field">
        <label>Work email</label>
        <div className="input-with-icon">
          <LoginMi name="alternate_email" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-muted)", fontSize: 18 }} />
          <input className="input mono" style={{ paddingLeft: 38 }} placeholder="you@firm.in" defaultValue="reena@khan-ca.in" autoFocus />
        </div>
        <span className="field-hint">Resets are logged in your firm's audit trail.</span>
      </div>
      <button className="btn primary" onClick={() => onSetState("magic_sent")}>Send reset link <LoginMi name="send" style={{ fontSize: 16 }} /></button>
      <div style={{ height: 8 }} />
      <button className="btn ghost" onClick={() => onSetState("signin")}><LoginMi name="arrow_back" /> Back to sign in</button>
      <div style={{ marginTop: 24, padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: 8, font: "500 12px/1.55 var(--font-sans)", color: "var(--ink-soft)" }}>
        <b style={{ color: "var(--ink)" }}>Locked out of email?</b> Contact your firm owner or write to <a href="mailto:support@ledgerbuddy.in" style={{ color: "var(--accent)", fontWeight: 600 }}>support@ledgerbuddy.in</a> with your firm's Practice ID.
      </div>
    </LoginShell>
  );
}

function LoginReset({ onAuthenticated }) {
  const [n1, setN1] = React.useState("");
  const [n2, setN2] = React.useState("");
  const strength = (() => {
    let s = 0;
    if (n1.length >= 10) s++;
    if (/[A-Z]/.test(n1)) s++;
    if (/[a-z]/.test(n1)) s++;
    if (/\d/.test(n1)) s++;
    if (/[^A-Za-z0-9]/.test(n1)) s++;
    return s;
  })();
  const strengthLabel = ["Too short", "Weak", "Fair", "Good", "Strong", "Excellent"][strength];
  const strengthColor = strength <= 1 ? "var(--warn)" : strength <= 3 ? "#b8770b" : "var(--emerald)";
  const matches = n1 && n1 === n2;
  return (
    <LoginShell>
      <div className="auth-eyebrow"><LoginMi name="lock_reset" /> Set a new password</div>
      <h1 className="auth-h">Choose a new password</h1>
      <p className="auth-sub">For <b style={{ color: "var(--ink)" }}>reena@khan-ca.in</b>. Other devices will be signed out.</p>
      <div className="field">
        <label>New password</label>
        <div className="input-with-icon">
          <LoginMi name="lock" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-muted)", fontSize: 18 }} />
          <input className="input mono" type="password" style={{ paddingLeft: 38 }} value={n1} onChange={e => setN1(e.target.value)} placeholder="At least 10 characters" />
        </div>
        {n1 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 3 }}>
              {[0,1,2,3,4].map(i => <span key={i} style={{ height: 4, borderRadius: 2, background: i < strength ? strengthColor : "var(--bg-sunken)" }} />)}
            </div>
            <span style={{ font: "600 11px var(--font-sans)", color: strengthColor }}>{strengthLabel}</span>
          </div>
        ) : null}
      </div>
      <div className="field">
        <label>Confirm new password</label>
        <div className="input-with-icon">
          <LoginMi name="lock" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-muted)", fontSize: 18 }} />
          <input className={"input mono" + (n2 && !matches ? " error" : "")} type="password" style={{ paddingLeft: 38 }} value={n2} onChange={e => setN2(e.target.value)} />
        </div>
        {n2 && !matches ? <span className="field-error"><LoginMi name="error" style={{ fontSize: 14 }} /> Passwords don't match</span> : null}
      </div>
      <div style={{ background: "var(--bg-sunken)", borderRadius: 8, padding: "10px 12px", font: "500 11.5px/1.65 var(--font-sans)", color: "var(--ink-soft)", marginBottom: 14 }}>
        <b style={{ color: "var(--ink)", display: "block", marginBottom: 4, font: "700 11px var(--font-sans)", textTransform: "uppercase", letterSpacing: ".06em" }}>Requirements</b>
        Min 10 chars · upper, lower, digit, symbol · cannot reuse last 5
      </div>
      <button className="btn primary" disabled={!matches || strength < 3} onClick={onAuthenticated}>Update password &amp; sign in</button>
    </LoginShell>
  );
}

function LoginTwoFA({ onAuthenticated, onSetState }) {
  const [code, setCode] = React.useState(["8", "1", "2", "", "", ""]);
  const refs = React.useRef([]);
  const onCh = (i, v) => {
    if (!/^[0-9]?$/.test(v)) return;
    const n = [...code]; n[i] = v; setCode(n);
    if (v && i < 5) refs.current[i + 1]?.focus();
  };
  const onKey = (i, e) => { if (e.key === "Backspace" && !code[i] && i > 0) refs.current[i - 1]?.focus(); };
  return (
    <LoginShell>
      <div className="auth-eyebrow"><LoginMi name="shield_lock" /> Two-factor authentication</div>
      <h1 className="auth-h">Enter your 6-digit code</h1>
      <p className="auth-sub">Open your authenticator app and enter the code for <b style={{ color: "var(--ink)" }}>LedgerBuddy · reena@khan-ca.in</b>.</p>
      <div className="otp-row">
        {code.map((c, i) => (
          <input key={i}
                 ref={el => refs.current[i] = el}
                 className={"otp-cell" + (c ? " filled" : "")}
                 maxLength={1}
                 value={c}
                 onChange={e => onCh(i, e.target.value)}
                 onKeyDown={e => onKey(i, e)}
                 inputMode="numeric"
                 autoFocus={i === 3} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18, font: "500 11.5px var(--font-mono)", color: "var(--ink-soft)" }}>
        <span>Code refreshes in 23s</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 6, height: 6, background: "var(--emerald)", borderRadius: 999 }} />
          New device — Mumbai, IN
        </span>
      </div>
      <button className="btn primary" disabled={code.filter(Boolean).length < 6} onClick={onAuthenticated}>Verify &amp; continue</button>
      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <a href="#" onClick={e => e.preventDefault()} style={{ font: "600 13px var(--font-sans)", color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <LoginMi name="key_vertical" style={{ fontSize: 18 }} /> Use a recovery code instead
        </a>
        <a href="#" onClick={e => { e.preventDefault(); onSetState("signin"); }} style={{ font: "500 12.5px var(--font-sans)", color: "var(--ink-soft)", textDecoration: "none" }}>
          Lost your device? Contact your firm owner.
        </a>
      </div>
    </LoginShell>
  );
}

function LoginTwoFASetup({ onAuthenticated }) {
  const recovery = ["F8K2-9P3M", "Q7L1-W4XN", "B3R6-T2VC", "Y9D5-A1ZH", "K2J8-M6PR", "N4S0-C7BE", "X1T9-G3UF", "H6Q5-L8DO"];
  return (
    <LoginShell>
      <div className="steps">
        <span className="step done"></span><span className="step done"></span>
        <span className="step cur"></span><span className="step"></span>
        <span className="steps-count">3 / 4</span>
      </div>
      <div className="auth-eyebrow"><LoginMi name="shield" /> Required by your firm</div>
      <h1 className="auth-h">Set up two-factor authentication</h1>
      <p className="auth-sub">Khan &amp; Associates, CA enforces 2FA for all members. Scan the QR with Google Authenticator, 1Password, or Authy.</p>
      <div className="qr-block">
        <div className="qr-tile">
          <svg viewBox="0 0 21 21" width="148" height="148" shapeRendering="crispEdges">
            {(() => {
              const cells = [];
              for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) {
                const v = (x * 13 + y * 7 + ((x * y) % 5)) % 3 === 0;
                if (v) cells.push(<rect key={x + "_" + y} x={x} y={y} width="1" height="1" fill="#0f172a" />);
              }
              return cells;
            })()}
            {[[0,0],[0,14],[14,0]].map(([x,y], i) => (
              <g key={i}>
                <rect x={x} y={y} width="7" height="7" fill="#0f172a" />
                <rect x={x+1} y={y+1} width="5" height="5" fill="white" />
                <rect x={x+2} y={y+2} width="3" height="3" fill="#0f172a" />
              </g>
            ))}
          </svg>
        </div>
        <div className="secret-block">
          <span className="lbl">Or enter manually</span>
          <span className="secret-pill">JBSWY3DPEHPK3PXP-LBY26<button title="Copy"><LoginMi name="content_copy" style={{ fontSize: 14 }} /></button></span>
          <span className="lbl" style={{ marginTop: 4 }}>Account name</span>
          <div style={{ font: "600 12px var(--font-mono)", color: "var(--ink)" }}>LedgerBuddy : reena@khan-ca.in</div>
        </div>
      </div>
      <div className="field">
        <label>Confirm — enter the 6-digit code from the app</label>
        <input className="input mono" placeholder="123 456" maxLength={7} style={{ letterSpacing: ".3em", fontSize: 16, textAlign: "center" }} />
      </div>
      <div style={{ font: "700 11px var(--font-sans)", textTransform: "uppercase", letterSpacing: ".08em", color: "var(--ink-soft)", marginBottom: 6 }}>Save your recovery codes</div>
      <div className="recovery-grid">{recovery.map(c => <code key={c}>{c}</code>)}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 18 }}>
        <button className="btn" style={{ flex: 1, height: 36 }}><LoginMi name="download" /> Download .txt</button>
        <button className="btn" style={{ flex: 1, height: 36 }}><LoginMi name="content_copy" /> Copy all</button>
      </div>
      <button className="btn primary" onClick={onAuthenticated}>Activate 2FA &amp; continue</button>
    </LoginShell>
  );
}

function LoginInvite({ onSetState }) {
  return (
    <LoginShell>
      <div className="steps">
        <span className="step cur"></span><span className="step"></span>
        <span className="step"></span><span className="step"></span>
        <span className="steps-count">1 / 4</span>
      </div>
      <div className="auth-eyebrow"><LoginMi name="celebration" /> You've been invited</div>
      <h1 className="auth-h">Welcome to <span style={{ color: "var(--accent)" }}>Khan &amp; Associates, CA</span></h1>
      <p className="auth-sub"><b style={{ color: "var(--ink)" }}>Mahir Khan, CA</b> invited you as <b style={{ color: "var(--ink)" }}>Senior Accountant</b> with access to <b style={{ color: "var(--ink)" }}>5 client orgs</b>. Set up your account to continue.</p>
      <div className="field"><label>Full name</label><input className="input" defaultValue="Reena Patel" autoFocus /></div>
      <div className="field">
        <label>Work email</label>
        <input className="input mono" defaultValue="reena@khan-ca.in" disabled style={{ background: "var(--bg-sunken)", color: "var(--ink-soft)" }} />
        <span className="field-hint">Set by your firm — contact owner to change.</span>
      </div>
      <div className="field">
        <label>Create password</label>
        <input className="input mono" type="password" placeholder="At least 10 characters" />
        <span className="field-hint">You'll set up 2FA in the next step.</span>
      </div>
      <div className="checkrow" style={{ marginBottom: 16 }}>
        <input id="tos" type="checkbox" defaultChecked />
        <label htmlFor="tos">I agree to the <a href="#" style={{ color: "var(--accent)", fontWeight: 600 }}>Terms</a> and <a href="#" style={{ color: "var(--accent)", fontWeight: 600 }}>Privacy Policy</a></label>
      </div>
      <button className="btn primary" onClick={() => onSetState("twofa_setup")}>Create account &amp; continue <LoginMi name="arrow_forward" /></button>
    </LoginShell>
  );
}

function LoginLocked({ onSetState }) {
  return (
    <LoginShell>
      <div className="big-icon warn"><LoginMi name="lock_clock" /></div>
      <h1 className="auth-h">Account temporarily locked</h1>
      <p className="auth-sub">Too many failed sign-in attempts on <b style={{ color: "var(--ink)" }}>reena@khan-ca.in</b>. For security, this account is locked for the next 14 minutes.</p>
      <div className="alert warn">
        <LoginMi name="info" />
        <div>
          <b>5 failed attempts in 10 minutes</b>
          From IP <span style={{ fontFamily: "var(--font-mono)" }}>103.21.x.x</span> · Mumbai, IN. If this wasn't you, reset your password and notify your firm owner.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button className="btn" onClick={() => onSetState("forgot")}><LoginMi name="lock_reset" /> Reset password</button>
        <button className="btn" onClick={() => onSetState("magic_sent")}><LoginMi name="mail" /> Email magic link instead</button>
        <button className="btn ghost"><LoginMi name="support_agent" /> Contact firm owner — Mahir Khan, CA</button>
      </div>
      <div style={{ marginTop: 22, padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: 8, font: "500 12px var(--font-mono)", color: "var(--ink-soft)", display: "flex", justifyContent: "space-between" }}>
        <span>Lock expires in</span>
        <b style={{ color: "var(--ink)" }}>13:42</b>
      </div>
    </LoginShell>
  );
}

function LoginSignedOut({ onSetState }) {
  return (
    <LoginShell hideTopHelp>
      <div className="big-icon ok"><LoginMi name="check_circle" /></div>
      <h1 className="auth-h">You've been signed out</h1>
      <p className="auth-sub">Your session ended securely. Any unsaved drafts are kept for 24 hours. See you again soon, Reena.</p>
      <div style={{ background: "var(--bg-sunken)", borderRadius: 10, padding: 16, marginBottom: 18, display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 36, height: 36, borderRadius: 999, background: "var(--accent-soft-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 13px var(--font-sans)" }}>RP</div>
        <div style={{ flex: 1 }}>
          <div style={{ font: "700 13px var(--font-sans)", color: "var(--ink)" }}>Reena Patel</div>
          <div style={{ font: "500 11.5px var(--font-mono)", color: "var(--ink-soft)" }}>Last active · just now · MacBook Pro</div>
        </div>
        <span style={{ font: "600 11px var(--font-sans)", color: "var(--emerald)", textTransform: "uppercase", letterSpacing: ".06em" }}>Secure</span>
      </div>
      <button className="btn primary" onClick={() => onSetState("signin")}><LoginMi name="login" /> Sign back in</button>
      <div style={{ height: 8 }} />
      <button className="btn" onClick={() => onSetState("signin")}><LoginMi name="swap_horiz" /> Sign in as a different user</button>
      <div className="foot-link">
        <a href="#" onClick={e => e.preventDefault()}>Status page</a> · All systems operational
      </div>
    </LoginShell>
  );
}

// ---------- Router ----------
function Login({ state = "signin", onAuthenticated, onSetState, showStatePicker }) {
  const STATES = [
    { id: "signin",      label: "Sign in" },
    { id: "magic_sent",  label: "Magic link sent" },
    { id: "forgot",      label: "Forgot password" },
    { id: "reset",       label: "Reset password" },
    { id: "twofa",       label: "2FA challenge" },
    { id: "twofa_setup", label: "Set up 2FA" },
    { id: "invite",      label: "Accept invite" },
    { id: "locked",      label: "Account locked" },
    { id: "signed_out",  label: "Signed out" },
  ];
  const props = { onAuthenticated, onSetState };
  let view = null;
  if (state === "signin")          view = <LoginSignIn {...props} />;
  else if (state === "magic_sent") view = <LoginMagicSent {...props} />;
  else if (state === "forgot")     view = <LoginForgot {...props} />;
  else if (state === "reset")      view = <LoginReset {...props} />;
  else if (state === "twofa")      view = <LoginTwoFA {...props} />;
  else if (state === "twofa_setup")view = <LoginTwoFASetup {...props} />;
  else if (state === "invite")     view = <LoginInvite {...props} />;
  else if (state === "locked")     view = <LoginLocked {...props} />;
  else if (state === "signed_out") view = <LoginSignedOut {...props} />;
  else                             view = <LoginSignIn {...props} />;

  return (
    <>
      {showStatePicker ? (
        <div className="state-bar">
          {STATES.map(s => (
            <button key={s.id} className={"state-btn" + (state === s.id ? " on" : "")} onClick={() => onSetState(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      {view}
    </>
  );
}

window.Login = Login;
