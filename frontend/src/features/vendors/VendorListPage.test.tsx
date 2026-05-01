/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { VendorListPage } from "@/features/vendors/VendorListPage";
import {
  VENDOR_STATUS,
  type VendorListItemSummary,
  type VendorListResponse
} from "@/types/vendor";

jest.mock("@/api/vendors", () => ({
  fetchVendorList: jest.fn()
}));

const vendorsApi = jest.requireMock("@/api/vendors") as {
  fetchVendorList: jest.Mock;
};

function buildVendor(overrides: Partial<VendorListItemSummary> & { _id: string; name: string }): VendorListItemSummary {
  return {
    pan: "AABCM1234A",
    gstin: "29ABCDE1234F1Z5",
    vendorStatus: VENDOR_STATUS.ACTIVE,
    msme: null,
    section197Cert: null,
    invoiceCount: 5,
    lastInvoiceDate: "2026-04-20T00:00:00Z",
    fytdSpendMinor: 250000000,
    fytdTdsMinor: 12500000,
    ...overrides
  } as VendorListItemSummary;
}

function buildResponse(items: VendorListItemSummary[], total = items.length): VendorListResponse {
  return { items, page: 1, limit: 50, total };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, ...render(<VendorListPage />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  window.location.hash = "";
});

describe("features/vendors/VendorListPage — 4-state UX", () => {
  it("renders the loading state while the query is pending", () => {
    vendorsApi.fetchVendorList.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId("vendors-loading")).toBeInTheDocument();
  });

  it("renders the error state with a retry button", async () => {
    vendorsApi.fetchVendorList.mockRejectedValue(new Error("offline"));
    renderPage();
    await screen.findByTestId("vendors-error");
    expect(screen.getByTestId("vendors-error-retry")).toBeInTheDocument();
  });

  it("renders the empty state when no vendors exist and no filters are applied", async () => {
    vendorsApi.fetchVendorList.mockResolvedValue(buildResponse([]));
    renderPage();
    await screen.findByTestId("vendors-empty");
  });

  it("renders the zero-result state when filters are active but yield no rows", async () => {
    vendorsApi.fetchVendorList.mockResolvedValue(buildResponse([]));
    window.location.hash = "#/vendors?q=ghost";
    renderPage();
    await screen.findByTestId("vendors-zero-result");
    expect(screen.getByTestId("vendors-zero-result-reset")).toBeInTheDocument();
  });

  it("renders rows when vendors are present", async () => {
    vendorsApi.fetchVendorList.mockResolvedValue(
      buildResponse([buildVendor({ _id: "v1", name: "Acme Co" })])
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("Acme Co")).toBeInTheDocument());
    expect(screen.getByTestId("vendors-table")).toBeInTheDocument();
  });
});

describe("features/vendors/VendorListPage — URL-as-state", () => {
  it("seeds search/filter/sort state from the URL hash", async () => {
    vendorsApi.fetchVendorList.mockResolvedValue(buildResponse([]));
    window.location.hash = "#/vendors?q=acme&status=blocked&msme=yes&sort=name&dir=asc&page=2&size=25";
    renderPage();
    await waitFor(() => expect(vendorsApi.fetchVendorList).toHaveBeenCalled());
    const args = vendorsApi.fetchVendorList.mock.calls[0][0];
    expect(args.search).toBe("acme");
    expect(args.status).toBe(VENDOR_STATUS.BLOCKED);
    expect(args.hasMsme).toBe(true);
    expect(args.sortField).toBe("name");
    expect(args.sortDirection).toBe("asc");
    expect(args.page).toBe(2);
    expect(args.limit).toBe(25);
  });

  it("writes filter changes back into the URL hash", async () => {
    vendorsApi.fetchVendorList.mockResolvedValue(buildResponse([buildVendor({ _id: "v1", name: "Acme" })]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());

    act(() => {
      fireEvent.change(screen.getByTestId("vendors-filter-status"), { target: { value: VENDOR_STATUS.BLOCKED } });
    });
    await waitFor(() => expect(window.location.hash).toContain("status=blocked"));
  });

  it("flips sort direction when the same column header is clicked twice", async () => {
    vendorsApi.fetchVendorList.mockResolvedValue(buildResponse([buildVendor({ _id: "v1", name: "Acme" })]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());

    act(() => {
      fireEvent.click(screen.getByTestId("vendors-th-name"));
    });
    await waitFor(() => expect(window.location.hash).toContain("sort=name"));
    expect(window.location.hash).not.toContain("dir=");

    await waitFor(() => expect(screen.queryByTestId("vendors-th-name")).toBeInTheDocument());
    act(() => {
      fireEvent.click(screen.getByTestId("vendors-th-name"));
    });
    await waitFor(() => expect(window.location.hash).toContain("dir=asc"));
  });
});

describe("features/vendors/VendorListPage — actions", () => {
  it("opens the merge-placeholder dialog from a row's Merge button", async () => {
    vendorsApi.fetchVendorList.mockResolvedValue(buildResponse([buildVendor({ _id: "v1", name: "Acme" })]));
    renderPage();
    await waitFor(() => expect(screen.getByText("Acme")).toBeInTheDocument());

    act(() => {
      fireEvent.click(screen.getByTestId("vendors-row-merge"));
    });
    expect(screen.getByTestId("vendors-merge-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("vendors-merge-placeholder")).toHaveTextContent(/#264/);

    act(() => {
      fireEvent.click(screen.getByTestId("vendors-merge-placeholder-close"));
    });
    expect(screen.queryByTestId("vendors-merge-placeholder")).not.toBeInTheDocument();
  });
});

describe("features/vendors/VendorListPage — virtualised body at 500+ rows", () => {
  it("renders only a sliding window of rows for a 600-vendor result", async () => {
    const items = Array.from({ length: 600 }, (_, i) =>
      buildVendor({ _id: `v-${i}`, name: `Vendor ${i}` })
    );
    vendorsApi.fetchVendorList.mockResolvedValue({ items, page: 1, limit: 600, total: 600 });
    renderPage();
    await waitFor(() => expect(screen.getByText("Vendor 0")).toBeInTheDocument());
    const body = screen.getByTestId("vendors-virtualised-body");
    expect(Number(body.dataset.totalCount)).toBe(600);
    expect(Number(body.dataset.renderedCount)).toBeLessThan(40);
  });
});
