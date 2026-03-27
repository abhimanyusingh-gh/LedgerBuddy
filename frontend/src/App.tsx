import { useEffect, useMemo, useState, useCallback } from "react";
import { useTheme } from "./hooks/useTheme";
import {
  assignTenantUserRole,
  changePassword,
  clearStoredSessionToken,
  completeTenantOnboarding,
  fetchGmailConnectUrl,
  fetchGmailConnectionStatus,
  loginWithCredentials,
  fetchPlatformTenantUsage,
  onboardTenantAdmin,
  setTenantEnabled,
  fetchSessionContext,
  fetchTenantUsers,
  getStoredSessionToken,
  inviteTenantUser,
  setStoredSessionToken,
  removeTenantUser,
  setUserEnabled,
  fetchMailboxes,
  assignMailboxUser,
  removeMailboxAssignment,
  removeMailbox,
  fetchBankAccounts,
  initiateBankConsent,
  revokeBankAccount,
  refreshBankBalance
} from "./api";
import { OverviewDashboard } from "./components/OverviewDashboard";
import type { BankAccount, GmailConnectionStatus, TenantMailbox } from "./types";
import type { PlatformTenantUsageSummary } from "./api";
import { LoginPage } from "./components/login/LoginPage";
import { PlatformAdminTopNav } from "./components/platformAdmin/PlatformAdminTopNav";
import { PlatformActivityMonitor } from "./components/platformAdmin/PlatformActivityMonitor";
import { PlatformOnboardSection } from "./components/platformAdmin/PlatformOnboardSection";
import { PlatformUsageOverviewSection } from "./components/platformAdmin/PlatformUsageOverviewSection";
import { PlatformAnalyticsDashboard } from "./components/platformAdmin/PlatformAnalyticsDashboard";
import { TenantAdminTopNav } from "./components/tenantAdmin/TenantAdminTopNav";
import { TenantViewTabs, type TenantViewTab } from "./components/tenantAdmin/TenantViewTabs";
import { TenantConfigTab } from "./components/tenantAdmin/TenantConfigTab";
import { TenantInvoicesView } from "./components/tenantAdmin/TenantInvoicesView";
import { ExportHistoryDashboard } from "./components/ExportHistoryDashboard";
import { EmptyState } from "./components/EmptyState";
import { BankConnectionsTab } from "./components/BankConnectionsTab";
import { getUserFacingErrorMessage } from "./apiError";
import { useToast } from "./hooks/useToast";
import { ToastContainer } from "./components/ToastContainer";

function cleanUrlParams(...keys: string[]) {
  const params = new URLSearchParams(window.location.search);
  for (const k of keys) params.delete(k);
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

export function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<{
    user: { id: string; email: string; role: "PLATFORM_ADMIN" | "TENANT_ADMIN" | "MEMBER" | "VIEWER"; isPlatformAdmin: boolean };
    tenant: { id: string; name: string; onboarding_status: "pending" | "completed"; mode?: "test" | "live" };
    flags: {
      requires_tenant_setup: boolean;
      requires_reauth: boolean;
      requires_admin_action: boolean;
      requires_email_confirmation: boolean;
    };
  } | null>(null);
  const [tenantUsers, setTenantUsers] = useState<Array<{ userId: string; email: string; role: "TENANT_ADMIN" | "MEMBER" | "VIEWER"; enabled: boolean }>>([]);
  const [platformUsage, setPlatformUsage] = useState<PlatformTenantUsageSummary[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [onboardingForm, setOnboardingForm] = useState({ tenantName: "", adminEmail: "" });
  const [platformOnboardForm, setPlatformOnboardForm] = useState({ tenantName: "", adminEmail: "", adminDisplayName: "", mode: "test" as string });
  const [navCounts, setNavCounts] = useState({ total: 0, approved: 0, pending: 0, failed: 0 });
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionStatus | null>(null);
  const [mailboxes, setMailboxes] = useState<TenantMailbox[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [activeTab, setActiveTabRaw] = useState<TenantViewTab>(() => {
    const stored = localStorage.getItem("billforge:active-tab");
    const valid: TenantViewTab[] = ["overview", "dashboard", "config", "exports", "connections"];
    return stored && valid.includes(stored as TenantViewTab) ? (stored as TenantViewTab) : "overview";
  });
  const setActiveTab = useCallback((tab: TenantViewTab) => {
    setActiveTabRaw(tab);
    localStorage.setItem("billforge:active-tab", tab);
  }, []);
  const [selectedPlatformTenantId, setSelectedPlatformTenantId] = useState<string | null>(null);
  const [platformOnboardCollapsed, setPlatformOnboardCollapsed] = useState(false);
  const [platformUsageCollapsed, setPlatformUsageCollapsed] = useState(false);
  const [platformActivityCollapsed, setPlatformActivityCollapsed] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordForm, setChangePasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [platformOnboardResult, setPlatformOnboardResult] = useState<{ tempPassword: string; adminEmail: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toasts, addToast, removeToast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const guarded = useCallback(async (fn: () => Promise<void>, fallbackMsg: string) => {
    try {
      await fn();
    } catch (e) {
      setError(getUserFacingErrorMessage(e, fallbackMsg));
    }
  }, []);

  useEffect(() => { void bootstrapSession(); }, []);

  useEffect(() => {
    if (!session) return;
    if (session.user.isPlatformAdmin) {
      setActiveTab("dashboard");
      void loadPlatformUsage();
      setTenantUsers([]);
      setGmailConnection(null);
      setMailboxes([]);
      setBankAccounts([]);
    } else {
      setPlatformUsage([]);
      setSelectedPlatformTenantId(null);
      void loadGmailConnectionStatus();
      if (session.user.role === "TENANT_ADMIN") {
        void loadTenantUsers();
        void loadMailboxes();
        void loadBankAccounts();
        setOnboardingForm({ tenantName: session.tenant.name, adminEmail: session.user.email });
      } else {
        setTenantUsers([]);
        setMailboxes([]);
        setBankAccounts([]);
      }
    }
  }, [session?.user.id, session?.tenant.id]);

  useEffect(() => {
    if (platformUsage.length === 0) {
      setSelectedPlatformTenantId(null);
      return;
    }
    setSelectedPlatformTenantId((cur) =>
      cur && platformUsage.some((e) => e.tenantId === cur) ? cur : platformUsage[0].tenantId
    );
  }, [platformUsage]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("bank") === "error") {
      addToast("error", "Bank connection failed. Please try again.");
      cleanUrlParams("bank");
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (!gmailStatus) return;

    if (window.opener) { window.close(); return; }

    if (gmailStatus === "error") {
      const reason = params.get("reason");
      setError(reason ? `Gmail reconnect failed: ${reason}` : "Gmail reconnect failed.");
    }
    if (gmailStatus === "connected") setError(null);

    if (session) {
      void loadGmailConnectionStatus();
      if (session.user.isPlatformAdmin) void loadPlatformUsage();
      else if (session.user.role === "TENANT_ADMIN") void loadMailboxes();
    }
    cleanUrlParams("gmail", "reason");
  }, [session]);

  const platformStats = useMemo(() => ({
    tenants: platformUsage.length,
    users: platformUsage.reduce((s, e) => s + e.userCount, 0),
    totalDocuments: platformUsage.reduce((s, e) => s + e.totalDocuments, 0),
    approvedDocuments: platformUsage.reduce((s, e) => s + e.approvedDocuments, 0),
    exportedDocuments: platformUsage.reduce((s, e) => s + e.exportedDocuments, 0),
    failedDocuments: platformUsage.reduce((s, e) => s + e.failedDocuments, 0)
  }), [platformUsage]);

  const selectedPlatformTenant = useMemo(
    () => platformUsage.find((e) => e.tenantId === selectedPlatformTenantId) ?? null,
    [platformUsage, selectedPlatformTenantId]
  );

  async function bootstrapSession() {
    setAuthLoading(true);
    const params = new URLSearchParams(window.location.search);
    const callbackToken = params.get("token");
    const callbackNext = params.get("next");
    if (callbackToken) {
      setStoredSessionToken(callbackToken);
      const targetPath = callbackNext && callbackNext.startsWith("/") ? callbackNext : window.location.pathname;
      params.delete("token");
      params.delete("next");
      const query = params.toString();
      window.history.replaceState({}, "", `${targetPath}${query ? `?${query}` : ""}`);
    }

    const storedToken = getStoredSessionToken();
    if (!storedToken) {
      setSession(null);
      setAuthLoading(false);
      return;
    }

    try {
      const ctx = await fetchSessionContext();
      setSession(ctx);
      setError(null);
      if ((ctx.flags as Record<string, unknown>).must_change_password) setShowChangePassword(true);
    } catch {
      clearStoredSessionToken();
      setSession(null);
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadTenantUsers() {
    if (!session || session.user.role !== "TENANT_ADMIN") return;
    await guarded(async () => { setTenantUsers(await fetchTenantUsers()); }, "Failed to load tenant users.");
  }

  async function loadPlatformUsage() {
    if (!session?.user.isPlatformAdmin) return;
    await guarded(async () => { setPlatformUsage(await fetchPlatformTenantUsage()); }, "Failed to load tenant usage overview.");
  }

  async function loadGmailConnectionStatus() {
    if (!session) return;
    try {
      setGmailConnection(await fetchGmailConnectionStatus());
    } catch {
      setGmailConnection({ provider: "gmail", connectionState: "DISCONNECTED" });
    }
  }

  async function loadMailboxes() {
    try { setMailboxes(await fetchMailboxes()); } catch { setMailboxes([]); }
  }

  async function loadBankAccounts() {
    try { setBankAccounts(await fetchBankAccounts()); } catch { setBankAccounts([]); }
  }

  async function handleConnectGmail() {
    await guarded(async () => {
      const connectUrl = await fetchGmailConnectUrl();
      const popup = window.open(connectUrl, "_blank", "noopener");
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        void loadGmailConnectionStatus();
        void loadMailboxes();
      };
      if (popup) window.addEventListener("focus", onFocus);
    }, "Failed to start Gmail connection flow.");
  }

  async function handleChangePassword() {
    if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (changePasswordForm.newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    await guarded(async () => {
      setError(null);
      await changePassword(changePasswordForm.currentPassword, changePasswordForm.newPassword);
      setShowChangePassword(false);
      setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      await bootstrapSession();
    }, "Failed to change password.");
  }

  function handleLogout() {
    clearStoredSessionToken();
    setSession(null);
    setTenantUsers([]);
    setActiveTab("overview");
    setShowChangePassword(false);
    setPlatformOnboardResult(null);
  }

  async function handleLogin() {
    const normalizedEmail = loginEmail.trim().toLowerCase();
    if (!normalizedEmail || !loginPassword) { setError("Enter email and password."); return; }

    try {
      setLoginSubmitting(true);
      setError(null);
      const token = await loginWithCredentials(normalizedEmail, loginPassword);
      setStoredSessionToken(token);
      setLoginPassword("");
      await bootstrapSession();
    } catch (loginError) {
      setError(getUserFacingErrorMessage(loginError, "Login failed."));
      clearStoredSessionToken();
      setSession(null);
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function handleCompleteOnboarding() {
    if (!session) return;
    await guarded(async () => {
      setError(null);
      await completeTenantOnboarding({ tenantName: onboardingForm.tenantName, adminEmail: onboardingForm.adminEmail });
      setSession(await fetchSessionContext());
    }, "Failed to complete onboarding.");
  }

  async function handlePlatformOnboardTenantAdmin() {
    const tenantName = platformOnboardForm.tenantName.trim();
    const adminEmail = platformOnboardForm.adminEmail.trim().toLowerCase();
    const adminDisplayName = platformOnboardForm.adminDisplayName.trim();
    if (!tenantName || !adminEmail) { setError("Enter tenant name and tenant admin email."); return; }

    await guarded(async () => {
      setError(null);
      const result = await onboardTenantAdmin({
        tenantName, adminEmail,
        ...(adminDisplayName ? { adminDisplayName } : {}),
        mode: platformOnboardForm.mode
      });
      setPlatformOnboardForm({ tenantName: "", adminEmail: "", adminDisplayName: "", mode: "test" });
      if (result.tempPassword) setPlatformOnboardResult({ tempPassword: result.tempPassword, adminEmail: result.adminEmail });
      await loadPlatformUsage();
      setPlatformUsageCollapsed(false);
    }, "Failed to onboard tenant admin.");
  }

  if (authLoading) {
    return (
      <div className="layout">
        <main className="content content-list-expanded">
          <section className="panel list-panel"><h2>Authenticating...</h2></section>
        </main>
      </div>
    );
  }

  if (!session) {
    const verified = new URLSearchParams(window.location.search).get("verified") === "true";
    return (
      <>
        {verified && <div className="verified-banner" style={{ background: "#1f7a6c", color: "#fff", padding: "12px 16px", textAlign: "center" }}>Email verified! You can now log in.</div>}
        <LoginPage
          email={loginEmail} password={loginPassword} submitting={loginSubmitting} error={error}
          onEmailChange={setLoginEmail} onPasswordChange={setLoginPassword}
          onSubmit={() => { void handleLogin(); }}
        />
      </>
    );
  }

  if (showChangePassword) {
    const mustChange = !!(session?.flags as Record<string, unknown>)?.must_change_password;
    return (
      <div className="login-page-shell">
        <section className="login-form-panel">
          <div className="login-form-container">
            <header className="login-form-header">
              <h2>Change Your Password</h2>
              <p>{mustChange ? "You must change your temporary password before continuing." : "Enter your current password and choose a new one."}</p>
            </header>
            <form className="login-form" onSubmit={(e) => { e.preventDefault(); void handleChangePassword(); }}>
              {(["currentPassword", "newPassword", "confirmPassword"] as const).map((field) => (
                <label key={field} className="login-input-group">
                  <span>{field === "currentPassword" ? "Current Password" : field === "newPassword" ? "New Password" : "Confirm New Password"}</span>
                  <div className="login-input-shell">
                    <span className="material-symbols-outlined login-input-icon">{field === "currentPassword" ? "lock" : "key"}</span>
                    <input type="password" value={changePasswordForm[field]} onChange={(e) => setChangePasswordForm((f) => ({ ...f, [field]: e.target.value }))} placeholder={field === "currentPassword" ? "Current password" : field === "newPassword" ? "New password" : "Confirm new password"} required />
                  </div>
                </label>
              ))}
              {error && <p className="error">{error}</p>}
              <button type="submit" className="login-submit-button">Change Password</button>
              {!mustChange && (
                <button type="button" className="login-link-button" onClick={() => {
                  setShowChangePassword(false); setError(null);
                  setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
                }}>Cancel</button>
              )}
            </form>
          </div>
        </section>
      </div>
    );
  }

  const isTenantAdmin = session.user.role === "TENANT_ADMIN";
  const isViewer = session.user.role === "VIEWER";
  const isPlatformAdmin = session.user.isPlatformAdmin;
  const requiresTenantSetup = session.flags.requires_tenant_setup;

  const themeToggle = (
    <button type="button" className="app-button app-button-secondary" style={{ padding: "0.3rem 0.5rem" }} onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
      <span className="material-symbols-outlined" style={{ fontSize: "1.1rem" }}>{theme === "dark" ? "light_mode" : "dark_mode"}</span>
    </button>
  );

  return (
    <div className={isPlatformAdmin ? "layout layout-platform" : "layout"}>
      {isPlatformAdmin ? (
        <PlatformAdminTopNav
          userEmail={session.user.email} onLogout={handleLogout} onChangePassword={() => setShowChangePassword(true)}
          counts={{ tenants: platformStats.tenants, failedDocuments: platformStats.failedDocuments }}
          themeToggle={themeToggle}
        />
      ) : (
        <TenantAdminTopNav
          userEmail={session.user.email} onLogout={handleLogout} onChangePassword={() => setShowChangePassword(true)}
          counts={navCounts} themeToggle={themeToggle}
        />
      )}

      {!isPlatformAdmin && <TenantViewTabs activeTab={activeTab} canViewTenantConfig={isTenantAdmin} onTabChange={setActiveTab} />}

      <section className="controls">
        {requiresTenantSetup && !isPlatformAdmin && isTenantAdmin && (
          <div className="editor-card">
            <div className="editor-header">
              <h3>Tenant Onboarding</h3>
              <button type="button" onClick={() => void handleCompleteOnboarding()}>Complete Onboarding</button>
            </div>
            <div className="edit-grid">
              <label>
                Tenant Name
                <input value={onboardingForm.tenantName} onChange={(e) => setOnboardingForm((s) => ({ ...s, tenantName: e.target.value }))} />
              </label>
              <label>
                Admin Email
                <input value={onboardingForm.adminEmail} onChange={(e) => setOnboardingForm((s) => ({ ...s, adminEmail: e.target.value }))} />
              </label>
            </div>
          </div>
        )}

        {requiresTenantSetup && !isPlatformAdmin && !isTenantAdmin && (
          <EmptyState icon="hourglass_top" heading="Tenant setup in progress" description="Your tenant is being set up. Please contact your tenant administrator to complete the setup." />
        )}

        {activeTab === "exports" && !isPlatformAdmin && <ExportHistoryDashboard />}

        {activeTab === "config" && isTenantAdmin && !isPlatformAdmin && (
          <TenantConfigTab
            currentUserId={session.user.id}
            gmailConnection={gmailConnection}
            onConnectGmail={() => void handleConnectGmail()}
            inviteEmail={inviteEmail}
            onInviteEmailChange={setInviteEmail}
            onInviteUser={() => void guarded(async () => { setError(null); await inviteTenantUser(inviteEmail); setInviteEmail(""); await loadTenantUsers(); }, "Failed to invite user.")}
            tenantUsers={tenantUsers}
            onRoleChange={(userId, role) => void guarded(async () => { setError(null); await assignTenantUserRole(userId, role); await loadTenantUsers(); }, "Failed to update role.")}
            onToggleUserEnabled={(userId, enabled) => void guarded(async () => { setError(null); await setUserEnabled(userId, enabled); await loadTenantUsers(); }, "Failed to update user status.")}
            onRemoveUser={(userId) => void guarded(async () => { setError(null); await removeTenantUser(userId); await loadTenantUsers(); }, "Failed to remove user.")}
          />
        )}

        {activeTab === "connections" && isTenantAdmin && !isPlatformAdmin && (
          <BankConnectionsTab
            mailboxes={mailboxes} tenantUsers={tenantUsers}
            onAddGmailInbox={() => void handleConnectGmail()}
            onAssignMailboxUser={(id, uid) => void guarded(async () => { await assignMailboxUser(id, uid); await loadMailboxes(); }, "Failed to assign user to mailbox.")}
            onRemoveMailboxAssignment={(id, uid) => void guarded(async () => { await removeMailboxAssignment(id, uid); await loadMailboxes(); }, "Failed to remove mailbox assignment.")}
            onRemoveMailbox={(id) => void guarded(async () => { await removeMailbox(id); setMailboxes((prev) => prev.filter((m) => m._id !== id)); }, "Failed to remove mailbox.")}
            bankAccounts={bankAccounts}
            onAddBankAccount={(aa, name) => void guarded(async () => { const r = await initiateBankConsent(aa, name); await loadBankAccounts(); window.location.assign(r.redirectUrl); }, "Failed to initiate bank connection.")}
            onRefreshBankBalance={(id) => void guarded(async () => { await refreshBankBalance(id); await loadBankAccounts(); }, "Failed to refresh bank balance.")}
            onRevokeBankAccount={(id) => void guarded(async () => { await revokeBankAccount(id); setBankAccounts((prev) => prev.filter((a) => a._id !== id)); }, "Failed to disconnect bank account.")}
          />
        )}

        {isPlatformAdmin && activeTab === "dashboard" && (
          <>
            <PlatformOnboardSection
              form={platformOnboardForm} collapsed={platformOnboardCollapsed}
              onToggle={() => setPlatformOnboardCollapsed((v) => !v)}
              onChange={setPlatformOnboardForm}
              onSubmit={() => { void handlePlatformOnboardTenantAdmin(); }}
              helpText="Create a new tenant organization and its first admin user. The admin will receive a temporary password."
            />
            {platformOnboardResult && (
              <div style={{ background: "#e8f5e9", border: "1px solid #4caf50", borderRadius: 6, padding: "12px 16px", margin: "8px 0 16px" }}>
                <strong>Tenant created.</strong> Temporary password for <code>{platformOnboardResult.adminEmail}</code>: <code>{platformOnboardResult.tempPassword}</code>
                <button type="button" style={{ marginLeft: 12 }} className="app-button app-button-secondary" onClick={() => setPlatformOnboardResult(null)}>Dismiss</button>
              </div>
            )}
            <PlatformAnalyticsDashboard usage={platformUsage} />
            <PlatformUsageOverviewSection
              usage={platformUsage} selectedTenantId={selectedPlatformTenantId}
              collapsed={platformUsageCollapsed}
              onToggle={() => setPlatformUsageCollapsed((v) => !v)}
              onRefresh={() => { void loadPlatformUsage(); }}
              onSelectTenant={setSelectedPlatformTenantId}
              onToggleEnabled={(tenantId, enabled) => { void guarded(async () => { await setTenantEnabled(tenantId, enabled); await loadPlatformUsage(); }, "Failed to update tenant status."); }}
            />
            <PlatformActivityMonitor
              selectedTenant={selectedPlatformTenant} collapsed={platformActivityCollapsed}
              onToggle={() => setPlatformActivityCollapsed((v) => !v)}
              onRefresh={() => { void loadPlatformUsage(); }}
            />
          </>
        )}
      </section>

      <div role="alert" aria-live="assertive">
        {error && <p className="error">{error}</p>}
      </div>

      {!isPlatformAdmin && activeTab === "overview" && <OverviewDashboard />}

      {!isPlatformAdmin && activeTab === "dashboard" && (
        <TenantInvoicesView
          tenantId={session.tenant.id} userId={session.user.id} userEmail={session.user.email}
          isTenantAdmin={isTenantAdmin} requiresTenantSetup={requiresTenantSetup}
          tenantMode={session.tenant.mode} isViewer={isViewer}
          tenantUsers={isTenantAdmin ? tenantUsers : undefined}
          onGmailStatusRefresh={() => void loadGmailConnectionStatus()}
          onNavCountsChange={setNavCounts}
          onSessionExpired={() => { clearStoredSessionToken(); setSession(null); }}
          addToast={addToast}
        />
      )}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
