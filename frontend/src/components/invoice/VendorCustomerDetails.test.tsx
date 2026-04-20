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

describe("VendorDetailsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders vendor fields when expanded", () => {
    render(<VendorDetailsSection invoice={makeInvoice()} expanded={true} onToggle={jest.fn()} />);
    expect(screen.getByText("Vendor Details")).toBeInTheDocument();
    expect(screen.getByText("AADCB2230M")).toBeInTheDocument();
    expect(screen.getByText("27AADCB2230M1Z3")).toBeInTheDocument();
    expect(screen.getByText((_content, element) =>
      element?.tagName === "SPAN" && element?.textContent === "123 Main St\nMumbai, MH 400001"
    )).toBeInTheDocument();
  });

  it("shows Not extracted for missing vendor fields", () => {
    const invoice = makeInvoice({
      vendorName: undefined,
      vendorAddress: undefined,
      vendorGstin: undefined,
      vendorPan: undefined,
    });
    render(<VendorDetailsSection invoice={invoice} expanded={true} onToggle={jest.fn()} />);
    const notExtracted = screen.getAllByText("Not extracted");
    expect(notExtracted.length).toBeGreaterThanOrEqual(3);
  });

  it("hides body when collapsed", () => {
    render(<VendorDetailsSection invoice={makeInvoice()} expanded={false} onToggle={jest.fn()} />);
    expect(screen.getByText("Vendor Details")).toBeInTheDocument();
    expect(screen.queryByText("AADCB2230M")).not.toBeInTheDocument();
  });

  it("calls onToggle when header is clicked", () => {
    const onToggle = jest.fn();
    render(<VendorDetailsSection invoice={makeInvoice()} expanded={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByText("Vendor Details"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows section header when no parsed data exists", () => {
    const invoice = makeInvoice();
    invoice.parsed = undefined;
    render(<VendorDetailsSection invoice={invoice} expanded={true} onToggle={jest.fn()} />);
    expect(screen.getByText("Vendor Details")).toBeInTheDocument();
  });

  it("shows vendor name reference note when vendor name exists", () => {
    render(<VendorDetailsSection invoice={makeInvoice()} expanded={true} onToggle={jest.fn()} />);
    expect(screen.getByText("Shown in key fields above")).toBeInTheDocument();
  });
});

describe("CustomerDetailsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders customer fields when expanded", () => {
    render(<CustomerDetailsSection invoice={makeInvoice()} expanded={true} onToggle={jest.fn()} />);
    expect(screen.getByText("Customer Details")).toBeInTheDocument();
    expect(screen.getByText("BillForge Inc")).toBeInTheDocument();
    expect(screen.getByText("07BBBBB1234B1Z5")).toBeInTheDocument();
    expect(screen.getByText((_content, element) =>
      element?.tagName === "SPAN" && element?.textContent === "456 Oak Ave\nDelhi, DL 110001"
    )).toBeInTheDocument();
  });

  it("shows Not extracted for missing customer fields", () => {
    const invoice = makeInvoice({
      customerName: undefined,
      customerAddress: undefined,
      customerGstin: undefined,
    });
    render(<CustomerDetailsSection invoice={invoice} expanded={true} onToggle={jest.fn()} />);
    const notExtracted = screen.getAllByText("Not extracted");
    expect(notExtracted.length).toBeGreaterThanOrEqual(3);
  });

  it("hides body when collapsed", () => {
    render(<CustomerDetailsSection invoice={makeInvoice()} expanded={false} onToggle={jest.fn()} />);
    expect(screen.getByText("Customer Details")).toBeInTheDocument();
    expect(screen.queryByText("BillForge Inc")).not.toBeInTheDocument();
  });

  it("calls onToggle when header is clicked", () => {
    const onToggle = jest.fn();
    render(<CustomerDetailsSection invoice={makeInvoice()} expanded={true} onToggle={onToggle} />);
    fireEvent.click(screen.getByText("Customer Details"));
    expect(onToggle).toHaveBeenCalledTimes(1);
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

  it("does not show tenant match badge when GSTINs differ", () => {
    render(
      <CustomerDetailsSection
        invoice={makeInvoice()}
        expanded={true}
        onToggle={jest.fn()}
        tenantGstin="99ZZZZZ9999Z1Z9"
      />
    );
    expect(screen.queryByText("Matches tenant GSTIN")).not.toBeInTheDocument();
  });
});
