import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSourceViewer } from "./InvoiceSourceViewer";
import type { Invoice } from "../types";

const baseInvoice: Invoice = {
  _id: "inv-1",
  tenantId: "tenant-a",
  workloadTier: "standard",
  sourceType: "folder",
  sourceKey: "local-folder",
  sourceDocumentId: "invoice-1.png",
  attachmentName: "invoice-1.png",
  mimeType: "image/png",
  receivedAt: "2026-02-24T00:00:00.000Z",
  confidenceScore: 92,
  confidenceTone: "green",
  autoSelectForApproval: true,
  riskFlags: [],
  riskMessages: [],
  status: "PARSED",
  processingIssues: [],
  createdAt: "2026-02-24T00:00:00.000Z",
  updatedAt: "2026-02-24T00:00:00.000Z",
  parsed: {
    vendorName: "Acme Corp",
    invoiceNumber: "INV-42",
    totalAmountMinor: 125000,
    currency: "USD"
  },
  metadata: {
    fieldProvenance: JSON.stringify({
      invoiceNumber: {
        source: "ocr",
        page: 1,
        bbox: [220, 90, 420, 130],
        bboxNormalized: [0.2, 0.1, 0.4, 0.2]
      }
    })
  }
};

describe("InvoiceSourceViewer", () => {
  it("renders preview fallback with client-side bounding box when overlay URL is missing", () => {
    const html = renderToStaticMarkup(
      <InvoiceSourceViewer
        invoice={baseInvoice}
        overlayUrlByField={{}}
        resolvePreviewUrl={() => "http://localhost:4100/api/invoices/inv-1/preview?page=1"}
      />
    );

    expect(html).toContain("source-preview-box");
    expect(html).toContain("/api/invoices/inv-1/preview?page=1");
  });

  it("renders nothing when neither overlay nor preview URL can be resolved", () => {
    const html = renderToStaticMarkup(<InvoiceSourceViewer invoice={baseInvoice} overlayUrlByField={{}} />);
    expect(html).toContain("Source preview is unavailable for this invoice.");
  });

  it("allows preview fallback for non-folder ingestion sources", () => {
    const emailInvoice: Invoice = {
      ...baseInvoice,
      sourceType: "email"
    };

    const html = renderToStaticMarkup(
      <InvoiceSourceViewer
        invoice={emailInvoice}
        overlayUrlByField={{}}
        resolvePreviewUrl={() => "http://localhost:4100/api/invoices/inv-1/preview?page=1"}
      />
    );

    expect(html).toContain("source-preview-box");
    expect(html).toContain("/api/invoices/inv-1/preview?page=1");
  });

  it("renders source preview even when no fields were extracted", () => {
    const invoiceWithoutFields: Invoice = {
      ...baseInvoice,
      parsed: {},
      metadata: {}
    };

    const html = renderToStaticMarkup(
      <InvoiceSourceViewer
        invoice={invoiceWithoutFields}
        overlayUrlByField={{}}
        resolvePreviewUrl={() => "http://localhost:4100/api/invoices/inv-1/preview?page=1"}
      />
    );

    expect(html).toContain("Source Preview");
    expect(html).toContain("No extracted value highlights are available yet.");
    expect(html).toContain("/api/invoices/inv-1/preview?page=1");
  });
});
