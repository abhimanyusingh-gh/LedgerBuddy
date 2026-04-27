/**
 * @jest-environment jsdom
 */
import {
  setActiveClientOrgId,
  ACTIVE_CLIENT_ORG_QUERY_PARAM,
  ACTIVE_CLIENT_ORG_STORAGE_KEY
} from "@/hooks/useActiveClientOrg";
import { useActiveRealmStore } from "@/stores/activeRealmStore";
import { useAdminRealmStore } from "@/stores/adminRealmStore";
import { resetStores } from "@/test-utils/resetStores";

const ORG = "65a1b2c3d4e5f6a7b8c9d0e1";
const LEGACY_ACTIVE_EVENT = "ledgerbuddy:active-client-org-change";
const LEGACY_ADMIN_EVENT = "ledgerbuddy:admin-client-org-filter-change";
const LEGACY_URL_SYNC_EVENT = "ledgerbuddy:client-org-url-sync";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  resetStores();
});

describe("setActiveClientOrgId", () => {
  it("writes the id to the URL query param", () => {
    setActiveClientOrgId(ORG);
    expect(new URLSearchParams(window.location.search).get(ACTIVE_CLIENT_ORG_QUERY_PARAM)).toBe(ORG);
  });

  it("persists the id in sessionStorage", () => {
    setActiveClientOrgId(ORG);
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBe(ORG);
  });

  it("does NOT dispatch any legacy or interim cross-store events (lock contract)", () => {
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");
    setActiveClientOrgId(ORG);
    const types = dispatchSpy.mock.calls.map((call) => (call[0] as Event).type);
    expect(types).not.toContain(LEGACY_ACTIVE_EVENT);
    expect(types).not.toContain(LEGACY_ADMIN_EVENT);
    expect(types).not.toContain(LEGACY_URL_SYNC_EVENT);
    dispatchSpy.mockRestore();
  });

  it("propagates state to the admin realm store via direct cross-store setState", () => {
    setActiveClientOrgId(ORG);
    expect(useAdminRealmStore.getState().id).toBe(ORG);
  });

  it("setting the same value twice does not redundantly update the admin realm store (prev !== next guard)", () => {
    setActiveClientOrgId(ORG);
    const setStateSpy = jest.spyOn(useAdminRealmStore, "setState");
    setActiveClientOrgId(ORG);
    expect(setStateSpy).not.toHaveBeenCalled();
    setStateSpy.mockRestore();
  });

  it("clears URL + storage when called with null", () => {
    setActiveClientOrgId(ORG);
    setActiveClientOrgId(null);
    expect(new URLSearchParams(window.location.search).get(ACTIVE_CLIENT_ORG_QUERY_PARAM)).toBeNull();
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBeNull();
  });

  it("clearing active realm propagates null to admin realm store", () => {
    setActiveClientOrgId(ORG);
    setActiveClientOrgId(null);
    expect(useAdminRealmStore.getState().id).toBeNull();
  });
});

describe("useActiveRealmStore (cross-store)", () => {
  it("setActiveRealm with prev === next is a no-op (guard halts recursion)", () => {
    useActiveRealmStore.getState().setActiveRealm(ORG);
    const setStateSpy = jest.spyOn(useAdminRealmStore, "setState");
    useActiveRealmStore.getState().setActiveRealm(ORG);
    expect(setStateSpy).not.toHaveBeenCalled();
    setStateSpy.mockRestore();
  });
});
