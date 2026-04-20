/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VendorDetailsSection } from "./VendorDetailsSection";
import { CustomerDetailsSection } from "./CustomerDetailsSection";
import type { Invoice } from "@/types";

function makeInvoice(overrides: Partial<Invoice["parsed"]> = {}): Invoice {
  return {
    _id: "inv-1",
    tenantId: "t-1",
    workloadTier: "standard",
    sourceType: "email",
    sourceKey: "k1",
    sourceDocumentId: "d1",
    attachmentName: "invoice.pdf",
    mimeType: "application/pdf",
    receivedAt: new Date().toISOString(),
    confidenceScore: 85,
    confidenceTone: "green",
    autoSelectForApproval: false,
    status: "PARSED",
    processingIssues: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    parsed: {
      vendorName: "Acme Corp",
      vendorAddress: "123 Main St\nMumbai, MH 400001",
      vendorGstin: "27AADCB2230M1Z3",
      vendorPan: "AADCB2230M",
      customerName: "BillForge Inc",
      customerAddress: "456 Oak Ave\nDelhi, DL 110001",
      customerGstin: "07BBBBB1234B1Z5",
      ...overrides,
    },
  } as Invoice;
}

type SectionCase = {
  name: "Vendor" | "Customer";
  Component: typeof VendorDetailsSection | typeof CustomerDetailsSection;
  header: string;
  visibleWhenExpanded: string;
  missingOverrides: Partial<Invoice["parsed"]>;
};

const sectionCases: SectionCase[] = [
  {
    name: "Vendor",
    Component: VendorDetailsSection,
    header: "Vendor Details",
    visibleWhenExpanded: "AADCB2230M",
    missingOverrides: {
      vendorName: undefined,
      vendorAddress: undefined,
      vendorGstin: undefined,
      vendorPan: undefined,
    },
  },
  {
    name: "Customer",
    Component: CustomerDetailsSection,
    header: "Customer Details",
    visibleWhenExpanded: "BillForge Inc",
    missingOverrides: {
      customerName: undefined,
      customerAddress: undefined,
      customerGstin: undefined,
    },
  },
];

describe("VendorDetailsSection / CustomerDetailsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe.each(sectionCases)("$name section", ({ Component, header, visibleWhenExpanded, missingOverrides }) => {
    it("renders section content when expanded", () => {
      render(<Component invoice={makeInvoice()} expanded={true} onToggle={jest.fn()} />);
      expect(screen.getByText(header)).toBeInTheDocument();
      expect(screen.getByText(visibleWhenExpanded)).toBeInTheDocument();
    });

    it("shows Not extracted for missing fields", () => {
      render(<Component invoice={makeInvoice(missingOverrides)} expanded={true} onToggle={jest.fn()} />);
      const notExtracted = screen.getAllByText("Not extracted");
      expect(notExtracted.length).toBeGreaterThanOrEqual(3);
    });

    it("hides body when collapsed", () => {
      render(<Component invoice={makeInvoice()} expanded={false} onToggle={jest.fn()} />);
      expect(screen.getByText(header)).toBeInTheDocument();
      expect(screen.queryByText(visibleWhenExpanded)).not.toBeInTheDocument();
    });

    it("calls onToggle when header is clicked", () => {
      const onToggle = jest.fn();
      render(<Component invoice={makeInvoice()} expanded={true} onToggle={onToggle} />);
      fireEvent.click(screen.getByText(header));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  it("shows vendor section header when no parsed data exists", () => {
    const invoice = makeInvoice();
    invoice.parsed = undefined;
    render(<VendorDetailsSection invoice={invoice} expanded={true} onToggle={jest.fn()} />);
    expect(screen.getByText("Vendor Details")).toBeInTheDocument();
  });

  it("shows tenant GSTIN match badge when customer GSTIN matches tenant", () => {
    const invoice = makeInvoice({ customerGstin: "27AADCB2230M1Z3" });
    render(
      <CustomerDetailsSection
        invoice={invoice}
        expanded={true}
        onToggle={jest.fn()}
        tenantGstin="27AADCB2230M1Z3"
      />
    );
    expect(screen.getByText("Matches tenant GSTIN")).toBeInTheDocument();
  });
});
