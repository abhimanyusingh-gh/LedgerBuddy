/**
 * @jest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("@/api/client", () => ({
  apiClient: { get: jest.fn() }
}));

const { apiClient } = jest.requireMock("@/api/client") as {
  apiClient: { get: jest.Mock };
};

import { useTenantClientOrgs, TENANT_CLIENT_ORGS_QUERY_KEY } from "@/hooks/useTenantClientOrgs";

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, Wrapper };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useTenantClientOrgs", () => {
  it("uses the canonical query key", () => {
    expect(TENANT_CLIENT_ORGS_QUERY_KEY).toEqual(["tenantClientOrgs"]);
  });

  it("fetches /admin/client-orgs and maps the response to ClientOrgOption[]", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { items: [{ id: "org-1", companyName: "Sharma Textiles" }] }
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTenantClientOrgs(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(apiClient.get).toHaveBeenCalledWith("/admin/client-orgs");
    expect(result.current.clientOrgs).toEqual([{ id: "org-1", companyName: "Sharma Textiles" }]);
    expect(result.current.isError).toBe(false);
  });

  it("returns an empty list when the response payload omits items", async () => {
    apiClient.get.mockResolvedValueOnce({ data: {} });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTenantClientOrgs(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.clientOrgs).toEqual([]);
  });

  it("flags isError when the request rejects", async () => {
    apiClient.get.mockRejectedValueOnce(new Error("network down"));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTenantClientOrgs(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.clientOrgs).toBeUndefined();
  });

  it("does not fire the request when disabled", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTenantClientOrgs({ enabled: false }), { wrapper: Wrapper });

    expect(apiClient.get).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});
