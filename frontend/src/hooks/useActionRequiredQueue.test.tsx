/**
 * @jest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

jest.mock("@/api", () => ({
  fetchInvoices: jest.fn()
}));

import { useActionRequiredQueue, ACTION_QUEUE_QUERY_KEY } from "@/hooks/useActionRequiredQueue";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { writeTenantSetupCompleted } from "@/hooks/useTenantSetupCompleted";

const { fetchInvoices } = jest.requireMock("@/api") as {
  fetchInvoices: jest.Mock;
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

function makeInvoice(id: string, status: string) {
  return {
    _id: id,
    tenantId: "t",
    workloadTier: "standard",
    sourceType: "upload",
    sourceKey: id,
    sourceDocumentId: id,
    attachmentName: `${id}.pdf`,
    mimeType: "application/pdf",
    receivedAt: "2026-04-20T00:00:00Z",
    confidenceScore: 80,
    confidenceTone: "green",
    autoSelectForApproval: false,
    status,
    processingIssues: [],
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    parsed: { invoiceNumber: id, vendorName: `V-${id}`, currency: "INR", customerGstin: "29ABCDE1234F1Z5" }
  };
}

describe("hooks/useActionRequiredQueue — realm-scoped (#141)", () => {
  beforeEach(() => {
    reset();
    fetchInvoices.mockReset();
    writeTenantSetupCompleted(true);
  });
  afterEach(reset);

  it("does NOT fetch when no realm is active (totalCount surfaces as null — the unknown sentinel)", () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActionRequiredQueue(), { wrapper });
    expect(fetchInvoices).not.toHaveBeenCalled();
    expect(result.current.totalCount).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("fetches when a realm is active and exposes totalCount derived from buildActionQueue", async () => {
    fetchInvoices.mockResolvedValue({
      items: [makeInvoice("a", "AWAITING_APPROVAL"), makeInvoice("b", "FAILED_OCR")],
      page: 1,
      limit: 500,
      total: 2
    });
    setActiveClientOrgId("realm-A");
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActionRequiredQueue(), { wrapper });
    await waitFor(() => expect(result.current.totalCount).toBe(2));
    expect(fetchInvoices).toHaveBeenCalledTimes(1);
  });

  it("re-fetches when the active realm switches (cache key changes via useScopedQuery)", async () => {
    fetchInvoices.mockResolvedValueOnce({
      items: [makeInvoice("a", "AWAITING_APPROVAL")],
      page: 1,
      limit: 500,
      total: 1
    });
    fetchInvoices.mockResolvedValueOnce({
      items: [makeInvoice("b", "FAILED_OCR"), makeInvoice("c", "FAILED_OCR")],
      page: 1,
      limit: 500,
      total: 2
    });
    setActiveClientOrgId("realm-A");
    const { client, wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useActionRequiredQueue(), { wrapper });
    await waitFor(() => expect(result.current.totalCount).toBe(1));
    expect(fetchInvoices).toHaveBeenCalledTimes(1);

    // Verify the cache is partitioned by clientOrgId — the realm prefix is in the key.
    const realmAEntries = client
      .getQueryCache()
      .findAll({ queryKey: ["clientOrg", "realm-A", ...ACTION_QUEUE_QUERY_KEY] });
    expect(realmAEntries.length).toBe(1);

    act(() => {
      setActiveClientOrgId("realm-B");
    });
    rerender();
    await waitFor(() => expect(result.current.totalCount).toBe(2));
    expect(fetchInvoices).toHaveBeenCalledTimes(2);

    const realmBEntries = client
      .getQueryCache()
      .findAll({ queryKey: ["clientOrg", "realm-B", ...ACTION_QUEUE_QUERY_KEY] });
    expect(realmBEntries.length).toBe(1);
  });

  it("does NOT fetch when tenant setup is incomplete, even with an active realm (#193)", () => {
    writeTenantSetupCompleted(false);
    setActiveClientOrgId("realm-A");
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useActionRequiredQueue(), { wrapper });
    expect(fetchInvoices).not.toHaveBeenCalled();
    expect(result.current.totalCount).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("starts fetching once tenant setup completes mid-session", async () => {
    writeTenantSetupCompleted(false);
    fetchInvoices.mockResolvedValue({
      items: [makeInvoice("a", "AWAITING_APPROVAL")],
      page: 1,
      limit: 500,
      total: 1
    });
    setActiveClientOrgId("realm-A");
    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useActionRequiredQueue(), { wrapper });
    expect(fetchInvoices).not.toHaveBeenCalled();

    act(() => {
      writeTenantSetupCompleted(true);
    });
    rerender();

    await waitFor(() => expect(result.current.totalCount).toBe(1));
    expect(fetchInvoices).toHaveBeenCalledTimes(1);
  });
});
