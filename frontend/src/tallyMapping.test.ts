import { formatTallyDateForUi, getInvoiceTallyMappings } from "./tallyMapping.ts";
import type { Invoice } from "./types.ts";

const baseInvoice: Invoice = {
  _id: "invoice-1",
  sourceType: "email",
  sourceKey: "inbox",
  sourceDocumentId: "10",
  attachmentName: "invoice.pdf",
  mimeType: "application/pdf",
  receivedAt: "2026-02-19T00:00:00.000Z",
  confidenceScore: 95,
  confidenceTone: "green",
  autoSelectForApproval: true,
  riskFlags: [],
  riskMessages: [],
  status: "APPROVED",
  processingIssues: [],
  createdAt: "2026-02-19T00:00:00.000Z",
  updatedAt: "2026-02-19T00:00:00.000Z"
};

describe("tally mapping helpers", () => {
  it("formats tally date in YYYYMMDD", () => {
    expect(formatTallyDateForUi("2026-02-01", "2026-02-19T00:00:00.000Z")).toBe("20260201");
    expect(formatTallyDateForUi("20260205", "2026-02-19T00:00:00.000Z")).toBe("20260205");
  });

  it("parses human-readable dates for tally display", () => {
    expect(formatTallyDateForUi("February 3 2026", "2026-02-19T00:00:00.000Z")).toBe("20260203");
  });

  it("falls back date mapping to receivedAt when parsed date is invalid", () => {
    expect(formatTallyDateForUi("not-a-date", "2026-02-19T10:00:00.000Z")).toBe("20260219");
  });

  it("falls back date mapping to current date when fallback is also invalid", () => {
    expect(formatTallyDateForUi(undefined, "still-not-a-date")).toMatch(/^\d{8}$/);
  });

  it("uses current date when both parsed and fallback dates are absent", () => {
    expect(formatTallyDateForUi(undefined, undefined)).toMatch(/^\d{8}$/);
  });

  it("maps detected values to expected tally fields", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      parsed: {
        invoiceNumber: "INV-1001",
        vendorName: "Acme Corp",
        invoiceDate: "2026-02-15",
        totalAmountMinor: 123456,
        currency: "USD"
      }
    };

    const mappings = getInvoiceTallyMappings(invoice);

    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Invoice Number",
          tallyField: "VOUCHER.VOUCHERNUMBER",
          mappedValue: "INV-1001"
        }),
        expect.objectContaining({
          label: "Vendor Name",
          tallyField: "VOUCHER.PARTYLEDGERNAME, LEDGERENTRIES[0].LEDGERNAME",
          mappedValue: "Acme Corp"
        }),
        expect.objectContaining({
          label: "Total Amount",
          mappedValue: "-1234.56 / 1234.56"
        })
      ])
    );
  });

  it("maps fallback values when parsed fields are missing", () => {
    const mappings = getInvoiceTallyMappings(baseInvoice);

    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Invoice Number",
          detectedValue: "-",
          mappedValue: "invoice-1"
        }),
        expect.objectContaining({
          label: "Vendor Name",
          detectedValue: "-",
          mappedValue: "Unknown Vendor"
        }),
        expect.objectContaining({
          label: "Total Amount",
          detectedValue: "-",
          mappedValue: "-0.00 / 0.00"
        }),
        expect.objectContaining({
          label: "Narration",
          mappedValue: "Source=email:inbox | Attachment=invoice.pdf | InternalId=invoice-1"
        })
      ])
    );
  });
});
