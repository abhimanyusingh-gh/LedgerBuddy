import { useCallback } from "react";
import { create } from "zustand";
import { createJSONStorage, devtools, persist, type StateStorage } from "zustand/middleware";
import { devtoolsConfig } from "@/stores/devtoolsConfig";
import { registerStoreReset } from "@/test-utils/resetStores";

export const DRAFT_PERSISTENCE_STORAGE_KEY = "lb-form-drafts";

export const DRAFT_TTL_MS = {
  Short: 15 * 60 * 1000,
  Default: 60 * 60 * 1000,
  Long: 24 * 60 * 60 * 1000
} as const;

interface DraftEntry {
  value: unknown;
  updatedAt: number;
}

interface DraftState {
  drafts: Record<string, DraftEntry>;
  setDraft: (key: string, value: unknown) => void;
  getDraft: (key: string) => unknown;
  clearDraft: (key: string) => void;
  pruneStale: (ttlMs: number) => void;
}

const sessionJsonStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(name);
  },
  setItem: (name, value) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(name, value);
  },
  removeItem: (name) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(name);
  }
};

export const useDraftStore = create<DraftState>()(
  devtools(
    persist(
      (set, get) => ({
        drafts: {},
        setDraft: (key, value) =>
          set((state) => ({
            drafts: { ...state.drafts, [key]: { value, updatedAt: Date.now() } }
          })),
        getDraft: (key) => get().drafts[key]?.value,
        clearDraft: (key) =>
          set((state) => {
            if (!(key in state.drafts)) return state;
            const next = { ...state.drafts };
            delete next[key];
            return { drafts: next };
          }),
        pruneStale: (ttlMs) =>
          set((state) => {
            const cutoff = Date.now() - ttlMs;
            const filtered: Record<string, DraftEntry> = {};
            let changed = false;
            for (const [key, entry] of Object.entries(state.drafts)) {
              if (entry.updatedAt >= cutoff) {
                filtered[key] = entry;
              } else {
                changed = true;
              }
            }
            return changed ? { drafts: filtered } : state;
          })
      }),
      {
        name: DRAFT_PERSISTENCE_STORAGE_KEY,
        storage: createJSONStorage(() => sessionJsonStorage),
        partialize: (state) => ({ drafts: state.drafts }) as DraftState
      }
    ),
    devtoolsConfig(DRAFT_PERSISTENCE_STORAGE_KEY)
  )
);

registerStoreReset(() => useDraftStore.setState({ drafts: {} }));

export function useDraft<T>(
  key: string,
  options?: { ttlMs?: number }
): [T | undefined, (value: T) => void, () => void] {
  const ttlMs = options?.ttlMs;
  const value = useDraftStore((state) => {
    const entry = state.drafts[key];
    if (!entry) return undefined;
    if (ttlMs !== undefined && Date.now() - entry.updatedAt >= ttlMs) {
      return undefined;
    }
    return entry.value as T;
  });
  const setDraftAction = useDraftStore((state) => state.setDraft);
  const clearDraftAction = useDraftStore((state) => state.clearDraft);
  const setDraft = useCallback((next: T) => setDraftAction(key, next), [key, setDraftAction]);
  const clearDraft = useCallback(() => clearDraftAction(key), [key, clearDraftAction]);
  return [value, setDraft, clearDraft];
}
