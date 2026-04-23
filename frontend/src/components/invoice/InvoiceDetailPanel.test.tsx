/**
 * @jest-environment jsdom
 */
jest.mock("@/components/invoice/ConfidenceBadge", () => ({ ConfidenceBadge: () => null }));
jest.mock("@/components/invoice/ExtractedFieldsTable", () => ({ ExtractedFieldsTable: () => null }));
jest.mock("@/components/invoice/InvoiceSourceViewer", () => ({ InvoiceSourceViewer: () => null }));
jest.mock("@/components/invoice/LineItemsTable", () => ({ LineItemsTable: () => null }));
jest.mock("@/components/invoice/VendorDetailsSection", () => ({ VendorDetailsSection: () => null }));
jest.mock("@/components/invoice/CustomerDetailsSection", () => ({ CustomerDetailsSection: () => null }));
jest.mock("@/components/compliance/CompliancePanel", () => ({ CompliancePanel: () => null }));
jest.mock("@/components/compliance/RiskSignalList", () => ({ RiskSignalList: () => null }));
jest.mock("@/components/common/CollapsibleSectionHeader", () => ({ CollapsibleSectionHeader: () => null }));

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { InvoiceDetailPanel } from "@/components/invoice/InvoiceDetailPanel";
import type { Invoice, InvoiceActions } from "@/types";

function makeInvoice(actions: InvoiceActions | undefined): Invoice {
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
    status: "AWAITING_APPROVAL",
    processingIssues: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    actions
  } as Invoice;
}

function renderPanel(invoice: Invoice) {
  return render(
    <InvoiceDetailPanel
      invoice={invoice}
      loading={false}
      tenantGlCodes={[]}
      tenantTdsRates={[]}
      activeCropUrlByField={{}}
      resolvePreviewUrl={() => ""}
      activeSourcePreviewExpanded={false}
      setActiveSourcePreviewExpanded={() => {}}
      activeExtractedFieldsExpanded={false}
      setActiveExtractedFieldsExpanded={() => {}}
      activeLineItemsExpanded={false}
      setActiveLineItemsExpanded={() => {}}
      vendorDetailsExpanded={false}
      setVendorDetailsExpanded={() => {}}
      customerDetailsExpanded={false}
      setCustomerDetailsExpanded={() => {}}
      onWorkflowApproveSingle={() => {}}
      onWorkflowRejectSingle={() => {}}
      onSaveField={async () => {}}
      refreshActiveInvoiceDetail={async () => {}}
      onClose={() => {}}
      extractedRows={[]}
      onOverrideGlCode={async () => {}}
      onOverrideTdsSection={async () => {}}
      onDismissRiskSignal={async () => {}}
    />
  );
}

const DENY_ALL: InvoiceActions = {
  canApprove: false,
  canReject: false,
  canEditFields: false,
  canDismissRiskSignals: false,
  canOverrideGlCode: false,
  canOverrideTds: false
};

describe("InvoiceDetailPanel workflow actions", () => {
  it("renders approve and reject buttons when invoice.actions grants both", () => {
    renderPanel(makeInvoice({ ...DENY_ALL, canApprove: true, canReject: true }));
    expect(screen.getByRole("button", { name: /Approve Current Step/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject Current Step/i })).toBeInTheDocument();
  });

  it("hides both buttons when invoice.actions is undefined (legacy/unknown)", () => {
    renderPanel(makeInvoice(undefined));
    expect(screen.queryByRole("button", { name: /Approve Current Step/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reject Current Step/i })).not.toBeInTheDocument();
  });

  it("hides both buttons when invoice.actions denies both", () => {
    renderPanel(makeInvoice(DENY_ALL));
    expect(screen.queryByRole("button", { name: /Approve Current Step/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reject Current Step/i })).not.toBeInTheDocument();
  });
});
