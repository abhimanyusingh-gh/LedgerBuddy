import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { ADMIN_CLIENT_ORG_CHANGE_EVENT } from "@/hooks/useAdminClientOrgFilter";
import { registerStoreReset } from "@/test-utils/resetStores";

export const ACTIVE_CLIENT_ORG_QUERY_PARAM = "clientOrgId";
export const ACTIVE_CLIENT_ORG_STORAGE_KEY = "activeClientOrgId";

export const ACTIVE_CLIENT_ORG_CHANGE_EVENT = "ledgerbuddy:active-client-org-change";

interface ActiveRealmState {
  id: string | null;
  setActiveRealm: (id: string | null) => void;
}

function readFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get(ACTIVE_CLIENT_ORG_QUERY_PARAM);
  return value && value.length > 0 ? value : null;
}

function writeToUrl(id: string | null): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (id === null) {
    params.delete(ACTIVE_CLIENT_ORG_QUERY_PARAM);
  } else {
    params.set(ACTIVE_CLIENT_ORG_QUERY_PARAM, id);
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

export const useActiveRealmStore = create<ActiveRealmState>()(
  persist(
    (set) => ({
      id: null,
      setActiveRealm: (id) => {
        writeToUrl(id);
        set({ id });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent(ADMIN_CLIENT_ORG_CHANGE_EVENT));
        }
      }
    }),
    {
      name: ACTIVE_CLIENT_ORG_STORAGE_KEY,
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
      partialize: (state) => ({ id: state.id }) as ActiveRealmState,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const fromUrl = readFromUrl();
        if (fromUrl !== null && fromUrl !== state.id) {
          state.id = fromUrl;
        }
      }
    }
  )
);

export function setActiveRealm(id: string | null): void {
  useActiveRealmStore.getState().setActiveRealm(id);
}

export function readActiveRealmId(): string | null {
  return readFromUrl() ?? useActiveRealmStore.getState().id;
}

registerStoreReset(() => useActiveRealmStore.setState({ id: null }));

if (typeof window !== "undefined") {
  const initialFromUrl = readFromUrl();
  if (initialFromUrl !== null && useActiveRealmStore.getState().id !== initialFromUrl) {
    useActiveRealmStore.setState({ id: initialFromUrl });
  }
  const rehydrateFromUrl = () => {
    const fromUrl = readFromUrl();
    if (fromUrl !== useActiveRealmStore.getState().id) {
      useActiveRealmStore.setState({ id: fromUrl });
    }
  };
  window.addEventListener(ACTIVE_CLIENT_ORG_CHANGE_EVENT, rehydrateFromUrl);
  window.addEventListener("popstate", rehydrateFromUrl);
  window.addEventListener("hashchange", rehydrateFromUrl);
}
