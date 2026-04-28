import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { useActiveRealmStore } from "@/stores/activeRealmStore";
import { useAdminRealmStore } from "@/stores/adminRealmStore";
import { devtoolsConfig } from "@/stores/devtoolsConfig";
import { registerStoreReset } from "@/test-utils/resetStores";

export const ACTIVE_TENANT_ID_STORAGE_KEY = "activeTenantId";
export const TENANT_SETUP_COMPLETED_STORAGE_KEY = "tenantSetupCompleted";

interface AuthState {
  activeTenantId: string | null;
  tenantSetupCompleted: boolean;
  setActiveTenantId: (id: string | null) => void;
  setTenantSetupCompleted: (completed: boolean) => void;
  clearAuth: () => void;
}

function readTenantIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(ACTIVE_TENANT_ID_STORAGE_KEY);
  return value && value.length > 0 ? value : null;
}

function readSetupCompletedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(TENANT_SETUP_COMPLETED_STORAGE_KEY) === "true";
}

function writeTenantIdToStorage(id: string | null): void {
  if (typeof window === "undefined") return;
  if (!id) {
    window.sessionStorage.removeItem(ACTIVE_TENANT_ID_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(ACTIVE_TENANT_ID_STORAGE_KEY, id);
}

function writeSetupCompletedToStorage(completed: boolean): void {
  if (typeof window === "undefined") return;
  if (completed) {
    window.sessionStorage.setItem(TENANT_SETUP_COMPLETED_STORAGE_KEY, "true");
  } else {
    window.sessionStorage.removeItem(TENANT_SETUP_COMPLETED_STORAGE_KEY);
  }
}

export const useAuthStore = create<AuthState>()(
  devtools(
    (set) => ({
      activeTenantId: readTenantIdFromStorage(),
      tenantSetupCompleted: readSetupCompletedFromStorage(),
      setActiveTenantId: (id) => {
        writeTenantIdToStorage(id);
        set({ activeTenantId: id });
      },
      setTenantSetupCompleted: (completed) => {
        writeSetupCompletedToStorage(completed);
        set({ tenantSetupCompleted: completed });
      },
      clearAuth: () => {
        writeTenantIdToStorage(null);
        writeSetupCompletedToStorage(false);
        set({ activeTenantId: null, tenantSetupCompleted: false });
        useActiveRealmStore.setState({ id: null });
        useAdminRealmStore.setState({ id: null });
      }
    }),
    devtoolsConfig(ACTIVE_TENANT_ID_STORAGE_KEY)
  )
);

registerStoreReset(() =>
  useAuthStore.setState({ activeTenantId: null, tenantSetupCompleted: false })
);
