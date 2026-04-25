/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("@/api/client", () => {
  const get = jest.fn();
  const patch = jest.fn();
  return {
    apiClient: { get, patch }
  };
});

import { useTriageQueue } from "@/hooks/useTriageQueue";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";

const { apiClient } = jest.requireMock("@/api/client") as {
  apiClient: { get: jest.Mock; patch: jest.Mock };
};

function reset() {
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe("hooks/useTriageQueue — tenant-scoped, NOT realm-scoped (composite-key exception #156)", () => {
  beforeEach(() => {
    reset();
    apiClient.get.mockReset();
    apiClient.patch.mockReset();
  });
  afterEach(reset);

  it("exposes total + invoices from the response", async () => {
    apiClient.get.mockResolvedValueOnce({
      data: { items: [{ _id: "i1" }], total: 5 }
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTriageQueue(), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(5));
    expect(result.current.invoices).toHaveLength(1);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith(
      "/invoices/triage",
      expect.objectContaining({ params: { status: "PENDING_TRIAGE" } })
    );
  });

  it("does NOT refetch when the active realm switches (tenant-scoped invariant)", async () => {
    apiClient.get.mockResolvedValue({ data: { items: [], total: 5 } });
    setActiveClientOrgId("realm-A");
    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useTriageQueue(), { wrapper });
    await waitFor(() => expect(result.current.total).toBe(5));
    expect(apiClient.get).toHaveBeenCalledTimes(1);

    act(() => {
      setActiveClientOrgId("realm-B");
    });
    // Force the hook to re-evaluate after the realm change so we can assert
    // that NO new fetch was triggered — proves the tenant-scoped invariant
    // (the query key does not include clientOrgId, so realm switches are
    // cache-hits not refetches).
    rerender();

    expect(result.current.total).toBe(5);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });
});
