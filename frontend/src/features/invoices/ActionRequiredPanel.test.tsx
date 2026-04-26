/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ActionRequiredPanel, ACTION_PANEL_VIEW } from "@/features/invoices/ActionRequiredPanel";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { writeTenantSetupCompleted } from "@/hooks/useTenantSetupCompleted";
import type { Invoice } from "@/types";

jest.mock("@/api", () => ({
  fetchInvoices: jest.fn()
}));

const { fetchInvoices } = jest.requireMock("@/api") as {
  fetchInvoices: jest.Mock;
};

function makeInvoice(overrides: Partial<Invoice> & { id: string }): Invoice {
  const { id, ...rest } = overrides;
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
    status: "PARSED",
    processingIssues: [],
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    parsed: { invoiceNumber: `N-${id}`, vendorName: `V-${id}`, currency: "INR", customerGstin: "29ABCDE1234F1Z5" },
    ...rest
  } as Invoice;
}

function renderWithClient(ui: ReactNode, client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } }
    });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  // The Action-Required queue is realm-scoped (#141): the hook uses
  // useScopedQuery which is disabled until a realm is active.
  setActiveClientOrgId("realm-test");
  // Also gate-bypass the tenant-setup check (#193).
  writeTenantSetupCompleted(true);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn()
    })
  });
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  setActiveClientOrgId(null);
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
});

describe("features/invoices/ActionRequiredPanel — 4-state contract", () => {
  it("renders the loading skeleton while the query is pending", () => {
    fetchInvoices.mockImplementation(() => new Promise(() => {}));
    renderWithClient(
      <ActionRequiredPanel open onClose={() => {}} onSelectInvoice={() => {}} />
    );
    const body = screen.getByTestId("action-panel-body");
    expect(body.dataset.view).toBe(ACTION_PANEL_VIEW.Loading);
    expect(screen.getByTestId("action-panel-loading")).toBeInTheDocument();
  });

  it("renders the error state with a retry button when the query fails", async () => {
    fetchInvoices.mockRejectedValue(new Error("network"));
    renderWithClient(
      <ActionRequiredPanel open onClose={() => {}} onSelectInvoice={() => {}} />
    );
    const errorRegion = await screen.findByTestId("action-panel-error");
    expect(errorRegion).toHaveTextContent(/couldn.t load action items/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders the empty state when no invoices require action", async () => {
    fetchInvoices.mockResolvedValue({
      items: [makeInvoice({ id: "ok", status: "APPROVED" })],
      page: 1,
      limit: 100,
      total: 1
    });
    renderWithClient(
      <ActionRequiredPanel open onClose={() => {}} onSelectInvoice={() => {}} />
    );
    const empty = await screen.findByTestId("action-panel-empty");
    expect(empty).toHaveTextContent(/all caught up/i);
  });

  it("renders grouped items and deep-links on click", async () => {
    fetchInvoices.mockResolvedValue({
      items: [
        makeInvoice({ id: "ocr-1", status: "FAILED_OCR" }),
        makeInvoice({ id: "awaiting-1", status: "AWAITING_APPROVAL" }),
        makeInvoice({ id: "awaiting-2", status: "AWAITING_APPROVAL" })
      ],
      page: 1,
      limit: 100,
      total: 3
    });
    const onSelectInvoice = jest.fn();
    const onClose = jest.fn();
    renderWithClient(
      <ActionRequiredPanel open onClose={onClose} onSelectInvoice={onSelectInvoice} />
    );

    const groups = await screen.findAllByTestId("action-panel-group");
    expect(groups).toHaveLength(2);
    expect(groups[0].getAttribute("data-reason")).toBe("FailedOcr");
    expect(groups[1].getAttribute("data-reason")).toBe("AwaitingApproval");

    const items = screen.getAllByTestId("action-panel-item");
    expect(items).toHaveLength(3);

    act(() => {
      fireEvent.click(items[0]);
    });
    expect(onSelectInvoice).toHaveBeenCalledWith("ocr-1");
    expect(onClose).toHaveBeenCalled();
  });
});
