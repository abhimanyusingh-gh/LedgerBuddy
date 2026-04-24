import { useTheme } from "@/hooks/useTheme";
import { useTenantWorkspace } from "@/hooks/useTenantWorkspace";
import { OverviewDashboard } from "@/features/overview/OverviewDashboard";
import { LoginPage } from "@/features/auth/LoginPage";
import { PlatformAdminTopNav } from "@/features/platform-admin/PlatformAdminTopNav";
import { PlatformActivityMonitor } from "@/features/platform-admin/PlatformActivityMonitor";
import { PlatformOnboardSection } from "@/features/platform-admin/PlatformOnboardSection";
import { PlatformUsageOverviewSection } from "@/features/platform-admin/PlatformUsageOverviewSection";
import { PlatformAnalyticsDashboard } from "@/features/platform-admin/PlatformAnalyticsDashboard";
import { WorkspaceTopNav } from "@/features/workspace/WorkspaceTopNav";
import { WorkspaceTabBar } from "@/features/workspace/WorkspaceTabBar";
import { TenantConfigTab } from "@/features/tenant-admin/TenantConfigTab";
import { InvoiceView } from "@/features/invoices/InvoiceView";
import { ExportHistoryDashboard } from "@/features/exports/ExportHistoryDashboard";
import { EmptyState } from "@/components/common/EmptyState";
import { BankConnectionsTab } from "@/features/tenant-admin/BankConnectionsTab";
import { BankStatementsTab } from "@/features/tenant-admin/BankStatementsTab";
import { InvoiceDetailPage } from "@/components/invoice/InvoiceDetailPage";
import { useToast } from "@/hooks/useToast";
import { ToastContainer } from "@/components/common/ToastContainer";

export function App() {
  const { toasts, addToast, removeToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const workspace = useTenantWorkspace({ addToast });

  const {
    authLoading,
    session,
    tenantUsers,
    platformUsage,
    inviteEmail,
    setInviteEmail,
    onboardingForm,
    setOnboardingForm,
    platformOnboardForm,
    setPlatformOnboardForm,
    navCounts,
    setNavCounts,
    gmailConnection,
    mailboxes,
    bankAccounts,
    bankStatements,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginSubmitting,
    activeTab,
    setActiveTab,
    selectedPlatformTenantId,
    setSelectedPlatformTenantId,
    platformOnboardCollapsed,
    setPlatformOnboardCollapsed,
    platformUsageCollapsed,
    setPlatformUsageCollapsed,
    platformActivityCollapsed,
    setPlatformActivityCollapsed,
    showChangePassword,
    setShowChangePassword,
    changePasswordForm,
    setChangePasswordForm,
    platformOnboardResult,
    setPlatformOnboardResult,
    error,
    setError,
    platformStats,
    selectedPlatformTenant,
    handleConnectGmail,
    handleChangePassword,
    handleLogout,
    handleLogin,
    handleCompleteOnboarding,
    handlePlatformOnboardTenantAdmin,
    handleUploadBankStatement,
    handleInviteUser,
    handleRoleChange,
    handleToggleUserEnabled,
    handleRemoveUser,
    handleAssignMailboxUser,
    handleRemoveMailboxAssignment,
    handleRemoveMailbox,
    handleAddBankAccount,
    handleRefreshBankBalance,
    handleRevokeBankAccount,
    handleToggleTenantEnabled,
    loadGmailConnectionStatus,
    loadPlatformUsage,
    loadBankStatements
  } = workspace;

  if (authLoading) {
    return (
      <div className="layout">
        <main className="content content-list-expanded">
          <section className="panel list-panel"><h2>Authenticating...</h2></section>
        </main>
      </div>
    );
  }

  const invoiceDetailId = new URLSearchParams(window.location.search).get("invoiceDetail");
  if (session && invoiceDetailId) {
    return (
      <div className="layout">
        <InvoiceDetailPage invoiceId={invoiceDetailId} />
        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  if (!session) {
    const verified = new URLSearchParams(window.location.search).get("verified") === "true";
    return (
      <>
        {verified && <div className="verified-banner" style={{ background: "#1f7a6c", color: "#fff", padding: "12px 16px", textAlign: "center" }}>Email verified! You can now log in.</div>}
        <LoginPage
          email={loginEmail}
          password={loginPassword}
          submitting={loginSubmitting}
          error={error}
          onEmailChange={setLoginEmail}
          onPasswordChange={setLoginPassword}
          onSubmit={() => { void handleLogin(); }}
        />
      </>
    );
  }

  if (showChangePassword) {
    const mustChange = session.flags.must_change_password;
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
                    <input
                      type="password"
                      value={changePasswordForm[field]}
                      onChange={(e) => setChangePasswordForm((form) => ({ ...form, [field]: e.target.value }))}
                      placeholder={field === "currentPassword" ? "Current password" : field === "newPassword" ? "New password" : "Confirm new password"}
                      required
                    />
                  </div>
                </label>
              ))}
              {error && <p className="error">{error}</p>}
              <button type="submit" className="login-submit-button">Change Password</button>
              {!mustChange && (
                <button
                  type="button"
                  className="login-link-button"
                  onClick={() => {
                    setShowChangePassword(false);
                    setError(null);
                    setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
                  }}
                >
                  Cancel
                </button>
              )}
            </form>
          </div>
        </section>
      </div>
    );
  }

  const caps = session.user.capabilities;
  const isPlatformAdmin = session.user.isPlatformAdmin;
  const requiresTenantSetup = session.flags.requires_tenant_setup;
  const canManageUsers = caps.canManageUsers === true;
  const canManageConnections = caps.canManageConnections === true;
  const canViewConfig = canManageUsers || caps.canConfigureWorkflow === true || caps.canConfigureGlCodes === true || caps.canConfigureCompliance === true;
  const canViewConnections = canManageConnections;
  const canViewAllInvoices = caps.canViewAllInvoices === true;

  const themeToggle = (
    <button
      type="button"
      className="app-button app-button-secondary"
      style={{ padding: "0.3rem 0.5rem" }}
      onClick={toggleTheme}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="material-symbols-outlined" style={{ fontSize: "1.1rem" }}>{theme === "dark" ? "light_mode" : "dark_mode"}</span>
    </button>
  );

  return (
    <div className={isPlatformAdmin ? "layout layout-platform" : "layout"}>
      {isPlatformAdmin ? (
        <PlatformAdminTopNav
          userEmail={session.user.email}
          onLogout={handleLogout}
          onChangePassword={() => setShowChangePassword(true)}
          counts={{ tenants: platformStats.tenants, failedDocuments: platformStats.failedDocuments }}
          themeToggle={themeToggle}
        />
      ) : (
        <WorkspaceTopNav
          userEmail={session.user.email}
          onLogout={handleLogout}
          onChangePassword={() => setShowChangePassword(true)}
          counts={navCounts}
          themeToggle={themeToggle}
          onSelectActionInvoice={(invoiceId) => {
            window.location.search = `?invoiceDetail=${encodeURIComponent(invoiceId)}`;
          }}
        />
      )}

      {!isPlatformAdmin && <WorkspaceTabBar activeTab={activeTab} canViewTenantConfig={canViewConfig} canViewConnections={canViewConnections} onTabChange={setActiveTab} />}

      <section className="controls">
        {requiresTenantSetup && !isPlatformAdmin && canManageUsers && (
          <div className="editor-card">
            <div className="editor-header">
              <h3>Tenant Onboarding</h3>
              <button type="button" onClick={() => void handleCompleteOnboarding()}>Complete Onboarding</button>
            </div>
            <div className="edit-grid">
              <label>
                Tenant Name
                <input value={onboardingForm.tenantName} onChange={(e) => setOnboardingForm((form) => ({ ...form, tenantName: e.target.value }))} />
              </label>
              <label>
                Admin Email
                <input value={onboardingForm.adminEmail} onChange={(e) => setOnboardingForm((form) => ({ ...form, adminEmail: e.target.value }))} />
              </label>
            </div>
          </div>
        )}

        {requiresTenantSetup && !isPlatformAdmin && !canManageUsers && (
          <EmptyState icon="hourglass_top" heading="Tenant setup in progress" description="Your tenant is being set up. Please contact your tenant administrator to complete the setup." />
        )}

        {activeTab === "exports" && !isPlatformAdmin && <ExportHistoryDashboard />}

        {activeTab === "config" && canViewConfig && !isPlatformAdmin && (
          <TenantConfigTab
            currentUserId={session.user.id}
            currentUserRole={session.user.role}
            capabilities={caps}
            gmailConnection={gmailConnection}
            onConnectGmail={() => void handleConnectGmail()}
            inviteEmail={inviteEmail}
            onInviteEmailChange={setInviteEmail}
            onInviteUser={() => void handleInviteUser(inviteEmail)}
            tenantUsers={tenantUsers}
            onRoleChange={(userId, role) => void handleRoleChange(userId, role)}
            onToggleUserEnabled={(userId, enabled) => void handleToggleUserEnabled(userId, enabled)}
            onRemoveUser={(userId) => void handleRemoveUser(userId)}
          />
        )}

        {activeTab === "statements" && canViewConnections && !isPlatformAdmin && (
          <BankStatementsTab
            bankStatements={bankStatements}
            onUploadBankStatement={(file, gstin, gstinLabel) => void handleUploadBankStatement(file, gstin, gstinLabel)}
            onStatementsChanged={() => void loadBankStatements()}
          />
        )}

        {activeTab === "connections" && canViewConnections && !isPlatformAdmin && (
          <BankConnectionsTab
            mailboxes={mailboxes}
            tenantUsers={tenantUsers}
            onAddGmailInbox={() => void handleConnectGmail()}
            onAssignMailboxUser={(id, uid) => void handleAssignMailboxUser(id, uid)}
            onRemoveMailboxAssignment={(id, uid) => void handleRemoveMailboxAssignment(id, uid)}
            onRemoveMailbox={(id) => void handleRemoveMailbox(id)}
            bankAccounts={bankAccounts}
            onAddBankAccount={(aa, name) => void handleAddBankAccount(aa, name)}
            onRefreshBankBalance={(id) => void handleRefreshBankBalance(id)}
            onRevokeBankAccount={(id) => void handleRevokeBankAccount(id)}
          />
        )}

        {isPlatformAdmin && activeTab === "dashboard" && (
          <>
            <PlatformOnboardSection
              form={platformOnboardForm}
              collapsed={platformOnboardCollapsed}
              onToggle={() => setPlatformOnboardCollapsed((value) => !value)}
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
              usage={platformUsage}
              selectedTenantId={selectedPlatformTenantId}
              collapsed={platformUsageCollapsed}
              onToggle={() => setPlatformUsageCollapsed((value) => !value)}
              onRefresh={() => { void loadPlatformUsage(); }}
              onSelectTenant={setSelectedPlatformTenantId}
              onToggleEnabled={(tenantId, enabled) => { void handleToggleTenantEnabled(tenantId, enabled); }}
            />
            <PlatformActivityMonitor
              selectedTenant={selectedPlatformTenant}
              collapsed={platformActivityCollapsed}
              onToggle={() => setPlatformActivityCollapsed((value) => !value)}
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
        <InvoiceView
          tenantId={session.tenant.id}
          userId={session.user.id}
          userEmail={session.user.email}
          canViewAllInvoices={canViewAllInvoices}
          requiresTenantSetup={requiresTenantSetup}
          tenantMode={session.tenant.mode}
          capabilities={caps}
          tenantUsers={canManageUsers ? tenantUsers : undefined}
          onGmailStatusRefresh={() => void loadGmailConnectionStatus()}
          onNavCountsChange={setNavCounts}
          onSessionExpired={handleLogout}
          addToast={addToast}
        />
      )}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
