/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  MailboxesPage,
  MAILBOXES_PAGE_VIEW
} from "@/features/admin/mailboxes/MailboxesPage";
import type { MailboxAssignment } from "@/api/mailboxAssignments";

jest.mock("@/api/mailboxAssignments", () => ({
  fetchMailboxAssignments: jest.fn(),
  createMailboxAssignment: jest.fn(),
  updateMailboxAssignment: jest.fn(),
  deleteMailboxAssignment: jest.fn()
}));

jest.mock("@/api/clientOrgs", () => ({
  fetchClientOrganizations: jest.fn().mockResolvedValue([
    {
      _id: "org-1",
      tenantId: "tenant-1",
      gstin: "29ABCPK1234F1Z5",
      companyName: "Sharma Textiles",
      f12OverwriteByGuidVerified: false,
      detectedVersion: null,
      createdAt: "2026-04-20T00:00:00Z",
      updatedAt: "2026-04-20T00:00:00Z"
    },
    {
      _id: "org-2",
      tenantId: "tenant-1",
      gstin: "07AABCC1234D1ZA",
      companyName: "Bose Steel",
      f12OverwriteByGuidVerified: false,
      detectedVersion: null,
      createdAt: "2026-04-20T00:00:00Z",
      updatedAt: "2026-04-20T00:00:00Z"
    }
  ])
}));

const mocked = jest.requireMock("@/api/mailboxAssignments") as {
  fetchMailboxAssignments: jest.Mock;
  createMailboxAssignment: jest.Mock;
  updateMailboxAssignment: jest.Mock;
  deleteMailboxAssignment: jest.Mock;
};

function renderPage(): { unmount: () => void } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<MailboxesPage />, { wrapper });
}

function buildAssignment(overrides: Partial<MailboxAssignment> & { _id: string }): MailboxAssignment {
  return {
    integrationId: `int-${overrides._id}`,
    email: `${overrides._id}@firm.com`,
    clientOrgIds: ["org-1"],
    assignedTo: "all",
    status: "CONNECTED",
    lastSyncedAt: null,
    pollingConfig: null,
    createdAt: null,
    updatedAt: null,
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
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

describe("features/admin/mailboxes/MailboxesPage — 4-state contract", () => {
  it("renders the loading view while the list query is pending", () => {
    mocked.fetchMailboxAssignments.mockImplementation(() => new Promise(() => {}));
    renderPage();
    const page = screen.getByTestId("mailboxes-page");
    expect(page.dataset.view).toBe(MAILBOXES_PAGE_VIEW.Loading);
    expect(screen.getByTestId("mailboxes-loading")).toBeInTheDocument();
  });

  it("renders the error view with a retry button when the query fails", async () => {
    mocked.fetchMailboxAssignments.mockRejectedValue(new Error("boom"));
    renderPage();
    const errorRegion = await screen.findByTestId("mailboxes-error");
    expect(errorRegion).toHaveTextContent(/boom|couldn.t load/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders the empty CTA when the tenant has zero mailbox assignments", async () => {
    mocked.fetchMailboxAssignments.mockResolvedValue([]);
    renderPage();
    const empty = await screen.findByTestId("mailboxes-empty");
    expect(empty).toHaveTextContent(/no mailboxes connected yet/i);
    expect(screen.getByTestId("mailboxes-empty-cta")).toBeInTheDocument();
  });

  it("renders the data table when assignments exist", async () => {
    mocked.fetchMailboxAssignments.mockResolvedValue([
      buildAssignment({ _id: "a-1", email: "alpha@firm.com" }),
      buildAssignment({ _id: "a-2", email: "zeta@firm.com" })
    ]);
    renderPage();
    await screen.findByTestId("mailboxes-table");
    expect(screen.getAllByTestId("mailboxes-table-row")).toHaveLength(2);
  });
});

describe("features/admin/mailboxes/MailboxesPage — edit flow", () => {
  it("PATCHes only clientOrgIds and locks the email field", async () => {
    mocked.fetchMailboxAssignments.mockResolvedValue([
      buildAssignment({ _id: "a-1", clientOrgIds: ["org-1"] })
    ]);
    mocked.updateMailboxAssignment.mockResolvedValue(buildAssignment({ _id: "a-1" }));

    renderPage();
    await screen.findByTestId("mailboxes-table");
    fireEvent.click(screen.getByTestId("mailboxes-table-edit-a-1"));

    await waitFor(() => {
      expect(screen.getByTestId("mailbox-form")).toBeInTheDocument();
    });
    const emailInput = screen.getByTestId("mailbox-form-email-input") as HTMLInputElement;
    expect(emailInput).toBeDisabled();

    // Add org-2 to the picker.
    await waitFor(() => {
      expect(screen.getByTestId("client-org-multi-picker-checkbox-org-2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-2"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("mailbox-form-submit"));
    });

    await waitFor(() => {
      expect(mocked.updateMailboxAssignment).toHaveBeenCalled();
    });
    const [calledId, calledPayload] = mocked.updateMailboxAssignment.mock.calls[0];
    expect(calledId).toBe("a-1");
    expect(calledPayload).toEqual({ clientOrgIds: ["org-1", "org-2"] });
  });
});

describe("features/admin/mailboxes/MailboxesPage — delete flow", () => {
  it("opens the confirm dialog and DELETEs by id on confirm", async () => {
    mocked.fetchMailboxAssignments.mockResolvedValue([buildAssignment({ _id: "a-1" })]);
    mocked.deleteMailboxAssignment.mockResolvedValue(undefined);

    renderPage();
    await screen.findByTestId("mailboxes-table");
    fireEvent.click(screen.getByTestId("mailboxes-table-delete-a-1"));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete/i }));

    await waitFor(() => {
      expect(mocked.deleteMailboxAssignment).toHaveBeenCalled();
    });
    expect(mocked.deleteMailboxAssignment.mock.calls[0][0]).toBe("a-1");
  });
});
