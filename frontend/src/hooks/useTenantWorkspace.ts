import { useCallback, useState } from "react";
import { getUserFacingErrorMessage } from "../apiError";
import { useTenantWorkspaceConnections } from "./useTenantWorkspaceConnections";
import { useTenantWorkspacePlatform } from "./useTenantWorkspacePlatform";
import { useTenantWorkspaceSession } from "./useTenantWorkspaceSession";
import type { TenantViewTab } from "../components/tenantAdmin/TenantViewTabs";

interface UseTenantWorkspaceOptions {
  addToast: (type: "success" | "error" | "info", message: string) => void;
}

export function useTenantWorkspace({ addToast }: UseTenantWorkspaceOptions) {
  const [error, setError] = useState<string | null>(null);
  const [navCounts, setNavCounts] = useState({ total: 0, approved: 0, pending: 0, failed: 0 });
  const [activeTab, setActiveTabRaw] = useState(() => {
    const stored = localStorage.getItem("billforge:active-tab");
    const valid: TenantViewTab[] = ["overview", "dashboard", "config", "exports", "connections"];
    return stored && valid.includes(stored as TenantViewTab) ? (stored as TenantViewTab) : "overview";
  });

  const guarded = useCallback(async (fn: () => Promise<void>, fallbackMsg: string) => {
    try {
      await fn();
    } catch (e) {
      setError(getUserFacingErrorMessage(e, fallbackMsg));
    }
  }, []);

  const setActiveTab = useCallback((tab: TenantViewTab) => {
    setActiveTabRaw(tab);
    localStorage.setItem("billforge:active-tab", tab);
  }, []);

  const session = useTenantWorkspaceSession({ guarded, setError });
  const connections = useTenantWorkspaceConnections({
    session: session.session,
    guarded,
    setError,
    addToast
  });
  const platform = useTenantWorkspacePlatform({ session: session.session, guarded });

  return {
    authLoading: session.authLoading,
    session: session.session,
    setSession: session.setSession,
    tenantUsers: connections.tenantUsers,
    setTenantUsers: connections.setTenantUsers,
    platformUsage: platform.platformUsage,
    inviteEmail: connections.inviteEmail,
    setInviteEmail: connections.setInviteEmail,
    onboardingForm: session.onboardingForm,
    setOnboardingForm: session.setOnboardingForm,
    platformOnboardForm: platform.platformOnboardForm,
    setPlatformOnboardForm: platform.setPlatformOnboardForm,
    navCounts,
    setNavCounts,
    gmailConnection: connections.gmailConnection,
    mailboxes: connections.mailboxes,
    setMailboxes: connections.setMailboxes,
    bankAccounts: connections.bankAccounts,
    setBankAccounts: connections.setBankAccounts,
    bankStatements: connections.bankStatements,
    setBankStatements: connections.setBankStatements,
    loginEmail: session.loginEmail,
    setLoginEmail: session.setLoginEmail,
    loginPassword: session.loginPassword,
    setLoginPassword: session.setLoginPassword,
    loginSubmitting: session.loginSubmitting,
    activeTab,
    setActiveTab,
    selectedPlatformTenantId: platform.selectedPlatformTenantId,
    setSelectedPlatformTenantId: platform.setSelectedPlatformTenantId,
    platformOnboardCollapsed: platform.platformOnboardCollapsed,
    setPlatformOnboardCollapsed: platform.setPlatformOnboardCollapsed,
    platformUsageCollapsed: platform.platformUsageCollapsed,
    setPlatformUsageCollapsed: platform.setPlatformUsageCollapsed,
    platformActivityCollapsed: platform.platformActivityCollapsed,
    setPlatformActivityCollapsed: platform.setPlatformActivityCollapsed,
    showChangePassword: session.showChangePassword,
    setShowChangePassword: session.setShowChangePassword,
    changePasswordForm: session.changePasswordForm,
    setChangePasswordForm: session.setChangePasswordForm,
    platformOnboardResult: platform.platformOnboardResult,
    setPlatformOnboardResult: platform.setPlatformOnboardResult,
    error,
    setError,
    platformStats: platform.platformStats,
    selectedPlatformTenant: platform.selectedPlatformTenant,
    handleConnectGmail: connections.handleConnectGmail,
    handleChangePassword: session.handleChangePassword,
    handleLogout: session.handleLogout,
    handleLogin: session.handleLogin,
    handleCompleteOnboarding: session.handleCompleteOnboarding,
    handlePlatformOnboardTenantAdmin: platform.handlePlatformOnboardTenantAdmin,
    handleUploadBankStatement: connections.handleUploadBankStatement,
    handleInviteUser: connections.handleInviteUser,
    handleRoleChange: connections.handleRoleChange,
    handleToggleUserEnabled: connections.handleToggleUserEnabled,
    handleRemoveUser: connections.handleRemoveUser,
    handleAssignMailboxUser: connections.handleAssignMailboxUser,
    handleRemoveMailboxAssignment: connections.handleRemoveMailboxAssignment,
    handleRemoveMailbox: connections.handleRemoveMailbox,
    handleAddBankAccount: connections.handleAddBankAccount,
    handleRefreshBankBalance: connections.handleRefreshBankBalance,
    handleRevokeBankAccount: connections.handleRevokeBankAccount,
    handleToggleTenantEnabled: platform.handleToggleTenantEnabled,
    loadGmailConnectionStatus: connections.loadGmailConnectionStatus,
    loadPlatformUsage: platform.loadPlatformUsage,
    loadMailboxes: connections.loadMailboxes,
    loadBankAccounts: connections.loadBankAccounts,
    loadBankStatements: connections.loadBankStatements,
    loadTenantUsers: connections.loadTenantUsers,
    guarded
  };
}
