/**
 * @jest-environment jsdom
 */
import {
  setActiveClientOrgId,
  ACTIVE_CLIENT_ORG_QUERY_PARAM,
  ACTIVE_CLIENT_ORG_STORAGE_KEY,
  ACTIVE_CLIENT_ORG_CHANGE_EVENT
} from "@/hooks/useActiveClientOrg";
import { ADMIN_CLIENT_ORG_CHANGE_EVENT } from "@/hooks/useAdminClientOrgFilter";
import { resetStores } from "@/test-utils/resetStores";

const ORG = "65a1b2c3d4e5f6a7b8c9d0e1";

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

  it("dispatches the admin filter event so the admin layer stays in sync (#162; interim until Sub-PR B replaces useAdminClientOrgFilter)", () => {
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");
    setActiveClientOrgId(ORG);
    const types = dispatchSpy.mock.calls.map((call) => (call[0] as Event).type);
    expect(types).toContain(ADMIN_CLIENT_ORG_CHANGE_EVENT);
    dispatchSpy.mockRestore();
  });

  it("does NOT dispatch ACTIVE_CLIENT_ORG_CHANGE_EVENT (single-dispatch contract — would loop with the store's own listener)", () => {
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");
    setActiveClientOrgId(ORG);
    const types = dispatchSpy.mock.calls.map((call) => (call[0] as Event).type);
    expect(types).not.toContain(ACTIVE_CLIENT_ORG_CHANGE_EVENT);
    dispatchSpy.mockRestore();
  });

  it("clears URL + storage when called with null", () => {
    setActiveClientOrgId(ORG);
    setActiveClientOrgId(null);
    expect(new URLSearchParams(window.location.search).get(ACTIVE_CLIENT_ORG_QUERY_PARAM)).toBeNull();
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBeNull();
  });
});
