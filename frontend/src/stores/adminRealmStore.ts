import { create } from "zustand";
import { devtools, persist, type StateStorage } from "zustand/middleware";
import { useActiveRealmStore } from "@/stores/activeRealmStore";
import { devtoolsConfig } from "@/stores/devtoolsConfig";
import { registerStoreReset } from "@/test-utils/resetStores";

export const ADMIN_CLIENT_ORG_QUERY_PARAM = "clientOrgId";
export const ADMIN_CLIENT_ORG_STORAGE_KEY = "adminClientOrgId";

const OBJECT_ID_REGEX = /^[a-f0-9]{24}$/i;

interface AdminRealmState {
  id: string | null;
  setAdminRealm: (id: string | null) => void;
}

function readFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get(ADMIN_CLIENT_ORG_QUERY_PARAM);
  if (!value || value.length === 0) return null;
  return OBJECT_ID_REGEX.test(value) ? value : null;
}

function writeToUrl(id: string | null): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (id === null) {
    params.delete(ADMIN_CLIENT_ORG_QUERY_PARAM);
  } else {
    params.set(ADMIN_CLIENT_ORG_QUERY_PARAM, id);
  }
  const search = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
  );
}

const rawSessionStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === "undefined") return null;
    const value = window.sessionStorage.getItem(name);
    return value === null ? null : JSON.stringify({ state: { id: value }, version: 0 });
  },
  setItem: (name, value) => {
    if (typeof window === "undefined") return;
    try {
      const parsed = JSON.parse(value) as { state?: { id?: string | null } };
      const id = parsed.state?.id ?? null;
      if (id === null) {
        window.sessionStorage.removeItem(name);
      } else {
        window.sessionStorage.setItem(name, id);
      }
    } catch {
      window.sessionStorage.removeItem(name);
    }
  },
  removeItem: (name) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(name);
  }
};

export const useAdminRealmStore = create<AdminRealmState>()(
  devtools(
    persist(
      (set) => ({
        id: null,
        setAdminRealm: (id) => {
          writeToUrl(id);
          set({ id });
          if (useActiveRealmStore.getState().id !== id) {
            useActiveRealmStore.setState({ id });
          }
        }
      }),
      {
        name: ADMIN_CLIENT_ORG_STORAGE_KEY,
        storage: {
          getItem: (name) => {
            const raw = rawSessionStorage.getItem(name) as string | null;
            return raw === null ? null : JSON.parse(raw);
          },
          setItem: (name, value) => {
            rawSessionStorage.setItem(name, JSON.stringify(value));
          },
          removeItem: (name) => {
            rawSessionStorage.removeItem(name);
          }
        },
        partialize: (state) => ({ id: state.id }) as AdminRealmState,
        onRehydrateStorage: () => (state) => {
          if (!state) return;
          const fromUrl = readFromUrl();
          if (fromUrl !== null && fromUrl !== state.id) {
            state.id = fromUrl;
          }
        }
      }
    ),
    devtoolsConfig(ADMIN_CLIENT_ORG_STORAGE_KEY)
  )
);

export function readAdminRealmFromUrl(): string | null {
  return readFromUrl();
}

export function syncAdminRealmFromUrl(): void {
  const fromUrl = readFromUrl();
  if (fromUrl !== useAdminRealmStore.getState().id) {
    useAdminRealmStore.setState({ id: fromUrl });
  }
}

registerStoreReset(() => useAdminRealmStore.setState({ id: null }));

if (typeof window !== "undefined") {
  syncAdminRealmFromUrl();
  window.addEventListener("popstate", syncAdminRealmFromUrl);
  window.addEventListener("hashchange", syncAdminRealmFromUrl);
}
