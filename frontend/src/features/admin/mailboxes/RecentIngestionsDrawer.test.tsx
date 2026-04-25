/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  RECENT_INGESTIONS_DRAWER_VIEW,
  RecentIngestionsDrawer
} from "@/features/admin/mailboxes/RecentIngestionsDrawer";
import type { MailboxRecentIngestionsResponse } from "@/api/mailboxAssignments";

jest.mock("@/api/mailboxAssignments", () => ({
  fetchMailboxRecentIngestions: jest.fn()
}));

const { fetchMailboxRecentIngestions } = jest.requireMock("@/api/mailboxAssignments") as {
  fetchMailboxRecentIngestions: jest.Mock;
};

const ORGS = [
  { id: "org-1", companyName: "Sharma Textiles" },
  { id: "org-2", companyName: "Bose Steel" }
];

function renderDrawer(props?: { assignmentId?: string | null; open?: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const assignmentId =
    props && Object.prototype.hasOwnProperty.call(props, "assignmentId")
      ? (props.assignmentId ?? null)
      : "a-1";
  return render(
    <RecentIngestionsDrawer
      open={props?.open ?? true}
      assignmentId={assignmentId}
      mailboxEmail="alpha@firm.com"
      clientOrgs={ORGS}
      onClose={() => {}}
    />,
    { wrapper }
  );
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

function buildResponse(
  overrides: Partial<MailboxRecentIngestionsResponse> = {}
): MailboxRecentIngestionsResponse {
  return {
    items: [],
    total: 0,
    periodDays: 30,
    truncatedAt: 50,
    ...overrides
  };
}

describe("features/admin/mailboxes/RecentIngestionsDrawer — 4-state contract", () => {
  it("renders the loading view while the fetch is pending", () => {
    fetchMailboxRecentIngestions.mockImplementation(() => new Promise(() => {}));
    renderDrawer();
    const drawer = screen.getByTestId("recent-ingestions-drawer");
    expect(drawer.dataset.view).toBe(RECENT_INGESTIONS_DRAWER_VIEW.Loading);
    expect(screen.getByTestId("recent-ingestions-loading")).toBeInTheDocument();
  });

  it("renders the error view with a Retry button when the fetch fails", async () => {
    fetchMailboxRecentIngestions.mockRejectedValueOnce(new Error("network down"));
    renderDrawer();
    const errorRegion = await screen.findByTestId("recent-ingestions-error");
    expect(errorRegion).toHaveTextContent(/network down|couldn.t load/i);
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders the empty view when the assignment has no ingestions in 30d", async () => {
    fetchMailboxRecentIngestions.mockResolvedValueOnce(buildResponse({ total: 0, items: [] }));
    renderDrawer();
    const empty = await screen.findByTestId("recent-ingestions-empty");
    expect(empty).toHaveTextContent(/no ingestions in the last 30 days/i);
  });

  it("renders rows + a summary line when data is present", async () => {
    fetchMailboxRecentIngestions.mockResolvedValueOnce(
      buildResponse({
        total: 2,
        items: [
          {
            _id: "inv-1",
            clientOrgId: "org-1",
            status: "PARSED",
            attachmentName: "invoice-1.pdf",
            receivedAt: "2026-04-20T10:00:00Z",
            createdAt: "2026-04-20T10:05:00Z",
            vendorName: "Acme Inc",
            invoiceNumber: "INV-001",
            totalAmountMinor: 12000,
            currency: "INR"
          },
          {
            _id: "inv-2",
            clientOrgId: "org-2",
            status: "TRIAGE",
            attachmentName: null,
            receivedAt: null,
            createdAt: null,
            vendorName: null,
            invoiceNumber: null,
            totalAmountMinor: null,
            currency: null
          }
        ]
      })
    );
    renderDrawer();
    await screen.findByTestId("recent-ingestions-list");
    expect(screen.getByTestId("recent-ingestions-row-inv-1")).toHaveTextContent("INV-001");
    expect(screen.getByTestId("recent-ingestions-row-inv-1")).toHaveTextContent("Acme Inc");
    expect(screen.getByTestId("recent-ingestions-row-inv-1")).toHaveTextContent(
      "Sharma Textiles"
    );
    expect(screen.getByTestId("recent-ingestions-row-inv-2")).toHaveTextContent("Unknown vendor");
    expect(screen.getByTestId("recent-ingestions-summary")).toHaveTextContent(
      /2 ingestions in the last 30 days/i
    );
  });

  it("shows the truncation banner when total > items length", async () => {
    fetchMailboxRecentIngestions.mockResolvedValueOnce(
      buildResponse({
        total: 137,
        truncatedAt: 50,
        items: Array.from({ length: 50 }, (_, i) => ({
          _id: `inv-${i}`,
          clientOrgId: "org-1",
          status: "PARSED",
          attachmentName: null,
          receivedAt: null,
          createdAt: "2026-04-20T10:00:00Z",
          vendorName: "v",
          invoiceNumber: `n-${i}`,
          totalAmountMinor: null,
          currency: null
        }))
      })
    );
    renderDrawer();
    const banner = await screen.findByTestId("recent-ingestions-truncation");
    expect(banner).toHaveTextContent(/showing first 50 of 137/i);
  });

  it("retries the fetch when the user clicks Retry", async () => {
    fetchMailboxRecentIngestions.mockRejectedValueOnce(new Error("boom"));
    renderDrawer();
    await screen.findByTestId("recent-ingestions-error");
    fetchMailboxRecentIngestions.mockResolvedValueOnce(buildResponse({ total: 0, items: [] }));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByTestId("recent-ingestions-empty")).toBeInTheDocument();
    });
  });

  it("does not fetch when assignmentId is null or open=false", () => {
    renderDrawer({ assignmentId: null });
    expect(fetchMailboxRecentIngestions).not.toHaveBeenCalled();
  });
});
