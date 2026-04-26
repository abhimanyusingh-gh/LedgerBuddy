/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ClientOrgsPage, CLIENT_ORGS_PAGE_VIEW } from "@/features/admin/onboarding/ClientOrgsPage";
import type { ClientOrganization } from "@/api/clientOrgs";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";

jest.mock("@/api/client", () => {
  const { buildApiClientMockModule } = require("@/test-utils/mockApiClient");
  return buildApiClientMockModule();
});

jest.mock("@/api/clientOrgs", () => {
  const actual = jest.requireActual("@/api/clientOrgs");
  return {
    ...actual,
    fetchClientOrganizations: jest.fn(),
    createClientOrganization: jest.fn(),
    updateClientOrganization: jest.fn(),
    deleteClientOrganization: jest.fn()
  };
});

const mocked = jest.requireMock("@/api/clientOrgs") as {
  fetchClientOrganizations: jest.Mock;
  createClientOrganization: jest.Mock;
  updateClientOrganization: jest.Mock;
  deleteClientOrganization: jest.Mock;
};

function renderPage(): { unmount: () => void } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ClientOrgsPage />, { wrapper });
}

function buildOrg(overrides: Partial<ClientOrganization> & { _id: string; gstin: string }): ClientOrganization {
  return {
    tenantId: "tenant-1",
    companyName: `Co-${overrides._id}`,
    f12OverwriteByGuidVerified: false,
    detectedVersion: null,
    createdAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
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
});

describe("features/admin/onboarding/ClientOrgsPage — 4-state contract", () => {
  it("renders the loading view while the list query is pending", () => {
    mocked.fetchClientOrganizations.mockImplementation(() => new Promise(() => {}));
    renderPage();
    const page = screen.getByTestId("client-orgs-page");
    expect(page.dataset.view).toBe(CLIENT_ORGS_PAGE_VIEW.Loading);
    expect(screen.getByTestId("client-orgs-loading")).toBeInTheDocument();
  });

  it("renders the error view with a retry button when the query fails", async () => {
    mocked.fetchClientOrganizations.mockRejectedValue(new Error("boom"));
    renderPage();
    const errorRegion = await screen.findByTestId("client-orgs-error");
    expect(errorRegion).toHaveTextContent(/boom|couldn.t load/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders the empty CTA when the tenant has zero client organizations", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([]);
    renderPage();
    const empty = await screen.findByTestId("client-orgs-empty");
    expect(empty).toHaveTextContent(/add your first/i);
    expect(screen.getByTestId("client-orgs-empty-cta")).toBeInTheDocument();
  });

  it("renders the data table when client organizations exist", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-1", gstin: "29ABCPK1234F1Z5", companyName: "Sharma Textiles" }),
      buildOrg({ _id: "org-2", gstin: "07AABCC1234D1ZA", companyName: "Bose Steel" })
    ]);
    renderPage();
    await screen.findByTestId("client-orgs-table");
    const rows = screen.getAllByTestId("client-orgs-table-row");
    expect(rows).toHaveLength(2);
    // Sorted ascending by companyName.
    expect(rows[0]).toHaveTextContent("Bose Steel");
    expect(rows[1]).toHaveTextContent("Sharma Textiles");
  });
});

describe("features/admin/onboarding/ClientOrgsPage — create flow", () => {
  it("auto-selects the freshly created client organization as the active realm", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([]);
    mocked.createClientOrganization.mockResolvedValue(
      buildOrg({ _id: "org-new", gstin: "29ABCPK1234F1Z5", companyName: "Acme Industries" })
    );

    renderPage();
    fireEvent.click(await screen.findByTestId("client-orgs-empty-cta"));

    fireEvent.change(screen.getByTestId("client-org-gstin-input"), {
      target: { value: "29abcpk1234f1z5" }
    });
    fireEvent.change(screen.getByTestId("client-org-company-name-input"), {
      target: { value: "Acme Industries" }
    });

    const submit = screen.getByTestId("client-org-form-submit");
    expect(submit).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(mocked.createClientOrganization).toHaveBeenCalled();
    });
    expect(mocked.createClientOrganization.mock.calls[0][0]).toEqual({
      gstin: "29ABCPK1234F1Z5",
      companyName: "Acme Industries",
      stateName: undefined
    });
    await waitFor(() => {
      expect(window.sessionStorage.getItem("activeClientOrgId")).toBe("org-new");
    });
  });

  it("disables submit until both GSTIN and company name are valid", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([]);
    renderPage();
    fireEvent.click(await screen.findByTestId("client-orgs-empty-cta"));
    const submit = screen.getByTestId("client-org-form-submit");
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId("client-org-gstin-input"), {
      target: { value: "29ABCPK1234F1Z5" }
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId("client-org-company-name-input"), {
      target: { value: "Acme" }
    });
    expect(submit).not.toBeDisabled();
  });

  it("surfaces the API error and keeps the form open when create fails", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([]);
    mocked.createClientOrganization.mockRejectedValue(new Error("Duplicate GSTIN"));
    renderPage();
    fireEvent.click(await screen.findByTestId("client-orgs-empty-cta"));
    fireEvent.change(screen.getByTestId("client-org-gstin-input"), {
      target: { value: "29ABCPK1234F1Z5" }
    });
    fireEvent.change(screen.getByTestId("client-org-company-name-input"), {
      target: { value: "Acme" }
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("client-org-form-submit"));
    });
    expect(await screen.findByTestId("client-org-form-error")).toHaveTextContent(/duplicate gstin|create/i);
  });
});

describe("features/admin/onboarding/ClientOrgsPage — edit flow", () => {
  it("locks the GSTIN field and PATCHes only mutable fields", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-1", gstin: "29ABCPK1234F1Z5", companyName: "Sharma Textiles" })
    ]);
    mocked.updateClientOrganization.mockResolvedValue(
      buildOrg({ _id: "org-1", gstin: "29ABCPK1234F1Z5", companyName: "Sharma Exports" })
    );

    renderPage();
    await screen.findByTestId("client-orgs-table");
    fireEvent.click(screen.getByTestId("client-orgs-table-edit"));

    const gstinInput = screen.getByTestId("client-org-gstin-input") as HTMLInputElement;
    expect(gstinInput).toBeDisabled();

    fireEvent.change(screen.getByTestId("client-org-company-name-input"), {
      target: { value: "Sharma Exports" }
    });
    fireEvent.click(screen.getByTestId("client-org-f12-checkbox"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("client-org-form-submit"));
    });

    await waitFor(() => {
      expect(mocked.updateClientOrganization).toHaveBeenCalled();
    });
    // The page wraps updateClientOrganization in a mutationFn that calls it
    // as `(id, payload)`; assert on those two positional args.
    const [calledId, calledPayload] = mocked.updateClientOrganization.mock.calls[0];
    expect(calledId).toBe("org-1");
    expect(calledPayload).toEqual({
      companyName: "Sharma Exports",
      stateName: undefined,
      f12OverwriteByGuidVerified: true
    });
  });
});

describe("features/admin/onboarding/ClientOrgsPage — archive flow", () => {
  it("clears the active realm when the archived org was active", async () => {
    setActiveClientOrgId("org-1");
    mocked.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-1", gstin: "29ABCPK1234F1Z5", companyName: "Sharma Textiles" })
    ]);
    mocked.deleteClientOrganization.mockResolvedValue({
      status: "archived",
      linkedCounts: { invoices: 12, vendors: 3 },
      archivedAt: "2026-04-25T00:00:00Z"
    });

    renderPage();
    await screen.findByTestId("client-orgs-table");
    fireEvent.click(screen.getByTestId("client-orgs-table-archive"));
    // Two "Archive" buttons exist while the dialog is open (the row trigger
    // and the dialog's confirm button); pick the dialog's via the alertdialog.
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /archive/i }));

    await waitFor(() => {
      expect(mocked.deleteClientOrganization).toHaveBeenCalled();
    });
    expect(mocked.deleteClientOrganization.mock.calls[0][0]).toBe("org-1");
    await waitFor(() => {
      expect(window.sessionStorage.getItem("activeClientOrgId")).toBeNull();
    });
  });

  it("warns in the dialog that linked accounting records remain read-only", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-1", gstin: "29ABCPK1234F1Z5", companyName: "Sharma Textiles" })
    ]);

    renderPage();
    await screen.findByTestId("client-orgs-table");
    fireEvent.click(screen.getByTestId("client-orgs-table-archive"));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/linked accounting records/i);
    expect(dialog).toHaveTextContent(/read-accessible|read-only/i);
    expect(dialog).toHaveTextContent(/breakdown is shown/i);
  });

  it("renders the linked-records breakdown banner after a soft-archive succeeds", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-1", gstin: "29ABCPK1234F1Z5", companyName: "Sharma Textiles" })
    ]);
    mocked.deleteClientOrganization.mockResolvedValue({
      status: "archived",
      linkedCounts: { invoices: 12, vendors: 3, bankStatements: 2 },
      archivedAt: "2026-04-25T00:00:00Z"
    });

    renderPage();
    await screen.findByTestId("client-orgs-table");
    fireEvent.click(screen.getByTestId("client-orgs-table-archive"));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /archive/i }));
    });

    const notice = await screen.findByTestId("client-orgs-archive-notice");
    expect(notice.dataset.status).toBe("archived");
    expect(notice).toHaveTextContent(/Sharma Textiles/);
    expect(notice).toHaveTextContent(/12 invoices/);
    expect(notice).toHaveTextContent(/3 vendors/);
    expect(notice).toHaveTextContent(/2 bank statements/);
    // List items present per dependent label.
    expect(screen.getByTestId("client-orgs-archive-notice-item-invoices")).toHaveTextContent(/12 invoices/);
    expect(screen.getByTestId("client-orgs-archive-notice-item-vendors")).toHaveTextContent(/3 vendors/);
    expect(screen.getByTestId("client-orgs-archive-notice-item-bankStatements")).toHaveTextContent(/2 bank statements/);

    fireEvent.click(screen.getByTestId("client-orgs-archive-notice-dismiss"));
    await waitFor(() => {
      expect(screen.queryByTestId("client-orgs-archive-notice")).not.toBeInTheDocument();
    });
  });

  it("singularizes the count label when only one record is linked", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-1", gstin: "29ABCPK1234F1Z5", companyName: "Sharma Textiles" })
    ]);
    mocked.deleteClientOrganization.mockResolvedValue({
      status: "archived",
      linkedCounts: { invoices: 1 },
      archivedAt: "2026-04-25T00:00:00Z"
    });

    renderPage();
    await screen.findByTestId("client-orgs-table");
    fireEvent.click(screen.getByTestId("client-orgs-table-archive"));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /archive/i }));
    });

    const notice = await screen.findByTestId("client-orgs-archive-notice");
    expect(notice).toHaveTextContent(/1 invoice\b/);
    expect(notice).not.toHaveTextContent(/1 invoices/);
  });

  it("renders a deleted-outright banner when no dependents existed", async () => {
    mocked.fetchClientOrganizations.mockResolvedValue([
      buildOrg({ _id: "org-1", gstin: "29ABCPK1234F1Z5", companyName: "Sharma Textiles" })
    ]);
    mocked.deleteClientOrganization.mockResolvedValue({
      status: "deleted",
      linkedCounts: {}
    });

    renderPage();
    await screen.findByTestId("client-orgs-table");
    fireEvent.click(screen.getByTestId("client-orgs-table-archive"));
    const dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /archive/i }));
    });

    const notice = await screen.findByTestId("client-orgs-archive-notice");
    expect(notice.dataset.status).toBe("deleted");
    expect(notice).toHaveTextContent(/no linked accounting records/i);
    expect(notice).toHaveTextContent(/deleted outright/i);
    expect(screen.queryByTestId("client-orgs-archive-notice-list")).not.toBeInTheDocument();
  });
});
