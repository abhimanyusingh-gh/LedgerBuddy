import { useCallback, useEffect, useState } from "react";
import {
  assignMailboxUser,
  assignTenantUserRole,
  fetchBankAccounts,
  fetchBankStatements,
  fetchGmailConnectUrl,
  fetchGmailConnectionStatus,
  fetchMailboxes,
  fetchTenantUsers,
  initiateBankConsent,
  inviteTenantUser,
  removeMailbox,
  removeMailboxAssignment,
  removeTenantUser,
  refreshBankBalance,
  revokeBankAccount,
  setUserEnabled,
  uploadBankStatement
} from "@/api";
import type { BankAccount, BankStatementSummary, GmailConnectionStatus, TenantMailbox, TenantRole, TenantUser } from "@/types";
import type { WorkspaceGuard, WorkspaceSessionContext } from "@/hooks/useTenantWorkspaceSession";

interface UseTenantWorkspaceConnectionsOptions {
  session: WorkspaceSessionContext | null;
  guarded: WorkspaceGuard;
  setError: (value: string | null) => void;
  addToast: (type: "success" | "error" | "info", message: string) => void;
}

function cleanUrlParams(...keys: string[]) {
  const params = new URLSearchParams(window.location.search);
  for (const key of keys) params.delete(key);
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

export function useTenantWorkspaceConnections({ session, guarded, setError, addToast }: UseTenantWorkspaceConnectionsOptions) {
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionStatus | null>(null);
  const [mailboxes, setMailboxes] = useState<TenantMailbox[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankStatements, setBankStatements] = useState<BankStatementSummary[]>([]);

  const loadTenantUsers = useCallback(async () => {
    if (!session || session.user.capabilities.canManageUsers !== true) return;
    await guarded(async () => {
      setTenantUsers(await fetchTenantUsers());
    }, "Failed to load tenant users.");
  }, [guarded, session]);

  const loadGmailConnectionStatus = useCallback(async () => {
    if (!session) return;
    try {
      setGmailConnection(await fetchGmailConnectionStatus());
    } catch {
      setGmailConnection({ provider: "gmail", connectionState: "DISCONNECTED" });
    }
  }, [session]);

  const loadMailboxes = useCallback(async () => {
    try {
      setMailboxes(await fetchMailboxes());
    } catch {
      setMailboxes([]);
    }
  }, []);

  const loadBankAccounts = useCallback(async () => {
    try {
      setBankAccounts(await fetchBankAccounts());
    } catch {
      setBankAccounts([]);
    }
  }, []);

  const loadBankStatements = useCallback(async () => {
    try {
      const result = await fetchBankStatements();
      setBankStatements(result.items);
    } catch {
      setBankStatements([]);
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setTenantUsers([]);
      setGmailConnection(null);
      setMailboxes([]);
      setBankAccounts([]);
      setBankStatements([]);
      return;
    }

    if (session.user.isPlatformAdmin) {
      setTenantUsers([]);
      setGmailConnection(null);
      setMailboxes([]);
      setBankAccounts([]);
      setBankStatements([]);
      return;
    }

    const canManageUsers = session.user.capabilities.canManageUsers === true;
    const canManageConnections = session.user.capabilities.canManageConnections === true;
    void loadGmailConnectionStatus();
    if (canManageUsers) {
      void loadTenantUsers();
    } else {
      setTenantUsers([]);
    }
    if (canManageConnections) {
      void loadMailboxes();
      void loadBankAccounts();
      void loadBankStatements();
    } else {
      setMailboxes([]);
      setBankAccounts([]);
      setBankStatements([]);
    }
  }, [loadBankAccounts, loadBankStatements, loadGmailConnectionStatus, loadMailboxes, loadTenantUsers, session]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("bank") === "error") {
      addToast("error", "Bank connection failed. Please try again.");
      cleanUrlParams("bank");
    }
  }, [addToast]);

  const handleConnectGmail = useCallback(async () => {
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
  }, [guarded, loadGmailConnectionStatus, loadMailboxes]);

  const handleInviteUser = useCallback(async (email: string) => {
    await guarded(async () => {
      setError(null);
      await inviteTenantUser(email);
      setInviteEmail("");
      await loadTenantUsers();
    }, "Failed to invite user.");
  }, [guarded, loadTenantUsers, setError]);

  const handleRoleChange = useCallback(async (userId: string, role: TenantRole) => {
    await guarded(async () => {
      setError(null);
      await assignTenantUserRole(userId, role);
      await loadTenantUsers();
    }, "Failed to update role.");
  }, [guarded, loadTenantUsers, setError]);

  const handleToggleUserEnabled = useCallback(async (userId: string, enabled: boolean) => {
    await guarded(async () => {
      setError(null);
      await setUserEnabled(userId, enabled);
      await loadTenantUsers();
    }, "Failed to update user status.");
  }, [guarded, loadTenantUsers, setError]);

  const handleRemoveUser = useCallback(async (userId: string) => {
    await guarded(async () => {
      setError(null);
      await removeTenantUser(userId);
      await loadTenantUsers();
    }, "Failed to remove user.");
  }, [guarded, loadTenantUsers, setError]);

  const handleAssignMailboxUser = useCallback(async (integrationId: string, userId: string) => {
    await guarded(async () => {
      await assignMailboxUser(integrationId, userId);
      await loadMailboxes();
    }, "Failed to assign user to mailbox.");
  }, [guarded, loadMailboxes]);

  const handleRemoveMailboxAssignment = useCallback(async (integrationId: string, userId: string) => {
    await guarded(async () => {
      await removeMailboxAssignment(integrationId, userId);
      await loadMailboxes();
    }, "Failed to remove mailbox assignment.");
  }, [guarded, loadMailboxes]);

  const handleRemoveMailbox = useCallback(async (integrationId: string) => {
    await guarded(async () => {
      await removeMailbox(integrationId);
      setMailboxes((prev) => prev.filter((mailbox) => mailbox._id !== integrationId));
    }, "Failed to remove mailbox.");
  }, [guarded]);

  const handleAddBankAccount = useCallback(async (aaAddress: string, displayName: string) => {
    await guarded(async () => {
      const result = await initiateBankConsent(aaAddress, displayName);
      await loadBankAccounts();
      window.location.assign(result.redirectUrl);
    }, "Failed to initiate bank connection.");
  }, [guarded, loadBankAccounts]);

  const handleRefreshBankBalance = useCallback(async (id: string) => {
    await guarded(async () => {
      await refreshBankBalance(id);
      await loadBankAccounts();
    }, "Failed to refresh bank balance.");
  }, [guarded, loadBankAccounts]);

  const handleRevokeBankAccount = useCallback(async (id: string) => {
    await guarded(async () => {
      await revokeBankAccount(id);
      setBankAccounts((prev) => prev.filter((account) => account._id !== id));
    }, "Failed to disconnect bank account.");
  }, [guarded]);

  const handleUploadBankStatement = useCallback(async (file: File, gstin?: string, gstinLabel?: string) => {
    await guarded(async () => {
      await uploadBankStatement(file, undefined, gstin, gstinLabel);
      await loadBankStatements();
      addToast("success", `Uploaded bank statement: ${file.name}`);
    }, "Failed to upload bank statement.");
  }, [addToast, guarded, loadBankStatements]);

  return {
    tenantUsers,
    setTenantUsers,
    inviteEmail,
    setInviteEmail,
    gmailConnection,
    mailboxes,
    setMailboxes,
    bankAccounts,
    setBankAccounts,
    bankStatements,
    setBankStatements,
    loadTenantUsers,
    loadGmailConnectionStatus,
    loadMailboxes,
    loadBankAccounts,
    loadBankStatements,
    handleConnectGmail,
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
    handleUploadBankStatement
  };
}
