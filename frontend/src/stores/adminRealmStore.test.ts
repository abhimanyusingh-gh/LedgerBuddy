/**
 * @jest-environment jsdom
 */
import {
  useAdminRealmStore,
  ADMIN_CLIENT_ORG_QUERY_PARAM,
  ADMIN_CLIENT_ORG_STORAGE_KEY
} from "@/stores/adminRealmStore";
import { useActiveRealmStore } from "@/stores/activeRealmStore";
import { resetStores } from "@/test-utils/resetStores";

const ORG = "65a1b2c3d4e5f6a7b8c9d0e1";
const ORG_OTHER = "65a1b2c3d4e5f6a7b8c9d0e2";
const LEGACY_ADMIN_EVENT = "ledgerbuddy:admin-client-org-filter-change";
const LEGACY_ACTIVE_EVENT = "ledgerbuddy:active-client-org-change";
const LEGACY_URL_SYNC_EVENT = "ledgerbuddy:client-org-url-sync";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  resetStores();
});

describe("adminRealmStore", () => {
  it("setAdminRealm writes URL + persists to sessionStorage as raw string (no JSON envelope)", () => {
    useAdminRealmStore.getState().setAdminRealm(ORG);
    expect(new URLSearchParams(window.location.search).get(ADMIN_CLIENT_ORG_QUERY_PARAM)).toBe(ORG);
    expect(window.sessionStorage.getItem(ADMIN_CLIENT_ORG_STORAGE_KEY)).toBe(ORG);
  });

  it("setAdminRealm(null) clears URL + storage", () => {
    useAdminRealmStore.getState().setAdminRealm(ORG);
    useAdminRealmStore.getState().setAdminRealm(null);
    expect(new URLSearchParams(window.location.search).get(ADMIN_CLIENT_ORG_QUERY_PARAM)).toBeNull();
    expect(window.sessionStorage.getItem(ADMIN_CLIENT_ORG_STORAGE_KEY)).toBeNull();
  });

  it("does NOT dispatch any legacy or interim cross-store events (lock contract)", () => {
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");
    useAdminRealmStore.getState().setAdminRealm(ORG);
    const types = dispatchSpy.mock.calls.map((call) => (call[0] as Event).type);
    expect(types).not.toContain(LEGACY_ADMIN_EVENT);
    expect(types).not.toContain(LEGACY_ACTIVE_EVENT);
    expect(types).not.toContain(LEGACY_URL_SYNC_EVENT);
    dispatchSpy.mockRestore();
  });

  it("propagates id to the active realm store via direct cross-store setState", () => {
    useAdminRealmStore.getState().setAdminRealm(ORG);
    expect(useActiveRealmStore.getState().id).toBe(ORG);
  });

  it("clearing admin realm propagates null to active realm store", () => {
    useAdminRealmStore.getState().setAdminRealm(ORG);
    useAdminRealmStore.getState().setAdminRealm(null);
    expect(useActiveRealmStore.getState().id).toBeNull();
  });

  it("setting the same value twice does not redundantly update the active realm store (prev !== next guard)", () => {
    useAdminRealmStore.getState().setAdminRealm(ORG);
    const setStateSpy = jest.spyOn(useActiveRealmStore, "setState");
    useAdminRealmStore.getState().setAdminRealm(ORG);
    expect(setStateSpy).not.toHaveBeenCalled();
    setStateSpy.mockRestore();
  });

  it("cross-store mirroring does not loop infinitely between the two stores", () => {
    useAdminRealmStore.getState().setAdminRealm(ORG);
    expect(useAdminRealmStore.getState().id).toBe(ORG);
    expect(useActiveRealmStore.getState().id).toBe(ORG);
    useActiveRealmStore.getState().setActiveRealm(ORG_OTHER);
    expect(useAdminRealmStore.getState().id).toBe(ORG_OTHER);
    expect(useActiveRealmStore.getState().id).toBe(ORG_OTHER);
  });

  it("rehydrates from URL on popstate", () => {
    expect(useAdminRealmStore.getState().id).toBeNull();
    window.history.replaceState({}, "", `/?${ADMIN_CLIENT_ORG_QUERY_PARAM}=${ORG}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(useAdminRealmStore.getState().id).toBe(ORG);
  });

  it("rejects non-ObjectId URL values", () => {
    window.history.replaceState({}, "", `/?${ADMIN_CLIENT_ORG_QUERY_PARAM}=garbage`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(useAdminRealmStore.getState().id).toBeNull();
  });

  it("resetStores() restores the initial state", () => {
    useAdminRealmStore.getState().setAdminRealm(ORG);
    expect(useAdminRealmStore.getState().id).toBe(ORG);
    resetStores();
    expect(useAdminRealmStore.getState().id).toBeNull();
  });
});
