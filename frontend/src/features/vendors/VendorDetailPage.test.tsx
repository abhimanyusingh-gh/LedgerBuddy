/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { VendorDetailPage } from "@/features/vendors/VendorDetailPage";
import { VENDOR_STATUS, type VendorDetail, type VendorId } from "@/types/vendor";

jest.mock("@/api/vendors", () => ({
  fetchVendorDetail: jest.fn(),
  fetchVendorList: jest.fn(),
  uploadVendorSection197Cert: jest.fn(),
  mergeVendor: jest.fn()
}));

jest.mock("@/api/reports", () => ({
  TDS_LIABILITY_QUERY_KEY: "tdsLiabilityReport",
  fetchTdsLiabilityReport: jest.fn()
}));

const vendorsApi = jest.requireMock("@/api/vendors") as {
  fetchVendorDetail: jest.Mock;
  fetchVendorList: jest.Mock;
  uploadVendorSection197Cert: jest.Mock;
  mergeVendor: jest.Mock;
};

const reportsApi = jest.requireMock("@/api/reports") as {
  fetchTdsLiabilityReport: jest.Mock;
  TDS_LIABILITY_QUERY_KEY: string;
};

const VENDOR_ID = "65a000000000000000000001" as VendorId;
const SOURCE_ID = "65a000000000000000000002" as VendorId;
const TARGET_FINGERPRINT = "fp-acme";
const SOURCE_FINGERPRINT = "fp-acme-dup";

function buildVendorDetail(overrides: Partial<VendorDetail> = {}): VendorDetail {
  return {
    _id: VENDOR_ID,
    vendorFingerprint: TARGET_FINGERPRINT,
    name: "Acme Trading Co",
    pan: "AABCM1234A",
    gstin: "29ABCDE1234F1Z5",
    vendorStatus: VENDOR_STATUS.ACTIVE,
    defaultGlCode: null,
    defaultTdsSection: null,
    tallyLedgerName: "Acme Trading Co - Sundry",
    tallyLedgerGroup: "Sundry Creditors",
    stateCode: "29",
    stateName: "Karnataka",
    msme: { udyamNumber: null, classification: "small", verifiedAt: null, agreedPaymentDays: 45 },
    lowerDeductionCert: null,
    invoiceCount: 12,
    lastInvoiceDate: "2026-04-20T00:00:00Z",
    ...overrides
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<VendorDetailPage vendorId={VENDOR_ID} />, { wrapper: Wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.location.hash = `#/vendors/${VENDOR_ID}`;
  reportsApi.fetchTdsLiabilityReport.mockResolvedValue({
    tan: null,
    fy: "2026-27",
    bySection: [],
    byVendor: [],
    byQuarter: []
  });
  vendorsApi.fetchVendorList.mockResolvedValue({ items: [], page: 1, limit: 25, total: 0 });
});

describe("features/vendors/VendorDetailPage — 4-state UX", () => {
  it("renders loading state while detail query is pending", () => {
    vendorsApi.fetchVendorDetail.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId("vendor-detail-loading")).toBeInTheDocument();
  });

  it("renders error state with retry on detail fetch failure", async () => {
    vendorsApi.fetchVendorDetail.mockRejectedValue(new Error("offline"));
    renderPage();
    await screen.findByTestId("vendor-detail-error");
    expect(screen.getByTestId("vendor-detail-error-retry")).toBeInTheDocument();
  });

  it("renders header with vendor metadata when data loads", async () => {
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    renderPage();
    await screen.findByTestId("vendor-detail-header");
    expect(screen.getByText("Acme Trading Co")).toBeInTheDocument();
    expect(screen.getByTestId("vendor-detail-gstin")).toHaveTextContent("29ABCDE1234F1Z5");
    expect(screen.getByTestId("vendor-detail-pan")).toHaveTextContent("AABCM1234A");
    expect(screen.getByTestId("vendor-detail-state")).toHaveTextContent("Karnataka");
    expect(screen.getByTestId("vendor-detail-tally-ledger")).toHaveTextContent("Sundry");
    expect(screen.getByTestId("vendor-detail-msme")).toHaveTextContent(/MSME/);
  });
});

describe("features/vendors/VendorDetailPage — sub-tab routing", () => {
  it("defaults to invoices sub-tab and shows the dependency stub", async () => {
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    renderPage();
    await screen.findByTestId("vendor-invoices-tab");
    expect(screen.getByText(/#380/)).toBeInTheDocument();
  });

  it("switches to TDS sub-tab and persists in URL hash", async () => {
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    renderPage();
    await screen.findByTestId("vendor-detail-header");

    act(() => {
      fireEvent.click(screen.getByTestId("vendor-detail-tab-tds"));
    });
    await waitFor(() => expect(window.location.hash).toContain("tab=tds"));
    await screen.findByTestId("vendor-tds-tab");
  });

  it("seeds sub-tab from URL hash on first render", async () => {
    window.location.hash = `#/vendors/${VENDOR_ID}?tab=cert197`;
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    renderPage();
    await screen.findByTestId("vendor-cert197-panel");
  });

  it("renders empty TDS state when ledger has no buckets", async () => {
    window.location.hash = `#/vendors/${VENDOR_ID}?tab=tds`;
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    renderPage();
    await screen.findByTestId("vendor-tds-empty");
  });

  it("renders TDS rows when ledger has buckets", async () => {
    window.location.hash = `#/vendors/${VENDOR_ID}?tab=tds`;
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    reportsApi.fetchTdsLiabilityReport.mockResolvedValue({
      tan: "ABCD12345E",
      fy: "2026-27",
      bySection: [],
      byVendor: [
        {
          vendorFingerprint: "fp-acme",
          section: "194C",
          cumulativeBaseMinor: 250000000,
          cumulativeTdsMinor: 5000000,
          invoiceCount: 4,
          thresholdCrossedAt: "2026-04-15T00:00:00Z"
        }
      ],
      byQuarter: []
    });
    renderPage();
    const row = await screen.findByTestId("vendor-tds-row");
    expect(row).toHaveTextContent("194C");
    expect(screen.getByTestId("vendor-tds-drilldown-link")).toHaveAttribute(
      "href",
      expect.stringContaining("section=194C")
    );
  });

  it("renders TDS error state on fetch failure", async () => {
    window.location.hash = `#/vendors/${VENDOR_ID}?tab=tds`;
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    reportsApi.fetchTdsLiabilityReport.mockRejectedValue(new Error("nope"));
    renderPage();
    await screen.findByTestId("vendor-tds-error");
  });
});

describe("features/vendors/VendorDetailPage — Section 197 cert panel", () => {
  it("shows empty state when no cert is on file", async () => {
    window.location.hash = `#/vendors/${VENDOR_ID}?tab=cert197`;
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    renderPage();
    await screen.findByTestId("vendor-cert197-empty");
    expect(screen.getByTestId("vendor-cert197-form")).toBeInTheDocument();
  });

  it("renders cert card when cert exists with timezone-safe IST formatting", async () => {
    window.location.hash = `#/vendors/${VENDOR_ID}?tab=cert197`;
    vendorsApi.fetchVendorDetail.mockResolvedValue(
      buildVendorDetail({
        lowerDeductionCert: {
          certificateNumber: "CERT-2026-001",
          validFrom: "2026-04-01T00:00:00Z",
          validTo: "2027-03-31T00:00:00Z",
          maxAmountMinor: 100000000,
          applicableRateBps: 100
        }
      })
    );
    renderPage();
    const card = await screen.findByTestId("vendor-cert197-card");
    expect(card).toHaveTextContent("CERT-2026-001");
    const validity = screen.getByTestId("vendor-cert197-card-validity");
    expect(validity.textContent).toMatch(/2026/);
    expect(validity.textContent).toMatch(/2027/);
  });
});

describe("features/vendors/VendorDetailPage — VendorMergeDialog", () => {
  it("requires explicit confirm and never auto-merges", async () => {
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    vendorsApi.fetchVendorList.mockResolvedValue({
      items: [
        {
          _id: SOURCE_ID,
          vendorFingerprint: SOURCE_FINGERPRINT,
          name: "Acme Tradng",
          pan: "AABCM1234A",
          gstin: "29ABCDE1234F1Z5",
          vendorStatus: VENDOR_STATUS.ACTIVE,
          msme: null,
          section197Cert: null,
          invoiceCount: 3,
          lastInvoiceDate: "2026-03-01T00:00:00Z",
          fytdSpendMinor: 0,
          fytdTdsMinor: 0
        }
      ],
      page: 1,
      limit: 25,
      total: 1
    });
    vendorsApi.mergeVendor.mockResolvedValue({
      targetVendorId: VENDOR_ID,
      sourceVendorId: SOURCE_ID,
      ledgersConsolidated: 1,
      invoicesRepointed: 3
    });

    renderPage();
    await screen.findByTestId("vendor-detail-header");

    act(() => {
      fireEvent.click(screen.getByTestId("vendor-detail-merge"));
    });
    await screen.findByTestId("vendor-merge-dialog");

    const candidate = await screen.findByTestId("vendor-merge-candidate");
    expect(vendorsApi.mergeVendor).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(candidate);
    });

    await screen.findByTestId("vendor-merge-request-confirm");
    expect(vendorsApi.mergeVendor).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByTestId("vendor-merge-request-confirm"));
    });
    await screen.findByTestId("vendor-merge-confirm");
    expect(vendorsApi.mergeVendor).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(screen.getByTestId("vendor-merge-confirm"));
    });
    await waitFor(() =>
      expect(vendorsApi.mergeVendor).toHaveBeenCalledWith(VENDOR_ID, SOURCE_ID)
    );
  });

  it("cancels without invoking merge", async () => {
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    renderPage();
    await screen.findByTestId("vendor-detail-header");

    act(() => {
      fireEvent.click(screen.getByTestId("vendor-detail-merge"));
    });
    await screen.findByTestId("vendor-merge-dialog");

    act(() => {
      fireEvent.click(screen.getByTestId("vendor-merge-cancel"));
    });
    expect(screen.queryByTestId("vendor-merge-dialog")).not.toBeInTheDocument();
    expect(vendorsApi.mergeVendor).not.toHaveBeenCalled();
  });

  it("renders TdsVendorLedger consolidation preview after candidate selection", async () => {
    vendorsApi.fetchVendorDetail.mockResolvedValue(buildVendorDetail());
    vendorsApi.fetchVendorList.mockResolvedValue({
      items: [
        {
          _id: SOURCE_ID,
          vendorFingerprint: SOURCE_FINGERPRINT,
          name: "Acme Tradng",
          pan: "AABCM1234A",
          gstin: "29ABCDE1234F1Z5",
          vendorStatus: VENDOR_STATUS.ACTIVE,
          msme: null,
          section197Cert: null,
          invoiceCount: 3,
          lastInvoiceDate: "2026-03-01T00:00:00Z",
          fytdSpendMinor: 0,
          fytdTdsMinor: 0
        }
      ],
      page: 1,
      limit: 25,
      total: 1
    });
    const TARGET_TDS_MINOR = 4000000;
    const SOURCE_TDS_MINOR = 2000000;
    reportsApi.fetchTdsLiabilityReport.mockImplementation(({ vendorFingerprint }: { vendorFingerprint: string }) => {
      if (vendorFingerprint !== TARGET_FINGERPRINT && vendorFingerprint !== SOURCE_FINGERPRINT) {
        return Promise.resolve({
          tan: null,
          fy: "2026-27",
          bySection: [],
          byVendor: [],
          byQuarter: []
        });
      }
      const isTarget = vendorFingerprint === TARGET_FINGERPRINT;
      return Promise.resolve({
        tan: null,
        fy: "2026-27",
        bySection: [],
        byVendor: [
          {
            vendorFingerprint,
            section: "194C",
            cumulativeBaseMinor: isTarget ? 200000000 : 100000000,
            cumulativeTdsMinor: isTarget ? TARGET_TDS_MINOR : SOURCE_TDS_MINOR,
            invoiceCount: isTarget ? 4 : 2,
            thresholdCrossedAt: null
          }
        ],
        byQuarter: []
      });
    });

    renderPage();
    await screen.findByTestId("vendor-detail-header");
    act(() => {
      fireEvent.click(screen.getByTestId("vendor-detail-merge"));
    });
    const candidate = await screen.findByTestId("vendor-merge-candidate");
    act(() => {
      fireEvent.click(candidate);
    });
    await screen.findByTestId("vendor-merge-preview");
    const row = screen.getByTestId("vendor-merge-preview-row");
    expect(row).toHaveTextContent("194C");

    await waitFor(() =>
      expect(reportsApi.fetchTdsLiabilityReport).toHaveBeenCalledWith(
        expect.objectContaining({ vendorFingerprint: SOURCE_FINGERPRINT })
      )
    );
    expect(reportsApi.fetchTdsLiabilityReport).toHaveBeenCalledWith(
      expect.objectContaining({ vendorFingerprint: TARGET_FINGERPRINT })
    );
    const numericCells = row.querySelectorAll(".vendor-merge-preview-numeric");
    expect(numericCells[0]).toHaveTextContent("40,000.00");
    expect(numericCells[1]).toHaveTextContent("20,000.00");
    expect(numericCells[2]).toHaveTextContent("60,000.00");
  });
});
