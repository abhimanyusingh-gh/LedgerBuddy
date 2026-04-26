/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TriagePage } from "@/features/triage/TriagePage";
import type { TriageInvoice } from "@/api/triage";
import type { ClientOrganization } from "@/api/clientOrgs";
import { writeTenantSetupCompleted } from "@/hooks/useTenantSetupCompleted";

jest.mock("@/api/triage", () => ({
  TRIAGE_QUEUE_QUERY_KEY: ["triageQueue"],
  fetchTriageInvoices: jest.fn(),
  assignClientOrg: jest.fn(),
  rejectInvoice: jest.fn()
}));

jest.mock("@/api/clientOrgs", () => ({
  fetchClientOrganizations: jest.fn()
}));

const triage = jest.requireMock("@/api/triage") as {
  fetchTriageInvoices: jest.Mock;
  assignClientOrg: jest.Mock;
  rejectInvoice: jest.Mock;
};
const orgs = jest.requireMock("@/api/clientOrgs") as {
  fetchClientOrganizations: jest.Mock;
};

function buildInvoice(overrides: Partial<TriageInvoice> & { _id: string }): TriageInvoice {
  return {
    tenantId: "tenant-1",
    invoiceNumber: `INV-${overrides._id}`,
    vendorName: "Acme",
    vendorGstin: "29ABCDE1234F1Z5",
    customerName: "Customer Co",
    customerGstin: "29ZZYY1234F1Z5",
    totalAmountMinor: 100000,
    currency: "INR",
    sourceMailbox: "ap@firm.in",
    receivedAt: "2026-04-25T08:00:00Z",
    status: "PENDING_TRIAGE",
    ...overrides
  };
}

function buildOrg(overrides: Partial<ClientOrganization> & { _id: string; companyName: string; gstin: string }): ClientOrganization {
  return {
    tenantId: "tenant-1",
    f12OverwriteByGuidVerified: false,
    detectedVersion: null,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, ...render(<TriagePage />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
  writeTenantSetupCompleted(true);
});

describe("features/triage/TriagePage — 4-state UX", () => {
  it("renders the loading state while the queue query is pending", () => {
    triage.fetchTriageInvoices.mockImplementation(() => new Promise(() => {}));
    orgs.fetchClientOrganizations.mockResolvedValue([]);
    renderPage();
    expect(screen.getByTestId("triage-loading")).toBeInTheDocument();
  });

  it("renders the error state with a retry button", async () => {
    triage.fetchTriageInvoices.mockRejectedValue(new Error("offline"));
    orgs.fetchClientOrganizations.mockResolvedValue([]);
    renderPage();
    await screen.findByTestId("triage-error");
    expect(screen.getByTestId("triage-error-retry")).toBeInTheDocument();
  });

  it("renders the empty state with the all-caught-up copy", async () => {
    triage.fetchTriageInvoices.mockResolvedValue({ items: [], total: 0 });
    orgs.fetchClientOrganizations.mockResolvedValue([]);
    renderPage();
    const empty = await screen.findByTestId("triage-empty");
    expect(empty).toHaveTextContent(/all caught up|no invoices waiting/i);
  });

  it("renders the data table when the queue has invoices", async () => {
    triage.fetchTriageInvoices.mockResolvedValue({
      items: [buildInvoice({ _id: "inv-1" }), buildInvoice({ _id: "inv-2" })],
      total: 2
    });
    orgs.fetchClientOrganizations.mockResolvedValue([]);
    renderPage();
    await screen.findByTestId("triage-table");
    expect(screen.getByTestId("triage-row-inv-1")).toBeInTheDocument();
    expect(screen.getByTestId("triage-row-inv-2")).toBeInTheDocument();
  });
});

describe("features/triage/TriagePage — assign flow", () => {
  it("opens the picker, assigns to selected client, optimistically removes the row, and does NOT change the active realm", async () => {
    triage.fetchTriageInvoices
      .mockResolvedValueOnce({
        items: [buildInvoice({ _id: "inv-1", customerGstin: "29ABCDE1111F1Z5" })],
        total: 1
      })
      .mockResolvedValue({ items: [], total: 0 });
    orgs.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-9", gstin: "29ABCDE1111F1Z5", companyName: "Sharma Textiles" })
    ]);
    triage.assignClientOrg.mockResolvedValue({ ok: true });

    renderPage();
    await screen.findByTestId("triage-row-inv-1");

    fireEvent.click(screen.getByTestId("triage-row-assign-inv-1"));
    await screen.findByTestId("triage-picker-list");
    fireEvent.click(screen.getByTestId("triage-picker-option-org-9"));

    await waitFor(() => {
      expect(triage.assignClientOrg).toHaveBeenCalledWith("inv-1", "org-9");
    });
    await waitFor(() => {
      expect(screen.queryByTestId("triage-row-inv-1")).not.toBeInTheDocument();
    });
    // Critical: assigning never jumps the operator's active realm.
    expect(window.sessionStorage.getItem("activeClientOrgId")).toBeNull();
  });

  it("restores the row on assignment failure", async () => {
    triage.fetchTriageInvoices.mockResolvedValue({
      items: [buildInvoice({ _id: "inv-1" })],
      total: 1
    });
    orgs.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-9", gstin: "29ABCDE1111F1Z5", companyName: "Sharma Textiles" })
    ]);
    triage.assignClientOrg.mockRejectedValue(new Error("invariant"));
    triage.fetchTriageInvoices.mockResolvedValueOnce({
      items: [buildInvoice({ _id: "inv-1" })],
      total: 1
    });

    renderPage();
    await screen.findByTestId("triage-row-inv-1");
    fireEvent.click(screen.getByTestId("triage-row-assign-inv-1"));
    await screen.findByTestId("triage-picker-list");

    await act(async () => {
      fireEvent.click(screen.getByTestId("triage-picker-option-org-9"));
    });

    await waitFor(() => {
      expect(triage.assignClientOrg).toHaveBeenCalled();
    });
    // Optimistic removal then restore: row reappears.
    await screen.findByTestId("triage-row-inv-1");
  });

  it("supports bulk-assign across multiple selected invoices", async () => {
    triage.fetchTriageInvoices.mockResolvedValue({
      items: [buildInvoice({ _id: "inv-1" }), buildInvoice({ _id: "inv-2" })],
      total: 2
    });
    orgs.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-9", gstin: "29ABCDE1111F1Z5", companyName: "Sharma Textiles" })
    ]);
    triage.assignClientOrg.mockResolvedValue({ ok: true });

    renderPage();
    await screen.findByTestId("triage-row-inv-1");
    fireEvent.click(screen.getByTestId("triage-select-all"));
    fireEvent.click(screen.getByTestId("triage-bulk-assign"));
    await screen.findByTestId("triage-picker-list");
    fireEvent.click(screen.getByTestId("triage-picker-option-org-9"));

    await waitFor(() => {
      expect(triage.assignClientOrg).toHaveBeenCalledTimes(2);
    });
    expect(triage.assignClientOrg).toHaveBeenCalledWith("inv-1", "org-9");
    expect(triage.assignClientOrg).toHaveBeenCalledWith("inv-2", "org-9");
  });
});

describe("features/triage/TriagePage — bulk partial-failure UX", () => {
  it("removes only the successful rows, keeps failed rows visible, and surfaces a status banner", async () => {
    const initialItems = [
      buildInvoice({ _id: "inv-1", invoiceNumber: "INV-1" }),
      buildInvoice({ _id: "inv-2", invoiceNumber: "INV-2" }),
      buildInvoice({ _id: "inv-3", invoiceNumber: "INV-3" }),
      buildInvoice({ _id: "inv-4", invoiceNumber: "INV-4" }),
      buildInvoice({ _id: "inv-5", invoiceNumber: "INV-5" })
    ];
    triage.fetchTriageInvoices
      .mockResolvedValueOnce({ items: initialItems, total: 5 })
      .mockResolvedValue({
        items: initialItems.filter((i) => i._id === "inv-3" || i._id === "inv-5"),
        total: 2
      });
    orgs.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-9", gstin: "29ABCDE1111F1Z5", companyName: "Sharma Textiles" })
    ]);
    triage.assignClientOrg.mockImplementation(async (invoiceId: string) => {
      if (invoiceId === "inv-3") throw new Error("invariant");
      if (invoiceId === "inv-5") throw new Error("network");
      return { ok: true };
    });

    renderPage();
    await screen.findByTestId("triage-row-inv-1");
    fireEvent.click(screen.getByTestId("triage-select-all"));
    fireEvent.click(screen.getByTestId("triage-bulk-assign"));
    await screen.findByTestId("triage-picker-list");

    await act(async () => {
      fireEvent.click(screen.getByTestId("triage-picker-option-org-9"));
    });

    await waitFor(() => {
      expect(triage.assignClientOrg).toHaveBeenCalledTimes(5);
    });

    await waitFor(() => {
      expect(screen.queryByTestId("triage-row-inv-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("triage-row-inv-2")).not.toBeInTheDocument();
      expect(screen.queryByTestId("triage-row-inv-4")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("triage-row-inv-3")).toBeInTheDocument();
    expect(screen.getByTestId("triage-row-inv-5")).toBeInTheDocument();

    const banner = screen.getByTestId("triage-bulk-outcome");
    expect(banner).toHaveAttribute("data-action", "assign");
    expect(banner).toHaveTextContent(/3 of 5/i);
    const failedList = screen.getByTestId("triage-bulk-outcome-failed");
    expect(failedList).toHaveTextContent("INV-3");
    expect(failedList).toHaveTextContent("INV-5");
  });

  it("surfaces a partial-failure banner for bulk-reject as well", async () => {
    const items = [
      buildInvoice({ _id: "inv-a", invoiceNumber: "INV-A" }),
      buildInvoice({ _id: "inv-b", invoiceNumber: "INV-B" }),
      buildInvoice({ _id: "inv-c", invoiceNumber: "INV-C" })
    ];
    triage.fetchTriageInvoices
      .mockResolvedValueOnce({ items, total: 3 })
      .mockResolvedValue({ items: items.filter((i) => i._id === "inv-b"), total: 1 });
    orgs.fetchClientOrganizations.mockResolvedValue([]);
    triage.rejectInvoice.mockImplementation(async (invoiceId: string) => {
      if (invoiceId === "inv-b") throw new Error("server-error");
      return { ok: true };
    });

    renderPage();
    await screen.findByTestId("triage-row-inv-a");
    fireEvent.click(screen.getByTestId("triage-select-all"));
    fireEvent.click(screen.getByTestId("triage-bulk-reject"));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByTestId("reject-dialog-reason-spam"));
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("reject-dialog-confirm"));
    });

    await waitFor(() => {
      expect(triage.rejectInvoice).toHaveBeenCalledTimes(3);
    });

    const banner = await screen.findByTestId("triage-bulk-outcome");
    expect(banner).toHaveAttribute("data-action", "reject");
    expect(banner).toHaveTextContent(/2 of 3/i);
    expect(screen.getByTestId("triage-bulk-outcome-failed")).toHaveTextContent("INV-B");
    expect(screen.getByTestId("triage-row-inv-b")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("triage-bulk-outcome-dismiss"));
    expect(screen.queryByTestId("triage-bulk-outcome")).not.toBeInTheDocument();
  });

  it("does NOT surface a banner when every invoice succeeds", async () => {
    triage.fetchTriageInvoices.mockResolvedValue({
      items: [buildInvoice({ _id: "inv-1" }), buildInvoice({ _id: "inv-2" })],
      total: 2
    });
    orgs.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-9", gstin: "29ABCDE1111F1Z5", companyName: "Sharma Textiles" })
    ]);
    triage.assignClientOrg.mockResolvedValue({ ok: true });

    renderPage();
    await screen.findByTestId("triage-row-inv-1");
    fireEvent.click(screen.getByTestId("triage-select-all"));
    fireEvent.click(screen.getByTestId("triage-bulk-assign"));
    await screen.findByTestId("triage-picker-list");
    await act(async () => {
      fireEvent.click(screen.getByTestId("triage-picker-option-org-9"));
    });

    await waitFor(() => {
      expect(triage.assignClientOrg).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId("triage-bulk-outcome")).not.toBeInTheDocument();
  });
});

describe("features/triage/TriagePage — reject flow", () => {
  it("opens the reject dialog, posts the canonical reason, and removes the row optimistically", async () => {
    triage.fetchTriageInvoices
      .mockResolvedValueOnce({
        items: [buildInvoice({ _id: "inv-1" })],
        total: 1
      })
      .mockResolvedValue({ items: [], total: 0 });
    orgs.fetchClientOrganizations.mockResolvedValue([]);
    triage.rejectInvoice.mockResolvedValue({ ok: true });

    renderPage();
    await screen.findByTestId("triage-row-inv-1");
    fireEvent.click(screen.getByTestId("triage-row-reject-inv-1"));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByTestId("reject-dialog-reason-spam"));
    fireEvent.click(within(dialog).getByTestId("reject-dialog-confirm"));

    await waitFor(() => {
      expect(triage.rejectInvoice).toHaveBeenCalledWith("inv-1", { reasonCode: "spam" });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("triage-row-inv-1")).not.toBeInTheDocument();
    });
  });
});
