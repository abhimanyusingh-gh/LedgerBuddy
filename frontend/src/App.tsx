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
import { BankConnectionsTab } from "./components/BankConnectionsTab";
import { getUserFacingErrorMessage } from "./apiError";
import { useToast } from "./hooks/useToast";
import { ToastContainer } from "./components/ToastContainer";

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
  const [tenantUsers, setTenantUsers] = useState<Array<{ userId: string; email: string; role: "TENANT_ADMIN" | "MEMBER"; enabled: boolean }>>(
    []
  );
  const [platformUsage, setPlatformUsage] = useState<PlatformTenantUsageSummary[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [onboardingForm, setOnboardingForm] = useState({
    tenantName: "",
    adminEmail: ""
  });
  const [platformOnboardForm, setPlatformOnboardForm] = useState({
    tenantName: "",
    adminEmail: "",
    adminDisplayName: "",
    mode: "test" as string
  });
  const [navCounts, setNavCounts] = useState({ total: 0, approved: 0, pending: 0 });
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionStatus | null>(null);
  const [mailboxes, setMailboxes] = useState<TenantMailbox[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
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

  useEffect(() => {
    void bootstrapSession();
  }, []);

  useEffect(() => {
    if (!session) {
      setActiveTab("overview");
      return;
    }
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
        setOnboardingForm({
          tenantName: session.tenant.name,
          adminEmail: session.user.email
        });
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

    setSelectedPlatformTenantId((currentValue) =>
      currentValue && platformUsage.some((entry) => entry.tenantId === currentValue)
        ? currentValue
        : platformUsage[0].tenantId
    );
  }, [platformUsage]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bankStatus = params.get("bank");
    if (bankStatus === "error") {
      addToast("error", "Bank connection failed. Please try again.");
      params.delete("bank");
      const query = params.toString();
      const nextUrl = `${window.location.pathname}${query.length > 0 ? `?${query}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (!gmailStatus) {
      return;
    }

    if (gmailStatus === "error") {
      const reason = params.get("reason");
      setError(reason ? `Gmail reconnect failed: ${reason}` : "Gmail reconnect failed.");
    }

    if (gmailStatus === "connected") {
      setError(null);
    }

    if (session) {
      void loadGmailConnectionStatus();
      if (session.user.isPlatformAdmin) {
        void loadPlatformUsage();
      } else if (session.user.role === "TENANT_ADMIN") {
        void loadMailboxes();
      }
    }
    params.delete("gmail");
    params.delete("reason");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query.length > 0 ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [session]);

  const platformStats = useMemo(() => {
    return {
      tenants: platformUsage.length,
      users: platformUsage.reduce((sum, entry) => sum + entry.userCount, 0),
      totalDocuments: platformUsage.reduce((sum, entry) => sum + entry.totalDocuments, 0),
      approvedDocuments: platformUsage.reduce((sum, entry) => sum + entry.approvedDocuments, 0),
      exportedDocuments: platformUsage.reduce((sum, entry) => sum + entry.exportedDocuments, 0),
      failedDocuments: platformUsage.reduce((sum, entry) => sum + entry.failedDocuments, 0)
    };
  }, [platformUsage]);

  const selectedPlatformTenant = useMemo(
    () => platformUsage.find((entry) => entry.tenantId === selectedPlatformTenantId) ?? null,
    [platformUsage, selectedPlatformTenantId]
  );

  async function bootstrapSession() {
    setAuthLoading(true);
    const params = new URLSearchParams(window.location.search);
    const callbackToken = params.get("token");
    const callbackNext = params.get("next");
    if (callbackToken) {
      setStoredSessionToken(callbackToken);
      params.delete("token");
      params.delete("next");
      const query = params.toString();
      const targetPath = callbackNext && callbackNext.startsWith("/") ? callbackNext : window.location.pathname;
      window.history.replaceState({}, "", `${targetPath}${query.length > 0 ? `?${query}` : ""}`);
    }

    const storedToken = getStoredSessionToken();
    if (!storedToken) {
      setSession(null);
      setAuthLoading(false);
      return;
    }

    try {
      const sessionContext = await fetchSessionContext();
      setSession(sessionContext);
      setError(null);
      if ((sessionContext.flags as Record<string, unknown>).must_change_password) {
        setShowChangePassword(true);
      }
    } catch {
      clearStoredSessionToken();
      setSession(null);
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadTenantUsers() {
    if (!session || session.user.role !== "TENANT_ADMIN") {
      return;
    }
    try {
      const users = await fetchTenantUsers();
      setTenantUsers(users);
    } catch (loadError) {
      setError(getUserFacingErrorMessage(loadError, "Failed to load tenant users."));
    }
  }

  async function loadPlatformUsage() {
    if (!session?.user.isPlatformAdmin) {
      return;
    }
    try {
      const usage = await fetchPlatformTenantUsage();
      setPlatformUsage(usage);
    } catch (loadError) {
      setError(getUserFacingErrorMessage(loadError, "Failed to load tenant usage overview."));
    }
  }

  async function handleToggleTenantEnabled(tenantId: string, enabled: boolean) {
    try {
      await setTenantEnabled(tenantId, enabled);
      await loadPlatformUsage();
    } catch (toggleError) {
      setError(getUserFacingErrorMessage(toggleError, "Failed to update tenant status."));
    }
  }

  async function loadGmailConnectionStatus() {
    if (!session) {
      return;
    }
    try {
      const status = await fetchGmailConnectionStatus();
      setGmailConnection(status);
    } catch {
      setGmailConnection({
        provider: "gmail",
        connectionState: "DISCONNECTED"
      });
    }
  }

  async function handleConnectGmail() {
    try {
      const connectUrl = await fetchGmailConnectUrl();
      window.location.assign(connectUrl);
    } catch (connectError) {
      setError(getUserFacingErrorMessage(connectError, "Failed to start Gmail connection flow."));
    }
  }

  async function loadMailboxes() {
    try {
      const items = await fetchMailboxes();
      setMailboxes(items);
    } catch {
      setMailboxes([]);
    }
  }

  async function handleAssignMailboxUser(integrationId: string, userId: string) {
    try {
      await assignMailboxUser(integrationId, userId);
      await loadMailboxes();
    } catch (assignError) {
      setError(getUserFacingErrorMessage(assignError, "Failed to assign user to mailbox."));
    }
  }

  async function handleRemoveMailboxAssignment(integrationId: string, userId: string) {
    try {
      await removeMailboxAssignment(integrationId, userId);
      await loadMailboxes();
    } catch (removeError) {
      setError(getUserFacingErrorMessage(removeError, "Failed to remove mailbox assignment."));
    }
  }

  async function handleRemoveMailbox(integrationId: string) {
    try {
      await removeMailbox(integrationId);
      setMailboxes((prev) => prev.filter((m) => m._id !== integrationId));
    } catch (removeError) {
      setError(getUserFacingErrorMessage(removeError, "Failed to remove mailbox."));
    }
  }

  async function loadBankAccounts() {
    try {
      const items = await fetchBankAccounts();
      setBankAccounts(items);
    } catch {
      setBankAccounts([]);
    }
  }

  async function handleAddBankAccount(aaAddress: string, displayName: string) {
    try {
      const result = await initiateBankConsent(aaAddress, displayName);
      await loadBankAccounts();
      window.location.assign(result.redirectUrl);
    } catch (addError) {
      setError(getUserFacingErrorMessage(addError, "Failed to initiate bank connection."));
    }
  }

  async function handleRefreshBankBalance(id: string) {
    try {
      await refreshBankBalance(id);
      await loadBankAccounts();
    } catch (refreshError) {
      setError(getUserFacingErrorMessage(refreshError, "Failed to refresh bank balance."));
    }
  }

  async function handleRevokeBankAccount(id: string) {
    try {
      await revokeBankAccount(id);
      setBankAccounts((prev) => prev.filter((a) => a._id !== id));
    } catch (revokeError) {
      setError(getUserFacingErrorMessage(revokeError, "Failed to disconnect bank account."));
    }
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
    try {
      setError(null);
      await changePassword(changePasswordForm.currentPassword, changePasswordForm.newPassword);
      setShowChangePassword(false);
      setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      await bootstrapSession();
    } catch (changeError) {
      setError(getUserFacingErrorMessage(changeError, "Failed to change password."));
    }
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
    if (!normalizedEmail || !loginPassword) {
      setError("Enter email and password.");
      return;
    }

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
    if (!session) {
      return;
    }
    try {
      setError(null);
      await completeTenantOnboarding({
        tenantName: onboardingForm.tenantName,
        adminEmail: onboardingForm.adminEmail
      });
      const refreshed = await fetchSessionContext();
      setSession(refreshed);
    } catch (setupError) {
      setError(getUserFacingErrorMessage(setupError, "Failed to complete onboarding."));
    }
  }

  async function handleInviteUser() {
    try {
      setError(null);
      await inviteTenantUser(inviteEmail);
      setInviteEmail("");
      await loadTenantUsers();
    } catch (inviteError) {
      setError(getUserFacingErrorMessage(inviteError, "Failed to invite user."));
    }
  }

  async function handlePlatformOnboardTenantAdmin() {
    const tenantName = platformOnboardForm.tenantName.trim();
    const adminEmail = platformOnboardForm.adminEmail.trim().toLowerCase();
    const adminDisplayName = platformOnboardForm.adminDisplayName.trim();
    if (!tenantName || !adminEmail) {
      setError("Enter tenant name and tenant admin email.");
      return;
    }

    try {
      setError(null);
      const result = await onboardTenantAdmin({
        tenantName,
        adminEmail,
        ...(adminDisplayName ? { adminDisplayName } : {}),
        mode: platformOnboardForm.mode
      });
      setPlatformOnboardForm({
        tenantName: "",
        adminEmail: "",
        adminDisplayName: "",
        mode: "test"
      });
      if (result.tempPassword) {
        setPlatformOnboardResult({ tempPassword: result.tempPassword, adminEmail: result.adminEmail });
      }
      await loadPlatformUsage();
      setPlatformUsageCollapsed(false);
    } catch (onboardError) {
      setError(getUserFacingErrorMessage(onboardError, "Failed to onboard tenant admin."));
    }
  }

  async function handleRoleChange(userId: string, role: "TENANT_ADMIN" | "MEMBER") {
    try {
      setError(null);
      await assignTenantUserRole(userId, role);
      await loadTenantUsers();
    } catch (assignError) {
      setError(getUserFacingErrorMessage(assignError, "Failed to update role."));
    }
  }

  async function handleToggleUserEnabled(userId: string, enabled: boolean) {
    try {
      setError(null);
      await setUserEnabled(userId, enabled);
      await loadTenantUsers();
    } catch (toggleError) {
      setError(getUserFacingErrorMessage(toggleError, "Failed to update user status."));
    }
  }

  async function handleRemoveUser(userId: string) {
    try {
      setError(null);
      await removeTenantUser(userId);
      await loadTenantUsers();
    } catch (removeError) {
      setError(getUserFacingErrorMessage(removeError, "Failed to remove user."));
    }
  }

  if (authLoading) {
    return (
      <div className="layout">
        <main className="content content-list-expanded">
          <section className="panel list-panel">
            <h2>Authenticating...</h2>
          </section>
        </main>
      </div>
    );
  }

  if (!session) {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get("verified") === "true";
    return (
      <>
        {verified ? <div className="verified-banner" style={{ background: "#1f7a6c", color: "#fff", padding: "12px 16px", textAlign: "center" }}>Email verified! You can now log in.</div> : null}
        <LoginPage
          email={loginEmail}
          password={loginPassword}
          submitting={loginSubmitting}
          error={error}
          onEmailChange={setLoginEmail}
          onPasswordChange={setLoginPassword}
          onSubmit={() => {
            void handleLogin();
          }}
        />
      </>
    );
  }

  if (showChangePassword) {
    return (
      <div className="login-page-shell">
        <section className="login-form-panel">
          <div className="login-form-container">
            <header className="login-form-header">
              <h2>Change Your Password</h2>
              <p>{(session?.flags as Record<string, unknown>)?.must_change_password ? "You must change your temporary password before continuing." : "Enter your current password and choose a new one."}</p>
            </header>
            <form className="login-form" onSubmit={(e) => { e.preventDefault(); void handleChangePassword(); }}>
              <label className="login-input-group">
                <span>Current Password</span>
                <div className="login-input-shell">
                  <span className="material-symbols-outlined login-input-icon">lock</span>
                  <input type="password" value={changePasswordForm.currentPassword} onChange={(e) => setChangePasswordForm((f) => ({ ...f, currentPassword: e.target.value }))} placeholder="Current password" required />
                </div>
              </label>
              <label className="login-input-group">
                <span>New Password</span>
                <div className="login-input-shell">
                  <span className="material-symbols-outlined login-input-icon">key</span>
                  <input type="password" value={changePasswordForm.newPassword} onChange={(e) => setChangePasswordForm((f) => ({ ...f, newPassword: e.target.value }))} placeholder="New password" required />
                </div>
              </label>
              <label className="login-input-group">
                <span>Confirm New Password</span>
                <div className="login-input-shell">
                  <span className="material-symbols-outlined login-input-icon">key</span>
                  <input type="password" value={changePasswordForm.confirmPassword} onChange={(e) => setChangePasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))} placeholder="Confirm new password" required />
                </div>
              </label>
              {error ? <p className="error">{error}</p> : null}
              <button type="submit" className="login-submit-button">Change Password</button>
              {!(session?.flags as Record<string, unknown>)?.must_change_password && (
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

  return (
    <div className={isPlatformAdmin ? "layout layout-platform" : "layout"}>
      {isPlatformAdmin ? (
        <PlatformAdminTopNav
          userEmail={session.user.email}
          onLogout={handleLogout}
          onChangePassword={() => setShowChangePassword(true)}
          counts={{ tenants: platformStats.tenants, failedDocuments: platformStats.failedDocuments }}
          themeToggle={<button type="button" className="app-button app-button-secondary" style={{ padding: "0.3rem 0.5rem" }} onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}><span className="material-symbols-outlined" style={{ fontSize: "1.1rem" }}>{theme === "dark" ? "light_mode" : "dark_mode"}</span></button>}
        />
      ) : (
        <TenantAdminTopNav userEmail={session.user.email} onLogout={handleLogout} onChangePassword={() => setShowChangePassword(true)} counts={navCounts}
          themeToggle={<button type="button" className="app-button app-button-secondary" style={{ padding: "0.3rem 0.5rem" }} onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}><span className="material-symbols-outlined" style={{ fontSize: "1.1rem" }}>{theme === "dark" ? "light_mode" : "dark_mode"}</span></button>}
        />
      )}

      {!isPlatformAdmin ? (
        <TenantViewTabs
          activeTab={activeTab}
          canViewTenantConfig={isTenantAdmin}
          onTabChange={setActiveTab}
        />
      ) : null}

      <section className="controls">
        {requiresTenantSetup && !isPlatformAdmin ? (
          <div className="editor-card">
            <div className="editor-header">
              <h3>Tenant Onboarding</h3>
              {isTenantAdmin ? (
                <button type="button" onClick={() => void handleCompleteOnboarding()}>
                  Complete Onboarding
                </button>
              ) : null}
            </div>
            <div className="edit-grid">
              <label>
                Tenant Name
                <input
                  value={onboardingForm.tenantName}
                  disabled={!isTenantAdmin}
                  onChange={(event) => setOnboardingForm((state) => ({ ...state, tenantName: event.target.value }))}
                />
              </label>
              <label>
                Admin Email
                <input
                  value={onboardingForm.adminEmail}
                  disabled={!isTenantAdmin}
                  onChange={(event) => setOnboardingForm((state) => ({ ...state, adminEmail: event.target.value }))}
                />
              </label>
            </div>
            {!isTenantAdmin ? <p className="muted">Only tenant admins can complete onboarding.</p> : null}
          </div>
        ) : null}

        {activeTab === "exports" && !isPlatformAdmin ? (
          <ExportHistoryDashboard />
        ) : null}

        {activeTab === "config" && isTenantAdmin && !isPlatformAdmin ? (
          <TenantConfigTab
            gmailConnection={gmailConnection}
            onConnectGmail={() => void handleConnectGmail()}
            inviteEmail={inviteEmail}
            onInviteEmailChange={setInviteEmail}
            onInviteUser={() => void handleInviteUser()}
            tenantUsers={tenantUsers}
            onRoleChange={(userId, role) => void handleRoleChange(userId, role)}
            onToggleUserEnabled={(userId, enabled) => void handleToggleUserEnabled(userId, enabled)}
            onRemoveUser={(userId) => void handleRemoveUser(userId)}
            mailboxes={mailboxes}
            onAssignMailboxUser={(integrationId, userId) => void handleAssignMailboxUser(integrationId, userId)}
            onRemoveMailboxAssignment={(integrationId, userId) => void handleRemoveMailboxAssignment(integrationId, userId)}
            onRemoveMailbox={(integrationId) => void handleRemoveMailbox(integrationId)}
          />
        ) : null}

        {activeTab === "connections" && isTenantAdmin && !isPlatformAdmin ? (
          <BankConnectionsTab
            mailboxes={mailboxes}
            tenantUsers={tenantUsers}
            onAddGmailInbox={() => void handleConnectGmail()}
            onAssignMailboxUser={(integrationId, userId) => void handleAssignMailboxUser(integrationId, userId)}
            onRemoveMailboxAssignment={(integrationId, userId) => void handleRemoveMailboxAssignment(integrationId, userId)}
            onRemoveMailbox={(integrationId) => void handleRemoveMailbox(integrationId)}
            bankAccounts={bankAccounts}
            onAddBankAccount={(aaAddress, displayName) => void handleAddBankAccount(aaAddress, displayName)}
            onRefreshBankBalance={(id) => void handleRefreshBankBalance(id)}
            onRevokeBankAccount={(id) => void handleRevokeBankAccount(id)}
          />
        ) : null}

        {isPlatformAdmin && activeTab === "dashboard" ? (
          <>
            <PlatformOnboardSection
              form={platformOnboardForm}
              collapsed={platformOnboardCollapsed}
              onToggle={() => setPlatformOnboardCollapsed((currentValue) => !currentValue)}
              onChange={setPlatformOnboardForm}
              onSubmit={() => {
                void handlePlatformOnboardTenantAdmin();
              }}
              helpText="Create a new tenant organization and its first admin user. The admin will receive a temporary password."
            />
            {platformOnboardResult ? (
              <div style={{ background: "#e8f5e9", border: "1px solid #4caf50", borderRadius: 6, padding: "12px 16px", margin: "8px 0 16px" }}>
                <strong>Tenant created.</strong> Temporary password for <code>{platformOnboardResult.adminEmail}</code>: <code>{platformOnboardResult.tempPassword}</code>
                <button type="button" style={{ marginLeft: 12 }} className="app-button app-button-secondary" onClick={() => setPlatformOnboardResult(null)}>Dismiss</button>
              </div>
            ) : null}
            <PlatformAnalyticsDashboard usage={platformUsage} />
            <PlatformUsageOverviewSection
              usage={platformUsage}
              selectedTenantId={selectedPlatformTenantId}
              collapsed={platformUsageCollapsed}
              onToggle={() => setPlatformUsageCollapsed((currentValue) => !currentValue)}
              onRefresh={() => {
                void loadPlatformUsage();
              }}
              onSelectTenant={setSelectedPlatformTenantId}
              onToggleEnabled={(tenantId, enabled) => { void handleToggleTenantEnabled(tenantId, enabled); }}
            />
            <PlatformActivityMonitor
              selectedTenant={selectedPlatformTenant}
              collapsed={platformActivityCollapsed}
              onToggle={() => setPlatformActivityCollapsed((currentValue) => !currentValue)}
              onRefresh={() => {
                void loadPlatformUsage();
              }}
            />
          </>
        ) : null}
      </section>

      {error ? <p className="error">{error}</p> : null}

      {!isPlatformAdmin && activeTab === "overview" ? (
        <OverviewDashboard />
      ) : null}

      {!isPlatformAdmin && activeTab === "dashboard" ? (
        <TenantInvoicesView
          tenantId={session.tenant.id}
          userId={session.user.id}
          userEmail={session.user.email}
          isTenantAdmin={isTenantAdmin}
          requiresTenantSetup={requiresTenantSetup}
          tenantMode={session.tenant.mode}
          isViewer={isViewer}
          tenantUsers={isTenantAdmin ? tenantUsers : undefined}
          onGmailStatusRefresh={() => void loadGmailConnectionStatus()}
          onNavCountsChange={setNavCounts}
          onSessionExpired={() => { clearStoredSessionToken(); setSession(null); }}
          addToast={addToast}
        />
      ) : null}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
