const axiosPostMock = jest.fn();

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: (...args: unknown[]) => axiosPostMock(...args)
  }
}));

import {
  TallyExporter,
  buildTallyPurchaseVoucherPayload,
  buildTallyBatchImportXml,
  formatTallyDate,
  parseTallyImportResponse,
  resolveInvoiceTotalAmountMinor
} from "./tallyExporter.ts";

describe("buildTallyPurchaseVoucherPayload", () => {
  it("builds a purchase voucher import envelope using balanced ledger entries", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-1001",
      partyLedgerName: "ACME Vendor",
      amountMinor: 120000,
      currency: "USD",
      date: "20260219",
      narration: "Imported invoice"
    });

    expect(xml).toMatch(/<TALLYREQUEST>Import<\/TALLYREQUEST>/);
    expect(xml).toMatch(/<TYPE>Data<\/TYPE>/);
    expect(xml).toMatch(/<ID>Vouchers<\/ID>/);
    expect(xml).toMatch(/<VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Accounting Voucher View">/);
    expect(xml).toMatch(/<DATE>20260219<\/DATE>/);
    expect(xml).toMatch(/<LEDGERNAME>ACME Vendor<\/LEDGERNAME>/);
    expect(xml).toMatch(/<AMOUNT>-1200\.00<\/AMOUNT>/);
    expect(xml).toMatch(/<LEDGERNAME>Purchase<\/LEDGERNAME>/);
    expect(xml).toMatch(/<AMOUNT>1200\.00<\/AMOUNT>/);
  });

  it("uses default narration when narration is omitted", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-1002",
      partyLedgerName: "ACME Vendor",
      amountMinor: 5000,
      date: "20260220"
    });

    expect(xml).toContain("<NARRATION>Invoice import from BillForge</NARRATION>");
  });
});

describe("parseTallyImportResponse", () => {
  it("parses success response summary", () => {
    const xml = [
      "<ENVELOPE>",
      "  <BODY>",
      "    <DATA>",
      "      <RESPONSE>",
      "        <CREATED>1</CREATED>",
      "        <ALTERED>0</ALTERED>",
      "        <ERRORS>0</ERRORS>",
      "        <LASTVCHID>42</LASTVCHID>",
      "      </RESPONSE>",
      "    </DATA>",
      "  </BODY>",
      "</ENVELOPE>"
    ].join("\n");

    const parsed = parseTallyImportResponse(xml);
    expect(parsed.created).toBe(1);
    expect(parsed.errors).toBe(0);
    expect(parsed.lastVchId).toBe("42");
    expect(parsed.lineErrors).toEqual([]);
  });

  it("parses line errors from failed imports", () => {
    const xml = [
      "<ENVELOPE>",
      "  <HEADER><STATUS>0</STATUS></HEADER>",
      "  <BODY>",
      "    <DATA>",
      "      <IMPORTRESULT>",
      "        <CREATED>0</CREATED>",
      "        <ALTERED>0</ALTERED>",
      "        <ERRORS>1</ERRORS>",
      "        <LINEERROR>Ledger does not exist</LINEERROR>",
      "      </IMPORTRESULT>",
      "    </DATA>",
      "  </BODY>",
      "</ENVELOPE>"
    ].join("\n");

    const parsed = parseTallyImportResponse(xml);
    expect(parsed.status).toBe(0);
    expect(parsed.errors).toBe(1);
    expect(parsed.lineErrors).toEqual(["Ledger does not exist"]);
  });

  it("defaults missing numeric tags to zero and ignores invalid numbers", () => {
    const xml = [
      "<ENVELOPE>",
      "  <BODY>",
      "    <DATA>",
      "      <IMPORTRESULT>",
      "        <CREATED>abc</CREATED>",
      "      </IMPORTRESULT>",
      "    </DATA>",
      "  </BODY>",
      "</ENVELOPE>"
    ].join("\n");

    const parsed = parseTallyImportResponse(xml);
    expect(parsed.created).toBe(0);
    expect(parsed.errors).toBe(0);
  });
});

describe("formatTallyDate", () => {
  it("normalizes ISO dates into Tally format", () => {
    expect(formatTallyDate("2026-02-19")).toBe("20260219");
  });

  it("falls back to supplied Date when invoice date is invalid", () => {
    expect(formatTallyDate("not-a-date", new Date("2026-02-20T10:00:00.000Z"))).toBe("20260220");
  });

  it("accepts already formatted tally date", () => {
    expect(formatTallyDate("20260219")).toBe("20260219");
  });

  it("parses human-readable dates", () => {
    expect(formatTallyDate("February 20 2026")).toBe("20260220");
  });

  it("falls back to current date when no dates are provided", () => {
    expect(formatTallyDate()).toMatch(/^\d{8}$/);
  });
});

describe("resolveInvoiceTotalAmountMinor", () => {
  it("prefers parsed total when valid", () => {
    expect(resolveInvoiceTotalAmountMinor(12345, "USD", "Grand Total: 999.00")).toBe(12345);
  });

  it("falls back to OCR-derived total when parsed total is invalid", () => {
    const ocrText = [
      "Invoice Number: INV-9001",
      "Subtotal: 1,200.00",
      "Tax: 216.00",
      "Grand Total: 1,416.00"
    ].join("\n");

    expect(resolveInvoiceTotalAmountMinor(undefined, "USD", ocrText)).toBe(141600);
  });

  it("returns null when no valid amount can be resolved", () => {
    expect(resolveInvoiceTotalAmountMinor(undefined, "USD", "Random text with no amount")).toBeNull();
  });

  it("returns null when OCR text is empty", () => {
    expect(resolveInvoiceTotalAmountMinor(undefined, "USD", "")).toBeNull();
    expect(resolveInvoiceTotalAmountMinor(undefined, "USD", undefined)).toBeNull();
  });
});

describe("TallyExporter.exportInvoices", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
  });

  it("marks invoice as failed when total amount is invalid", async () => {
    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-1",
      parsed: {
        invoiceNumber: "INV-1",
        vendorName: "Vendor"
      },
      ocrText: "no amount here"
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-1",
        success: false,
        error: "Invalid invoice total amount for Tally export."
      }
    ]);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it("marks invoice as failed when total amount is invalid and invoice number is missing", async () => {
    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-1b",
      parsed: {
        vendorName: "Vendor"
      },
      ocrText: "no amount here"
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-1b",
        success: false,
        error: "Invalid invoice total amount for Tally export."
      }
    ]);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it("exports successfully and recovers amount from OCR when parsed amount is missing", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><LASTVCHID>77</LASTVCHID></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-2",
      sourceType: "email",
      sourceKey: "inbox",
      attachmentName: "invoice.pdf",
      parsed: {
        invoiceNumber: "INV-2",
        vendorName: "Vendor",
        currency: "USD"
      },
      ocrText: "Grand Total: 123.45"
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-2",
        success: true,
        externalReference: "77"
      }
    ]);
    expect(invoice.set).toHaveBeenCalledWith(
      "parsed",
      expect.objectContaining({
        totalAmountMinor: 12345
      })
    );
  });

  it("returns failed result when Tally reports line errors", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><HEADER><STATUS>0</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>1</ERRORS><LINEERROR>Ledger missing</LINEERROR></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-3",
      parsed: {
        invoiceNumber: "INV-3",
        vendorName: "Vendor",
        currency: "USD",
        totalAmountMinor: 5000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-3",
        success: false,
        error: "Ledger missing"
      }
    ]);
  });

  it("treats status=1 responses with non-zero errors as failed imports", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>1</ERRORS></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-3c",
      parsed: {
        invoiceNumber: "INV-3C",
        vendorName: "Vendor",
        currency: "USD",
        totalAmountMinor: 5000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-3c",
        success: false,
        error: "Import failed with ERRORS=1"
      }
    ]);
  });

  it("returns failed summary when import fails without line errors", async () => {
    axiosPostMock.mockResolvedValue({
      data: null
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-3b",
      parsed: {
        invoiceNumber: "INV-3B",
        vendorName: "Vendor",
        currency: "USD",
        totalAmountMinor: 5000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-3b",
        success: false,
        error: "Import failed with ERRORS=0"
      }
    ]);
  });

  it("maps fallback fields when parsed object is missing and preserves altered-success responses", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ALTERED>1</ALTERED><ERRORS>0</ERRORS></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = {
      _id: "inv-6",
      sourceType: "email",
      sourceKey: "inbox",
      attachmentName: "file.pdf",
      receivedAt: new Date("2026-02-19T00:00:00.000Z"),
      parsed: {
        vendorName: "Fallback Corp",
        invoiceNumber: "FB-001",
        totalAmountMinor: 1000
      },
      ocrText: "Grand Total: 10.00",
      set: jest.fn(),
      get: jest.fn(() => undefined)
    } as unknown as import("../models/Invoice.js").InvoiceDocument;

    const result = await exporter.exportInvoices([invoice]);

    expect(result).toEqual([
      {
        invoiceId: "inv-6",
        success: true,
        externalReference: "CREATED-0"
      }
    ]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<VOUCHERNUMBER>FB-001</VOUCHERNUMBER>");
    expect(payload).toContain("<PARTYLEDGERNAME>Fallback Corp</PARTYLEDGERNAME>");
    expect(payload).toContain("<AMOUNT>-10.00</AMOUNT>");
  });

  it("accepts status-only success responses when created and altered are zero", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-6b",
      parsed: {
        invoiceNumber: "INV-6B",
        vendorName: "Vendor",
        currency: "USD",
        totalAmountMinor: 1000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-6b",
        success: true,
        externalReference: "CREATED-0"
      }
    ]);
  });

  it("returns parsed tally error details when axios throws with response data", async () => {
    axiosPostMock.mockRejectedValue({
      message: "Request failed",
      response: {
        data: "<ENVELOPE><BODY><DATA><IMPORTRESULT><ERRORS>1</ERRORS><LINEERROR>Company mismatch</LINEERROR></IMPORTRESULT></DATA></BODY></ENVELOPE>"
      }
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-4",
      parsed: {
        invoiceNumber: "INV-4",
        vendorName: "Vendor",
        currency: "USD",
        totalAmountMinor: 9000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-4",
        success: false,
        error: "Company mismatch"
      }
    ]);
  });

  it("returns generic error when thrown value is not axios-like", async () => {
    axiosPostMock.mockRejectedValue(new Error("Boom"));

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-5",
      parsed: {
        invoiceNumber: "INV-5",
        vendorName: "Vendor",
        currency: "USD",
        totalAmountMinor: 9000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-5",
        success: false,
        error: "Boom"
      }
    ]);
  });

  it("returns parsed ERRORS count when axios response has no line errors", async () => {
    axiosPostMock.mockRejectedValue({
      message: "Request failed",
      response: {
        data: "<ENVELOPE><BODY><DATA><IMPORTRESULT><ERRORS>4</ERRORS></IMPORTRESULT></DATA></BODY></ENVELOPE>"
      }
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-7",
      parsed: {
        invoiceNumber: "INV-7",
        vendorName: "Vendor",
        currency: "USD",
        totalAmountMinor: 9000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-7",
        success: false,
        error: "Tally import failed with ERRORS=4"
      }
    ]);
  });

  it("rejects invoice when vendorName is Unknown Vendor", async () => {
    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-unknown-vendor",
      parsed: {
        invoiceNumber: "INV-UV1",
        vendorName: "Unknown Vendor",
        currency: "USD",
        totalAmountMinor: 5000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-unknown-vendor",
        success: false,
        error: "Vendor name is missing or invalid for Tally export."
      }
    ]);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it("rejects invoice when invoiceNumber matches a 24-char hex ObjectId pattern", async () => {
    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-objectid",
      parsed: {
        invoiceNumber: "507f1f77bcf86cd799439011",
        vendorName: "Legit Vendor",
        currency: "USD",
        totalAmountMinor: 5000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-objectid",
        success: false,
        error: "Invoice number is missing or invalid for Tally export."
      }
    ]);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it("returns unknown export failure for non-object thrown values", async () => {
    axiosPostMock.mockRejectedValue("boom-string");

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });
    const invoice = createInvoiceStub({
      _id: "inv-8",
      parsed: {
        invoiceNumber: "INV-8",
        vendorName: "Vendor",
        currency: "USD",
        totalAmountMinor: 9000
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      {
        invoiceId: "inv-8",
        success: false,
        error: "Unknown export failure"
      }
    ]);
  });
});

describe("buildTallyBatchImportXml", () => {
  it("wraps multiple vouchers in a single import envelope", () => {
    const xml = buildTallyBatchImportXml("Demo Company", [
      {
        companyName: "Demo Company",
        purchaseLedgerName: "Purchase",
        voucherNumber: "INV-1001",
        partyLedgerName: "Vendor A",
        amountMinor: 120000,
        currency: "USD",
        date: "20260219",
        narration: "Invoice 1"
      },
      {
        companyName: "Demo Company",
        purchaseLedgerName: "Purchase",
        voucherNumber: "INV-1002",
        partyLedgerName: "Vendor B",
        amountMinor: 50000,
        currency: "USD",
        date: "20260220",
        narration: "Invoice 2"
      }
    ]);

    expect(xml).toMatch(/<TALLYREQUEST>Import<\/TALLYREQUEST>/);
    expect(xml).toMatch(/<SVCURRENTCOMPANY>Demo Company<\/SVCURRENTCOMPANY>/);
    const voucherMatches = xml.match(/<VOUCHER /g);
    expect(voucherMatches).toHaveLength(2);
    expect(xml).toContain("<VOUCHERNUMBER>INV-1001</VOUCHERNUMBER>");
    expect(xml).toContain("<VOUCHERNUMBER>INV-1002</VOUCHERNUMBER>");
    expect(xml).toContain("<LEDGERNAME>Vendor A</LEDGERNAME>");
    expect(xml).toContain("<LEDGERNAME>Vendor B</LEDGERNAME>");
  });

  it("produces same voucher structure as single-voucher builder", () => {
    const input = {
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-1001",
      partyLedgerName: "ACME Vendor",
      amountMinor: 120000,
      currency: "USD",
      date: "20260219",
      narration: "Imported invoice"
    };

    const singleXml = buildTallyPurchaseVoucherPayload(input);
    const batchXml = buildTallyBatchImportXml("Demo Company", [input]);

    expect(singleXml).toContain("<VOUCHERNUMBER>INV-1001</VOUCHERNUMBER>");
    expect(batchXml).toContain("<VOUCHERNUMBER>INV-1001</VOUCHERNUMBER>");
    expect(singleXml).toContain("<AMOUNT>-1200.00</AMOUNT>");
    expect(batchXml).toContain("<AMOUNT>-1200.00</AMOUNT>");
    expect(singleXml).toContain("<AMOUNT>1200.00</AMOUNT>");
    expect(batchXml).toContain("<AMOUNT>1200.00</AMOUNT>");
  });
});

describe("TallyExporter.generateImportFile", () => {
  it("generates import file with valid invoices", () => {
    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });

    const invoices = [
      createInvoiceStub({
        _id: "file-1",
        parsed: {
          invoiceNumber: "INV-F1",
          vendorName: "Vendor A",
          currency: "USD",
          totalAmountMinor: 10000
        }
      }),
      createInvoiceStub({
        _id: "file-2",
        parsed: {
          invoiceNumber: "INV-F2",
          vendorName: "Vendor B",
          currency: "USD",
          totalAmountMinor: 20000
        }
      })
    ];

    const result = exporter.generateImportFile(invoices);
    expect(result.includedCount).toBe(2);
    expect(result.skippedItems).toEqual([]);
    expect(result.contentType).toBe("text/xml");
    expect(result.filename).toMatch(/^tally-import-.*\.xml$/);

    const xml = result.content.toString("utf-8");
    expect(xml).toContain("<VOUCHERNUMBER>INV-F1</VOUCHERNUMBER>");
    expect(xml).toContain("<VOUCHERNUMBER>INV-F2</VOUCHERNUMBER>");
  });

  it("skips invoices with invalid amounts and includes them in skippedItems", () => {
    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });

    const invoices = [
      createInvoiceStub({
        _id: "file-ok",
        parsed: {
          invoiceNumber: "INV-OK",
          vendorName: "Vendor",
          currency: "USD",
          totalAmountMinor: 5000
        }
      }),
      createInvoiceStub({
        _id: "file-bad",
        parsed: { invoiceNumber: "INV-BAD", vendorName: "Vendor" },
        ocrText: "no amount"
      })
    ];

    const result = exporter.generateImportFile(invoices);
    expect(result.includedCount).toBe(1);
    expect(result.skippedItems).toHaveLength(1);
    expect(result.skippedItems[0]).toEqual({
      invoiceId: "file-bad",
      success: false,
      error: "Invalid invoice total amount for Tally export."
    });
  });

  it("uses fallback values when parsed fields are missing", () => {
    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });

    const invoices = [
      createInvoiceStub({
        _id: "file-fallback",
        parsed: { totalAmountMinor: 5000 },
        ocrText: "some text"
      })
    ];

    const result = exporter.generateImportFile(invoices);
    expect(result.includedCount).toBe(1);

    const xml = result.content.toString("utf-8");
    expect(xml).toContain("<VOUCHERNUMBER>file-fallback</VOUCHERNUMBER>");
    expect(xml).toContain("<PARTYLEDGERNAME>Unknown Vendor</PARTYLEDGERNAME>");
  });

  it("returns empty content when all invoices are skipped", () => {
    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase"
    });

    const invoices = [
      createInvoiceStub({
        _id: "file-bad2",
        parsed: { vendorName: "Vendor" },
        ocrText: "nothing"
      })
    ];

    const result = exporter.generateImportFile(invoices);
    expect(result.includedCount).toBe(0);
    expect(result.content).toHaveLength(0);
    expect(result.skippedItems).toHaveLength(1);
  });
});

describe("GST voucher XML generation", () => {
  const gstLedgers = {
    cgstLedger: "Input CGST",
    sgstLedger: "Input SGST",
    igstLedger: "Input IGST",
    cessLedger: "Input Cess"
  };

  it("generates intra-state voucher with CGST and SGST ledger entries", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-GST-1",
      partyLedgerName: "Vendor India",
      amountMinor: 118000,
      currency: "INR",
      date: "20260301",
      narration: "GST intra-state purchase",
      gstin: "29ABCDE1234F1Z5",
      gst: {
        subtotalMinor: 100000,
        cgstMinor: 9000,
        sgstMinor: 9000
      },
      gstLedgers
    });

    expect(xml).toContain("<PARTYGSTIN>29ABCDE1234F1Z5</PARTYGSTIN>");
    expect(xml).toContain("<AMOUNT>-1180.00</AMOUNT>");
    // Purchase entry = subtotal
    expect(xml).toContain("<LEDGERNAME>Purchase</LEDGERNAME>");
    expect(xml).toContain("<AMOUNT>1000.00</AMOUNT>");
    // CGST entry
    expect(xml).toContain("<LEDGERNAME>Input CGST</LEDGERNAME>");
    expect(xml).toContain("<AMOUNT>90.00</AMOUNT>");
    // SGST entry
    expect(xml).toContain("<LEDGERNAME>Input SGST</LEDGERNAME>");
    expect(xml).toContain("<AMOUNT>90.00</AMOUNT>");
    // No IGST or Cess entries
    expect(xml).not.toContain("Input IGST");
    expect(xml).not.toContain("Input Cess");
  });

  it("generates inter-state voucher with IGST ledger entry", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-GST-2",
      partyLedgerName: "Vendor Interstate",
      amountMinor: 118000,
      currency: "INR",
      date: "20260302",
      gstin: "07FGHIJ5678K2Z3",
      gst: {
        subtotalMinor: 100000,
        igstMinor: 18000
      },
      gstLedgers
    });

    expect(xml).toContain("<PARTYGSTIN>07FGHIJ5678K2Z3</PARTYGSTIN>");
    expect(xml).toContain("<LEDGERNAME>Input IGST</LEDGERNAME>");
    expect(xml).toContain("<AMOUNT>180.00</AMOUNT>");
    expect(xml).not.toContain("Input CGST");
    expect(xml).not.toContain("Input SGST");
  });

  it("includes cess ledger entry when cess is present", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-GST-3",
      partyLedgerName: "Vendor Cess",
      amountMinor: 130000,
      currency: "INR",
      date: "20260303",
      gst: {
        subtotalMinor: 100000,
        cgstMinor: 9000,
        sgstMinor: 9000,
        cessMinor: 12000
      },
      gstLedgers
    });

    expect(xml).toContain("<LEDGERNAME>Input Cess</LEDGERNAME>");
    expect(xml).toContain("<AMOUNT>120.00</AMOUNT>");
  });

  it("omits GSTIN tag when gstin is not provided", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-GST-4",
      partyLedgerName: "Vendor No GSTIN",
      amountMinor: 118000,
      currency: "INR",
      date: "20260304",
      gst: {
        subtotalMinor: 100000,
        cgstMinor: 9000,
        sgstMinor: 9000
      },
      gstLedgers
    });

    expect(xml).not.toContain("<PARTYGSTIN>");
    expect(xml).toContain("<LEDGERNAME>Input CGST</LEDGERNAME>");
  });

  it("uses total amount as subtotal when subtotalMinor is missing", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-GST-6",
      partyLedgerName: "Vendor NoSubtotal",
      amountMinor: 118000,
      currency: "INR",
      date: "20260306",
      gst: {
        subtotalMinor: 0,
        cgstMinor: 9000,
        sgstMinor: 9000
      },
      gstLedgers
    });

    // subtotalMinor=0 is falsy but it's a valid value (0.00 purchase)
    expect(xml).toContain("<AMOUNT>0.00</AMOUNT>");
    expect(xml).toContain("<LEDGERNAME>Input CGST</LEDGERNAME>");
  });

  it("falls back to non-GST structure when gstLedgers is not configured", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-GST-5",
      partyLedgerName: "Vendor Fallback",
      amountMinor: 118000,
      currency: "INR",
      date: "20260305"
    });

    // Should have simple two-entry structure
    expect(xml).toContain("<AMOUNT>-1180.00</AMOUNT>");
    expect(xml).toContain("<AMOUNT>1180.00</AMOUNT>");
    expect(xml).not.toContain("Input CGST");
  });
});

describe("TallyExporter with GST config", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
  });

  it("generates GST voucher XML when invoice has GST data and exporter has gstLedgers", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><LASTVCHID>100</LASTVCHID></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase",
      gstLedgers: {
        cgstLedger: "Input CGST",
        sgstLedger: "Input SGST",
        igstLedger: "Input IGST",
        cessLedger: "Input Cess"
      }
    });

    const invoice = createInvoiceStub({
      _id: "gst-inv-1",
      parsed: {
        invoiceNumber: "GST-INV-1",
        vendorName: "GST Vendor",
        currency: "INR",
        totalAmountMinor: 118000,
        gst: {
          gstin: "29ABCDE1234F1Z5",
          subtotalMinor: 100000,
          cgstMinor: 9000,
          sgstMinor: 9000,
          totalTaxMinor: 18000
        }
      }
    });

    const result = await exporter.exportInvoices([invoice]);
    expect(result).toEqual([
      { invoiceId: "gst-inv-1", success: true, externalReference: "100" }
    ]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<PARTYGSTIN>29ABCDE1234F1Z5</PARTYGSTIN>");
    expect(payload).toContain("<LEDGERNAME>Input CGST</LEDGERNAME>");
    expect(payload).toContain("<LEDGERNAME>Input SGST</LEDGERNAME>");
    expect(payload).toContain("<AMOUNT>1000.00</AMOUNT>");
  });

  it("uses total amount as subtotal when GST subtotalMinor is missing", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><LASTVCHID>101</LASTVCHID></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase",
      gstLedgers: {
        cgstLedger: "Input CGST",
        sgstLedger: "Input SGST",
        igstLedger: "Input IGST",
        cessLedger: "Input Cess"
      }
    });

    const invoice = createInvoiceStub({
      _id: "gst-inv-nosub",
      parsed: {
        invoiceNumber: "GST-NOSUB",
        vendorName: "Vendor No Sub",
        currency: "INR",
        totalAmountMinor: 118000,
        gst: {
          cgstMinor: 9000,
          sgstMinor: 9000
        }
      }
    });

    await exporter.exportInvoices([invoice]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<AMOUNT>1000.00</AMOUNT>");
    expect(payload).toContain("<LEDGERNAME>Input CGST</LEDGERNAME>");
  });

  it("uses total amount as subtotal when GST subtotalMinor is missing and all tax amounts are zero", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><LASTVCHID>103</LASTVCHID></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase",
      gstLedgers: {
        cgstLedger: "Input CGST",
        sgstLedger: "Input SGST",
        igstLedger: "Input IGST",
        cessLedger: "Input Cess"
      }
    });

    const invoice = createInvoiceStub({
      _id: "gst-inv-notax",
      parsed: {
        invoiceNumber: "GST-NOTAX",
        vendorName: "Vendor No Tax",
        currency: "INR",
        totalAmountMinor: 100000,
        gst: {
          gstin: "29ABCDE1234F1Z5"
        }
      }
    });

    await exporter.exportInvoices([invoice]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<AMOUNT>1000.00</AMOUNT>");
  });

  it("falls back to total amount when derived subtotal is zero or negative", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><LASTVCHID>104</LASTVCHID></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase",
      gstLedgers: {
        cgstLedger: "Input CGST",
        sgstLedger: "Input SGST",
        igstLedger: "Input IGST",
        cessLedger: "Input Cess"
      }
    });

    const invoice = createInvoiceStub({
      _id: "gst-inv-negative-sub",
      parsed: {
        invoiceNumber: "GST-NEGSUB",
        vendorName: "Vendor NegSub",
        currency: "INR",
        totalAmountMinor: 10000,
        gst: {
          subtotalMinor: 5000,
          cgstMinor: 50000,
          sgstMinor: 50000
        }
      }
    });

    await exporter.exportInvoices([invoice]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<AMOUNT>-100.00</AMOUNT>");
    expect(payload).toContain("<AMOUNT>100.00</AMOUNT>");
  });

  it("recalculates subtotal when provided subtotal plus tax does not match total", async () => {
    axiosPostMock.mockResolvedValue({
      data: "<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><IMPORTRESULT><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><LASTVCHID>102</LASTVCHID></IMPORTRESULT></DATA></BODY></ENVELOPE>"
    });

    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase",
      gstLedgers: {
        cgstLedger: "Input CGST",
        sgstLedger: "Input SGST",
        igstLedger: "Input IGST",
        cessLedger: "Input Cess"
      }
    });

    const invoice = createInvoiceStub({
      _id: "gst-inv-mismatch",
      parsed: {
        invoiceNumber: "GST-MISMATCH",
        vendorName: "Vendor Mismatch",
        currency: "INR",
        totalAmountMinor: 118000,
        gst: {
          subtotalMinor: 80000,
          cgstMinor: 9000,
          sgstMinor: 9000
        }
      }
    });

    await exporter.exportInvoices([invoice]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<AMOUNT>1000.00</AMOUNT>");
    expect(payload).toContain("<LEDGERNAME>Input CGST</LEDGERNAME>");
    expect(payload).toContain("<LEDGERNAME>Input SGST</LEDGERNAME>");
  });

  it("generates GST import file with multiple invoices", () => {
    const exporter = new TallyExporter({
      endpoint: "http://example.test/tally",
      companyName: "Demo",
      purchaseLedgerName: "Purchase",
      gstLedgers: {
        cgstLedger: "Input CGST",
        sgstLedger: "Input SGST",
        igstLedger: "Input IGST",
        cessLedger: "Input Cess"
      }
    });

    const invoices = [
      createInvoiceStub({
        _id: "gst-file-1",
        parsed: {
          invoiceNumber: "GST-F1",
          vendorName: "Vendor A",
          currency: "INR",
          totalAmountMinor: 118000,
          gst: {
            subtotalMinor: 100000,
            cgstMinor: 9000,
            sgstMinor: 9000
          }
        }
      }),
      createInvoiceStub({
        _id: "gst-file-2",
        parsed: {
          invoiceNumber: "GST-F2",
          vendorName: "Vendor B",
          currency: "INR",
          totalAmountMinor: 236000,
          gst: {
            subtotalMinor: 200000,
            igstMinor: 36000
          }
        }
      })
    ];

    const result = exporter.generateImportFile(invoices);
    expect(result.includedCount).toBe(2);

    const xml = result.content.toString("utf-8");
    expect(xml).toContain("<LEDGERNAME>Input CGST</LEDGERNAME>");
    expect(xml).toContain("<LEDGERNAME>Input IGST</LEDGERNAME>");
    expect(xml).toContain("<VOUCHERNUMBER>GST-F1</VOUCHERNUMBER>");
    expect(xml).toContain("<VOUCHERNUMBER>GST-F2</VOUCHERNUMBER>");
  });
});

interface InvoiceStubInput {
  _id: string;
  sourceType?: string;
  sourceKey?: string;
  attachmentName?: string;
  receivedAt?: Date;
  parsed?: Record<string, unknown>;
  ocrText?: string;
  processingIssues?: string[];
}

function createInvoiceStub(input: InvoiceStubInput) {
  const state = {
    parsed: input.parsed ?? {},
    processingIssues: input.processingIssues ?? []
  };

  return {
    _id: input._id,
    sourceType: input.sourceType ?? "email",
    sourceKey: input.sourceKey ?? "inbox",
    attachmentName: input.attachmentName ?? "file.pdf",
    receivedAt: input.receivedAt ?? new Date("2026-02-19T00:00:00.000Z"),
    parsed: state.parsed,
    ocrText: input.ocrText,
    set: jest.fn((key: string, value: unknown) => {
      if (key === "parsed") {
        state.parsed = value as Record<string, unknown>;
      }

      if (key === "processingIssues") {
        state.processingIssues = value as string[];
      }
    }),
    get: jest.fn((key: string) => {
      if (key === "processingIssues") {
        return state.processingIssues;
      }

      return undefined;
    })
  } as unknown as import("../models/Invoice.js").InvoiceDocument;
}
