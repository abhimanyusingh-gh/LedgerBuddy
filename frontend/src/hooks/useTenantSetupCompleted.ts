import { useEffect, useState } from "react";

// Module-level mirror of `session.flags.requires_tenant_setup` (negated to a
// "setup completed" boolean). Mirrors the `useActiveClientOrg` event-bus
// pattern so module-scope hooks (queue badges, etc.) can gate fetches on
// tenant-setup state without context plumbing.
//
// Background: BE routes guarded by `requireTenantSetupCompleted` (e.g.
// `/api/invoices/triage`, `/api/invoices/action-required`) return 403 for
// mid-setup tenants. Without gating, the FE fires those calls on every render
// of `TenantAppShell`, producing log noise. Tracked in #193.

const TENANT_SETUP_COMPLETED_CHANGE_EVENT =
  "ledgerbuddy:tenant-setup-completed-change";
export const TENANT_SETUP_COMPLETED_STORAGE_KEY = "tenantSetupCompleted";

function readFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(TENANT_SETUP_COMPLETED_STORAGE_KEY) === "true";
}

export function writeTenantSetupCompleted(completed: boolean): void {
  if (typeof window === "undefined") return;
  if (completed) {
    window.sessionStorage.setItem(TENANT_SETUP_COMPLETED_STORAGE_KEY, "true");
  } else {
    window.sessionStorage.removeItem(TENANT_SETUP_COMPLETED_STORAGE_KEY);
  }
  window.dispatchEvent(new CustomEvent(TENANT_SETUP_COMPLETED_CHANGE_EVENT));
}

export function useTenantSetupCompleted(): boolean {
  const [completed, setCompleted] = useState<boolean>(() => readFromStorage());

  useEffect(() => {
    const sync = () => setCompleted(readFromStorage());
    window.addEventListener(TENANT_SETUP_COMPLETED_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener(TENANT_SETUP_COMPLETED_CHANGE_EVENT, sync);
    };
  }, []);

  return completed;
}
