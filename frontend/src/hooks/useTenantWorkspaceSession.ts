import { useCallback, useEffect, useState } from "react";
import {
  cancelProactiveRefresh,
  changePassword,
  clearStoredSessionToken,
  completeTenantOnboarding,
  fetchSessionContext,
  getStoredSessionToken,
  loginWithCredentials,
  scheduleProactiveRefresh,
  setStoredSessionToken
} from "@/api";
import { getUserFacingErrorMessage } from "@/lib/common/apiError";
import type { SessionUser } from "@/types";

export type WorkspaceGuard = (fn: () => Promise<void>, fallbackMsg: string) => Promise<void>;

export type WorkspaceSessionContext = {
  user: SessionUser;
  tenant: { id: string; name: string; onboarding_status: "pending" | "completed"; mode?: "test" | "live" };
  flags: {
    requires_tenant_setup: boolean;
    requires_reauth: boolean;
    requires_admin_action: boolean;
    must_change_password: boolean;
  };
  featureFlags: Record<string, boolean>;
};

interface UseTenantWorkspaceSessionOptions {
  guarded: WorkspaceGuard;
  setError: (value: string | null) => void;
}

function cleanUrlParams(...keys: string[]) {
  const params = new URLSearchParams(window.location.search);
  for (const key of keys) params.delete(key);
  const query = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
}

export function useTenantWorkspaceSession({ guarded, setError }: UseTenantWorkspaceSessionOptions) {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<WorkspaceSessionContext | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordForm, setChangePasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [onboardingForm, setOnboardingForm] = useState({ tenantName: "", adminEmail: "" });

  const bootstrapSession = useCallback(async () => {
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
      scheduleProactiveRefresh(storedToken);
      if (ctx.flags.must_change_password) setShowChangePassword(true);
    } catch {
      clearStoredSessionToken();
      cancelProactiveRefresh();
      setSession(null);
    } finally {
      setAuthLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    void bootstrapSession();
  }, [bootstrapSession]);

  const handleLogin = useCallback(async () => {
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
  }, [bootstrapSession, loginEmail, loginPassword, setError]);

  const handleChangePassword = useCallback(async () => {
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
  }, [bootstrapSession, changePasswordForm, guarded, setError]);

  const handleLogout = useCallback(() => {
    clearStoredSessionToken();
    cancelProactiveRefresh();
    setSession(null);
    setShowChangePassword(false);
  }, []);

  const handleCompleteOnboarding = useCallback(async () => {
    if (!session) return;
    await guarded(async () => {
      setError(null);
      await completeTenantOnboarding({ tenantName: onboardingForm.tenantName, adminEmail: onboardingForm.adminEmail });
      setSession(await fetchSessionContext());
    }, "Failed to complete onboarding.");
  }, [guarded, onboardingForm, session, setError]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (!gmailStatus) return;

    if (window.opener) {
      window.close();
      return;
    }

    if (gmailStatus === "error") {
      const reason = params.get("reason");
      setError(reason ? `Gmail reconnect failed: ${reason}` : "Gmail reconnect failed.");
    }
    if (gmailStatus === "connected") setError(null);
    cleanUrlParams("gmail", "reason");
  }, [setError]);

  return {
    authLoading,
    session,
    setSession,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginSubmitting,
    showChangePassword,
    setShowChangePassword,
    changePasswordForm,
    setChangePasswordForm,
    onboardingForm,
    setOnboardingForm,
    bootstrapSession,
    handleLogin,
    handleChangePassword,
    handleLogout,
    handleCompleteOnboarding
  };
}
