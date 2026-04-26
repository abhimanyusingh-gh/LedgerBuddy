import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSourceViewer } from "@/components/invoice/InvoiceSourceViewer";
import type { Invoice } from "@/types";

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
  it("renders preview with client-side DOM bounding box", () => {
    const html = renderToStaticMarkup(
      <InvoiceSourceViewer
        invoice={baseInvoice}
        resolvePreviewUrl={() => "http://localhost:4100/api/tenants/tenant-1/clientOrgs/org-1/invoices/inv-1/preview?page=1"}
      />
    );

    expect(html).toContain("source-preview-box");
    expect(html).toContain("/api/tenants/tenant-1/clientOrgs/org-1/invoices/inv-1/preview?page=1");
  });

  it("bbox uses percentage positioning independent of zoom transform", () => {
    const html = renderToStaticMarkup(
      <InvoiceSourceViewer
        invoice={baseInvoice}
        resolvePreviewUrl={() => "http://localhost:4100/api/tenants/tenant-1/clientOrgs/org-1/invoices/inv-1/preview?page=1"}
      />
    );

    expect(html).toContain("source-preview-box");
    expect(html).toContain("left:20%");
    expect(html).toContain("top:10%");
    expect(html).toContain("width:20%");
    expect(html).toContain("height:10%");
  });

  it("renders float-percent DOM box regardless of any legacy overlay fields on input", () => {
    const legacyInvoice = {
      ...baseInvoice,
      extraction: {
        fieldProvenance: {
          invoiceNumber: {
            source: "ocr",
            page: 1,
            bboxNormalized: [0.2, 0.1, 0.4, 0.2]
          }
        },
        // Legacy field that used to drive server-baked overlay PNGs; should be ignored.
        fieldOverlayPaths: { invoiceNumber: "legacy/path.png" }
      } as unknown as Invoice["extraction"]
    } satisfies Invoice;

    const html = renderToStaticMarkup(
      <InvoiceSourceViewer
        invoice={legacyInvoice}
        resolvePreviewUrl={() => "http://localhost:4100/api/tenants/tenant-1/clientOrgs/org-1/invoices/inv-1/preview?page=1"}
      />
    );

    expect(html).toContain("source-preview-box");
    expect(html).toContain("left:20%");
    expect(html).toContain("top:10%");
    expect(html).toContain("width:20%");
    expect(html).toContain("height:10%");
    expect(html).not.toContain("legacy/path.png");
  });
});
