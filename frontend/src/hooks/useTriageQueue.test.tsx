/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("@/api/client", () => {
  const { buildApiClientMockModule } = require("@/test-utils/mockApiClient");
  return buildApiClientMockModule();
});

import { useTriageQueue } from "@/hooks/useTriageQueue";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { writeTenantSetupCompleted } from "@/hooks/useTenantSetupCompleted";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { getMockedApiClient } from "@/test-utils/mockApiClient";

const apiClient = getMockedApiClient();

const TEST_TENANT_ID = "tenant-1";

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
    // triageUrls.triageList() requires an active tenantId at construction
    // time (tenant-scoped bypass — no clientOrgId in path).
    writeActiveTenantId(TEST_TENANT_ID);
    writeTenantSetupCompleted(true);
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
      `/tenants/${TEST_TENANT_ID}/invoices/triage`,
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

  it("does NOT fetch when tenant setup is incomplete (#193 — gates 403 noise)", () => {
    writeTenantSetupCompleted(false);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTriageQueue(), { wrapper });
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(result.current.total).toBe(0);
    expect(result.current.invoices).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("starts fetching once tenant setup completes mid-session", async () => {
    writeTenantSetupCompleted(false);
    apiClient.get.mockResolvedValue({ data: { items: [{ _id: "i1" }], total: 1 } });
    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useTriageQueue(), { wrapper });
    expect(apiClient.get).not.toHaveBeenCalled();

    act(() => {
      writeTenantSetupCompleted(true);
    });
    rerender();

    await waitFor(() => expect(result.current.total).toBe(1));
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });
});
