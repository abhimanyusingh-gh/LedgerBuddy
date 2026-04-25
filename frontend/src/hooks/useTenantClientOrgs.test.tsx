/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ClientOrganization } from "@/api/clientOrgs";

jest.mock("@/api/clientOrgs", () => ({
  fetchClientOrganizations: jest.fn()
}));

const { fetchClientOrganizations } = jest.requireMock("@/api/clientOrgs") as {
  fetchClientOrganizations: jest.Mock;
};

import {
  TENANT_CLIENT_ORGS_QUERY_KEY,
  useClientOrgsAdminList,
  useTenantClientOrgs
} from "@/hooks/useTenantClientOrgs";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, Wrapper };
}

function buildOrg(overrides: Partial<ClientOrganization> & { _id: string; companyName: string }): ClientOrganization {
  return {
    tenantId: "tenant-1",
    gstin: "29ABCPK1234F1Z5",
    f12OverwriteByGuidVerified: false,
    detectedVersion: null,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useTenantClientOrgs", () => {
  it("uses the canonical query key", () => {
    expect(TENANT_CLIENT_ORGS_QUERY_KEY).toEqual(["tenantClientOrgs"]);
  });

  it("projects the full ClientOrganization records to ClientOrgOption[] (id, companyName)", async () => {
    fetchClientOrganizations.mockResolvedValueOnce([
      buildOrg({ _id: "org-1", companyName: "Sharma Textiles" })
    ]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTenantClientOrgs(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchClientOrganizations).toHaveBeenCalledTimes(1);
    expect(result.current.clientOrgs).toEqual([{ id: "org-1", companyName: "Sharma Textiles" }]);
    expect(result.current.isError).toBe(false);
  });

  it("returns an empty list when the BE returns no organizations", async () => {
    fetchClientOrganizations.mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTenantClientOrgs(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.clientOrgs).toEqual([]);
  });

  it("flags isError when the request rejects", async () => {
    fetchClientOrganizations.mockRejectedValueOnce(new Error("network down"));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTenantClientOrgs(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.clientOrgs).toBeUndefined();
  });

  it("does not fire the request when disabled", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTenantClientOrgs({ enabled: false }), { wrapper: Wrapper });

    expect(fetchClientOrganizations).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});

describe("useClientOrgsAdminList", () => {
  it("returns the full ClientOrganization records (with _id and gstin) under the canonical key", async () => {
    const records = [
      buildOrg({ _id: "org-1", companyName: "Sharma Textiles", gstin: "29ABCPK1234F1Z5" }),
      buildOrg({ _id: "org-2", companyName: "Bose Steel", gstin: "07AABCC1234D1ZA" })
    ];
    fetchClientOrganizations.mockResolvedValueOnce(records);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useClientOrgsAdminList(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.data).toEqual(records);
  });

  it("shares its cache with useTenantClientOrgs (single fetch serves both consumers)", async () => {
    fetchClientOrganizations.mockResolvedValueOnce([
      buildOrg({ _id: "org-1", companyName: "Sharma Textiles" })
    ]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({
        admin: useClientOrgsAdminList(),
        thin: useTenantClientOrgs()
      }),
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(result.current.thin.isLoading).toBe(false));
    expect(fetchClientOrganizations).toHaveBeenCalledTimes(1);
    expect(result.current.admin.data).toEqual([
      buildOrg({ _id: "org-1", companyName: "Sharma Textiles" })
    ]);
    expect(result.current.thin.clientOrgs).toEqual([
      { id: "org-1", companyName: "Sharma Textiles" }
    ]);
  });
});
