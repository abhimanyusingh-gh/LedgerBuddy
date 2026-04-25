/**
 * @jest-environment jsdom
 */
import {
  setActiveClientOrgId,
  ACTIVE_CLIENT_ORG_CHANGE_EVENT,
  ACTIVE_CLIENT_ORG_QUERY_PARAM,
  ACTIVE_CLIENT_ORG_STORAGE_KEY
} from "@/hooks/useActiveClientOrg";
import { ADMIN_CLIENT_ORG_CHANGE_EVENT } from "@/hooks/useAdminClientOrgFilter";

const ORG = "65a1b2c3d4e5f6a7b8c9d0e1";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
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

  it("dispatches BOTH the active-client-org event and the admin filter event so both layers stay in sync (#162; interim until #173)", () => {
    const dispatchSpy = jest.spyOn(window, "dispatchEvent");
    setActiveClientOrgId(ORG);
    const types = dispatchSpy.mock.calls.map((call) => (call[0] as Event).type);
    expect(types).toEqual(expect.arrayContaining([
      ACTIVE_CLIENT_ORG_CHANGE_EVENT,
      ADMIN_CLIENT_ORG_CHANGE_EVENT
    ]));
    dispatchSpy.mockRestore();
  });

  it("clears URL + storage when called with null", () => {
    setActiveClientOrgId(ORG);
    setActiveClientOrgId(null);
    expect(new URLSearchParams(window.location.search).get(ACTIVE_CLIENT_ORG_QUERY_PARAM)).toBeNull();
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBeNull();
  });
});
