/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ActionRequiredTrigger } from "@/features/invoices/ActionRequiredTrigger";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { writeTenantSetupCompleted } from "@/hooks/useTenantSetupCompleted";
import type { Invoice } from "@/types";

jest.mock("@/api", () => ({
  fetchInvoices: jest.fn()
}));

const { fetchInvoices } = jest.requireMock("@/api") as {
  fetchInvoices: jest.Mock;
};

function makeInvoice(id: string, overrides: Partial<Invoice> = {}): Invoice {
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
    status: "AWAITING_APPROVAL",
    processingIssues: [],
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    parsed: { invoiceNumber: id, vendorName: `V-${id}`, currency: "INR", customerGstin: "29ABCDE1234F1Z5" },
    ...overrides
  } as Invoice;
}

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({
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

describe("features/invoices/ActionRequiredTrigger", () => {
  it("opens the panel on click and closes on Escape", async () => {
    fetchInvoices.mockResolvedValue({
      items: [makeInvoice("a")],
      page: 1,
      limit: 100,
      total: 1
    });
    renderWithClient(<ActionRequiredTrigger onSelectInvoice={() => {}} />);

    const trigger = await screen.findByTestId("action-required-trigger");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBeTruthy();

    act(() => {
      fireEvent.click(trigger);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("action-required-trigger").getAttribute("aria-expanded")).toBe("true");

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the total action count in the trigger badge", async () => {
    fetchInvoices.mockResolvedValue({
      items: [
        makeInvoice("a", { status: "AWAITING_APPROVAL" }),
        makeInvoice("b", { status: "FAILED_OCR" })
      ],
      page: 1,
      limit: 100,
      total: 2
    });
    renderWithClient(<ActionRequiredTrigger onSelectInvoice={() => {}} />);

    const trigger = await screen.findByTestId("action-required-trigger");
    await screen.findByText("2", { selector: "span" });
    expect(trigger).toHaveTextContent("2");
  });

  it("renders the unknown-sentinel '—' when no realm is active (totalCount=null)", async () => {
    setActiveClientOrgId(null);
    renderWithClient(<ActionRequiredTrigger onSelectInvoice={() => {}} />);
    const trigger = await screen.findByTestId("action-required-trigger");
    expect(trigger).toHaveTextContent("—");
    expect(fetchInvoices).not.toHaveBeenCalled();
  });

  it("forwards deep-link selection and closes the panel", async () => {
    fetchInvoices.mockResolvedValue({
      items: [
        makeInvoice("deep-1", { status: "AWAITING_APPROVAL" }),
        makeInvoice("deep-2", { status: "FAILED_OCR" })
      ],
      page: 1,
      limit: 100,
      total: 2
    });
    const onSelectInvoice = jest.fn();
    renderWithClient(<ActionRequiredTrigger onSelectInvoice={onSelectInvoice} />);

    const trigger = await screen.findByTestId("action-required-trigger");
    act(() => {
      fireEvent.click(trigger);
    });
    const items = await screen.findAllByTestId("action-panel-item");
    expect(items.length).toBeGreaterThanOrEqual(2);

    act(() => {
      fireEvent.click(items[0]);
    });
    expect(onSelectInvoice).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
