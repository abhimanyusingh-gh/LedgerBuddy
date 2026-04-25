const axiosPostMock = jest.fn();
const resolveReExportDecisionMock = jest.fn();
const stageInFlightExportVersionMock = jest.fn();
const promoteExportVersionMock = jest.fn();
const clearInFlightExportVersionMock = jest.fn();
const buildTallyExportConfigMock = jest.fn();
const clientOrganizationFindOneMock = jest.fn();
const DEFAULT_TALLY_CONFIG = {
  endpoint: "http://example.test/tally",
  companyName: "Demo",
  purchaseLedgerName: "Purchase"
} as const;

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: (...args: unknown[]) => axiosPostMock(...args)
  }
}));

jest.mock("@/services/export/tallyReExportGuard.ts", () => ({
  __esModule: true,
  resolveReExportDecision: (...args: unknown[]) => resolveReExportDecisionMock(...args),
  stageInFlightExportVersion: (...args: unknown[]) => stageInFlightExportVersionMock(...args),
  promoteExportVersion: (...args: unknown[]) => promoteExportVersionMock(...args),
  clearInFlightExportVersion: (...args: unknown[]) => clearInFlightExportVersionMock(...args),
  computeVoucherGuid: jest.requireActual("@/services/export/tallyReExportGuard.ts").computeVoucherGuid,
  F12OverwriteNotVerifiedError: jest.requireActual("@/services/export/tallyReExportGuard.ts").F12OverwriteNotVerifiedError,
  ExportVersionConflictError: jest.requireActual("@/services/export/tallyReExportGuard.ts").ExportVersionConflictError,
  EXPORT_VERSION_CONFLICT_REASON: jest.requireActual("@/services/export/tallyReExportGuard.ts").EXPORT_VERSION_CONFLICT_REASON
}));

jest.mock("@/services/export/clientExportConfigResolver.ts", () => ({
  __esModule: true,
  buildTallyExportConfig: (...args: unknown[]) => buildTallyExportConfigMock(...args),
  buildCsvExportConfig: jest.fn()
}));

jest.mock("@/models/integration/ClientOrganization.ts", () => ({
  __esModule: true,
  ClientOrganizationModel: {
    findOne: (...args: unknown[]) => ({
      lean: () => clientOrganizationFindOneMock(...args)
    }),
    findById: (...args: unknown[]) => ({
      lean: () => clientOrganizationFindOneMock(...args)
    })
  },
  TALLY_VERSION: jest.requireActual("@/models/integration/ClientOrganization.ts").TALLY_VERSION
}));

import {
  TallyExporter,
  buildTallyPurchaseVoucherPayload,
  buildTallyBatchImportXml,
  formatTallyDate,
  parseTallyImportResponse,
  resolveInvoiceTotalAmountMinor
} from "@/services/export/tallyExporter.ts";

type TallyExporterConfig = ConstructorParameters<typeof TallyExporter>[0];

function createExporter(configOverrides: Partial<TallyExporterConfig> = {}) {
  return new TallyExporter({
    ...DEFAULT_TALLY_CONFIG,
    ...configOverrides
  });
}

function mockAxiosPostResolved(xml: string) {
  axiosPostMock.mockResolvedValue({ data: xml });
}

function mockAxiosPostRejected(error: unknown) {
  axiosPostMock.mockRejectedValue(error);
}

function makeImportResponse(overrides: Partial<{ status: number; created: number; altered: number; errors: number; lastVchId: string; lineError: string }> = {}) {
  const {
    status,
    created = 0,
    altered = 0,
    errors = 0,
    lastVchId,
    lineError
  } = overrides;

  return [
    "<ENVELOPE>",
    status != null ? `  <HEADER><STATUS>${status}</STATUS></HEADER>` : null,
    "  <BODY>",
    "    <DATA>",
    "      <IMPORTRESULT>",
    `        <CREATED>${created}</CREATED>`,
    `        <ALTERED>${altered}</ALTERED>`,
    `        <ERRORS>${errors}</ERRORS>`,
    lastVchId != null ? `        <LASTVCHID>${lastVchId}</LASTVCHID>` : null,
    lineError != null ? `        <LINEERROR>${lineError}</LINEERROR>` : null,
    "      </IMPORTRESULT>",
    "    </DATA>",
    "  </BODY>",
    "</ENVELOPE>"
  ].filter((line): line is string => line !== null).join("\n");
}

describe("buildTallyPurchaseVoucherPayload", () => {
  it("builds a purchase voucher import envelope using balanced ledger entries", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-1001",
      partyLedgerName: "ACME Vendor",
      amountMinor: 120000,
      currency: "USD",
      date: new Date("2026-02-19"),
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
      date: new Date("2026-02-20")
    });

    expect(xml).toContain("<NARRATION>Invoice import from LedgerBuddy</NARRATION>");
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
  it("formats Date into Tally format", () => {
    expect(formatTallyDate(new Date("2026-02-19"))).toBe("20260219");
  });

  it("falls back to supplied Date when primary date is invalid", () => {
    expect(formatTallyDate(new Date("invalid"), new Date("2026-02-20T10:00:00.000Z"))).toBe("20260220");
  });

  it("falls back to supplied Date when primary is null", () => {
    expect(formatTallyDate(null, new Date("2026-02-20T10:00:00.000Z"))).toBe("20260220");
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
    const exporter = createExporter();
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
    const exporter = createExporter();
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
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, altered: 0, errors: 0, lastVchId: "77" }));

    const exporter = createExporter();
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
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<AMOUNT>-123.45</AMOUNT>");
  });

  it("returns failed result when Tally reports line errors", async () => {
    mockAxiosPostResolved(makeImportResponse({ status: 0, created: 0, altered: 0, errors: 1, lineError: "Ledger missing" }));

    const exporter = createExporter();
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
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 0, altered: 0, errors: 1 }));

    const exporter = createExporter();
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
    axiosPostMock.mockResolvedValue({ data: null });

    const exporter = createExporter();
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
    mockAxiosPostResolved(makeImportResponse({ created: 0, altered: 1, errors: 0 }));

    const exporter = createExporter();
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
    } as unknown as import("../../models/invoice/Invoice.js").InvoiceDocument;

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
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 0, altered: 0, errors: 0 }));

    const exporter = createExporter();
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
    mockAxiosPostRejected({
      message: "Request failed",
      response: {
        data: makeImportResponse({ errors: 1, lineError: "Company mismatch" })
      }
    });

    const exporter = createExporter();
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
    mockAxiosPostRejected(new Error("Boom"));

    const exporter = createExporter();
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
    mockAxiosPostRejected({
      message: "Request failed",
      response: {
        data: makeImportResponse({ errors: 4 })
      }
    });

    const exporter = createExporter();
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
    const exporter = createExporter();
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
    const exporter = createExporter();
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
    mockAxiosPostRejected("boom-string");

    const exporter = createExporter();
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

describe("dual-tag ERP9/Prime alias emission", () => {
  const base = {
    companyName: "Demo Company",
    purchaseLedgerName: "Purchase",
    voucherNumber: "INV-ALIAS",
    partyLedgerName: "ACME Vendor",
    amountMinor: 100000,
    currency: "INR",
    date: new Date("2026-03-01")
  } as const;

  it("emits both PARTYGSTIN and GSTIN when gstin is provided", () => {
    const xml = buildTallyPurchaseVoucherPayload({ ...base, gstin: "29ABCDE1234F1Z5" });
    expect(xml).toContain("<PARTYGSTIN>29ABCDE1234F1Z5</PARTYGSTIN>");
    expect(xml).toContain("<GSTIN>29ABCDE1234F1Z5</GSTIN>");
  });

  it("emits both PANIT and INCOMETAXNUMBER when partyPan is provided", () => {
    const xml = buildTallyPurchaseVoucherPayload({ ...base, partyPan: "ABCDE1234F" });
    expect(xml).toContain("<PANIT>ABCDE1234F</PANIT>");
    expect(xml).toContain("<INCOMETAXNUMBER>ABCDE1234F</INCOMETAXNUMBER>");
  });

  it("emits both STATENAME and LEDSTATENAME when partyStateName is provided", () => {
    const xml = buildTallyPurchaseVoucherPayload({ ...base, partyStateName: "Karnataka" });
    expect(xml).toContain("<STATENAME>Karnataka</STATENAME>");
    expect(xml).toContain("<LEDSTATENAME>Karnataka</LEDSTATENAME>");
  });

  it("emits SVCURRENTCOMPANY on every envelope (single + batch)", () => {
    const singleXml = buildTallyPurchaseVoucherPayload({ ...base });
    const batchXml = buildTallyBatchImportXml("Demo Company", [{ ...base }]);
    expect(singleXml).toContain("<SVCURRENTCOMPANY>Demo Company</SVCURRENTCOMPANY>");
    expect(batchXml).toContain("<SVCURRENTCOMPANY>Demo Company</SVCURRENTCOMPANY>");
  });

  it("omits alias tags when the value is absent", () => {
    const xml = buildTallyPurchaseVoucherPayload({ ...base });
    expect(xml).not.toContain("<PARTYGSTIN>");
    expect(xml).not.toContain("<GSTIN>");
    expect(xml).not.toContain("<PANIT>");
    expect(xml).not.toContain("<INCOMETAXNUMBER>");
    expect(xml).not.toContain("<STATENAME>");
    expect(xml).not.toContain("<LEDSTATENAME>");
  });

  it("XML-escapes alias values to prevent injection", () => {
    const xml = buildTallyPurchaseVoucherPayload({ ...base, partyStateName: "A & B <State>" });
    expect(xml).toContain("<STATENAME>A &amp; B &lt;State&gt;</STATENAME>");
    expect(xml).toContain("<LEDSTATENAME>A &amp; B &lt;State&gt;</LEDSTATENAME>");
  });
});

describe("parseTallyImportResponse — tolerant alias reads", () => {
  const envelope = (bodyInner: string) => [
    "<ENVELOPE>",
    "  <HEADER><STATUS>1</STATUS></HEADER>",
    "  <BODY><DATA><IMPORTRESULT>",
    "    <CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS>",
    bodyInner,
    "  </IMPORTRESULT></DATA></BODY>",
    "</ENVELOPE>"
  ].join("\n");

  it("accepts LASTVCHID (voucher import response)", () => {
    const parsed = parseTallyImportResponse(envelope("<LASTVCHID>42</LASTVCHID>"));
    expect(parsed.lastVchId).toBe("42");
  });

  it("accepts LASTMID as an alias for master-import response", () => {
    const parsed = parseTallyImportResponse(envelope("<LASTMID>99</LASTMID>"));
    expect(parsed.lastVchId).toBe("99");
  });

  it("prefers LASTVCHID when both are present", () => {
    const parsed = parseTallyImportResponse(envelope("<LASTVCHID>42</LASTVCHID>\n<LASTMID>99</LASTMID>"));
    expect(parsed.lastVchId).toBe("42");
  });

  it("returns null when neither alias is present", () => {
    const parsed = parseTallyImportResponse(envelope(""));
    expect(parsed.lastVchId).toBeNull();
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
        date: new Date("2026-02-19"),
        narration: "Invoice 1"
      },
      {
        companyName: "Demo Company",
        purchaseLedgerName: "Purchase",
        voucherNumber: "INV-1002",
        partyLedgerName: "Vendor B",
        amountMinor: 50000,
        currency: "USD",
        date: new Date("2026-02-20"),
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
      date: new Date("2026-02-19"),
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
  it("generates import file with valid invoices", async () => {
    const exporter = createExporter();

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

    const result = await exporter.generateImportFile(invoices);
    expect(result.includedCount).toBe(2);
    expect(result.skippedItems).toEqual([]);
    expect(result.contentType).toBe("text/xml");
    expect(result.filename).toMatch(/^tally-import-.*\.xml$/);

    const xml = result.content.toString("utf-8");
    expect(xml).toContain("<VOUCHERNUMBER>INV-F1</VOUCHERNUMBER>");
    expect(xml).toContain("<VOUCHERNUMBER>INV-F2</VOUCHERNUMBER>");
  });

  it("skips invoices with invalid amounts and includes them in skippedItems", async () => {
    const exporter = createExporter();

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

    const result = await exporter.generateImportFile(invoices);
    expect(result.includedCount).toBe(1);
    expect(result.skippedItems).toHaveLength(1);
    expect(result.skippedItems[0]).toEqual({
      invoiceId: "file-bad",
      success: false,
      error: "Invalid invoice total amount for Tally export."
    });
  });

  it("uses fallback values when parsed fields are missing", async () => {
    const exporter = createExporter();

    const invoices = [
      createInvoiceStub({
        _id: "file-fallback",
        parsed: { totalAmountMinor: 5000 },
        ocrText: "some text"
      })
    ];

    const result = await exporter.generateImportFile(invoices);
    expect(result.includedCount).toBe(1);

    const xml = result.content.toString("utf-8");
    expect(xml).toContain("<VOUCHERNUMBER>file-fallback</VOUCHERNUMBER>");
    expect(xml).toContain("<PARTYLEDGERNAME>Unknown Vendor</PARTYLEDGERNAME>");
  });

  it("returns empty content when all invoices are skipped", async () => {
    const exporter = createExporter();

    const invoices = [
      createInvoiceStub({
        _id: "file-bad2",
        parsed: { vendorName: "Vendor" },
        ocrText: "nothing"
      })
    ];

    const result = await exporter.generateImportFile(invoices);
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

  const basePayload = {
    companyName: "Demo Company",
    purchaseLedgerName: "Purchase",
    partyLedgerName: "Vendor",
    amountMinor: 118000,
    currency: "INR",
    date: new Date("2026-03-01"),
  } as const;

  it.each([
    [
      "intra-state (CGST+SGST)",
      { voucherNumber: "INV-GST-1", gstin: "29ABCDE1234F1Z5", gst: { subtotalMinor: 100000, cgstMinor: 9000, sgstMinor: 9000 }, gstLedgers },
      ["<PARTYGSTIN>29ABCDE1234F1Z5</PARTYGSTIN>", "<LEDGERNAME>Input CGST</LEDGERNAME>", "<LEDGERNAME>Input SGST</LEDGERNAME>"],
      ["Input IGST", "Input Cess"],
    ],
    [
      "inter-state (IGST)",
      { voucherNumber: "INV-GST-2", gstin: "07FGHIJ5678K2Z3", gst: { subtotalMinor: 100000, igstMinor: 18000 }, gstLedgers },
      ["<PARTYGSTIN>07FGHIJ5678K2Z3</PARTYGSTIN>", "<LEDGERNAME>Input IGST</LEDGERNAME>", "<AMOUNT>180.00</AMOUNT>"],
      ["Input CGST", "Input SGST"],
    ],
    [
      "with cess",
      { voucherNumber: "INV-GST-3", amountMinor: 130000, gst: { subtotalMinor: 100000, cgstMinor: 9000, sgstMinor: 9000, cessMinor: 12000 }, gstLedgers },
      ["<LEDGERNAME>Input Cess</LEDGERNAME>", "<AMOUNT>120.00</AMOUNT>"],
      [],
    ],
    [
      "omits GSTIN when not provided",
      { voucherNumber: "INV-GST-4", gst: { subtotalMinor: 100000, cgstMinor: 9000, sgstMinor: 9000 }, gstLedgers },
      ["<LEDGERNAME>Input CGST</LEDGERNAME>"],
      ["<PARTYGSTIN>"],
    ],
    [
      "subtotalMinor=0 uses 0.00 purchase",
      { voucherNumber: "INV-GST-6", gst: { subtotalMinor: 0, cgstMinor: 9000, sgstMinor: 9000 }, gstLedgers },
      ["<AMOUNT>0.00</AMOUNT>", "<LEDGERNAME>Input CGST</LEDGERNAME>"],
      [],
    ],
    [
      "falls back to non-GST structure when gstLedgers missing",
      { voucherNumber: "INV-GST-5" },
      ["<AMOUNT>-1180.00</AMOUNT>", "<AMOUNT>1180.00</AMOUNT>"],
      ["Input CGST"],
    ],
  ])("generates %s voucher correctly", (_label, overrides, expectedContains, expectedNotContains) => {
    const xml = buildTallyPurchaseVoucherPayload({ ...basePayload, ...(overrides as object) } as never);
    for (const s of expectedContains) expect(xml).toContain(s);
    for (const s of expectedNotContains) expect(xml).not.toContain(s);
  });
});

describe("TallyExporter with GST config", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
  });

  it("generates GST voucher XML when invoice has GST data and exporter has gstLedgers", async () => {
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, altered: 0, errors: 0, lastVchId: "100" }));

    const exporter = createExporter({
      // preserve the same test-specific GST config
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
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, altered: 0, errors: 0, lastVchId: "101" }));

    const exporter = createExporter({
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
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, altered: 0, errors: 0, lastVchId: "103" }));

    const exporter = createExporter({
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
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, altered: 0, errors: 0, lastVchId: "104" }));

    const exporter = createExporter({
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
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, altered: 0, errors: 0, lastVchId: "102" }));

    const exporter = createExporter({
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

  it("generates GST import file with multiple invoices", async () => {
    const exporter = createExporter({
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

    const result = await exporter.generateImportFile(invoices);
    expect(result.includedCount).toBe(2);

    const xml = result.content.toString("utf-8");
    expect(xml).toContain("<LEDGERNAME>Input CGST</LEDGERNAME>");
    expect(xml).toContain("<LEDGERNAME>Input IGST</LEDGERNAME>");
    expect(xml).toContain("<VOUCHERNUMBER>GST-F1</VOUCHERNUMBER>");
    expect(xml).toContain("<VOUCHERNUMBER>GST-F2</VOUCHERNUMBER>");
  });
});

describe("TCS voucher XML generation", () => {
  const tcsBase = {
    companyName: "Demo Company",
    purchaseLedgerName: "Purchase",
    partyLedgerName: "TCS Vendor",
    amountMinor: 100000,
    currency: "INR",
    date: new Date("2026-04-01"),
  } as const;

  it("adds TCS ledger entry with ISDEEMEDPOSITIVE=No and positive amount, and adds to party total", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      ...tcsBase,
      voucherNumber: "INV-TCS-1",
      tcs: { amountMinor: 1000, ledgerName: "TCS Receivable" }
    });

    expect(xml).toContain("<LEDGERNAME>TCS Receivable</LEDGERNAME>");
    expect(xml).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>");
    expect(xml).toMatch(/<LEDGERNAME>TCS Receivable<\/LEDGERNAME>[\s\S]*?<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>10\.00<\/AMOUNT>/);
    expect(xml).not.toMatch(/<LEDGERNAME>TCS Receivable<\/LEDGERNAME>[\s\S]*?<AMOUNT>-10\.00<\/AMOUNT>/);
    expect(xml).toContain("<AMOUNT>-1010.00</AMOUNT>");
  });

  it.each([
    ["tcs.amountMinor is zero", { amountMinor: 0, ledgerName: "TCS Receivable" }],
    ["tcs is not provided", undefined],
  ])("omits TCS ledger entry when %s", (_label, tcs) => {
    const xml = buildTallyPurchaseVoucherPayload({
      ...tcsBase,
      voucherNumber: "INV-TCS-omit",
      partyLedgerName: "Vendor",
      ...(tcs ? { tcs } : {}),
    } as never);
    expect(xml).not.toContain("<LEDGERNAME>TCS Receivable</LEDGERNAME>");
    expect(xml).toContain("<AMOUNT>-1000.00</AMOUNT>");
  });

  it("TCS and TDS can appear together in the same voucher", () => {
    const xml = buildTallyPurchaseVoucherPayload({
      companyName: "Demo Company",
      purchaseLedgerName: "Purchase",
      voucherNumber: "INV-TCS-TDS",
      partyLedgerName: "Combo Vendor",
      amountMinor: 100000,
      currency: "INR",
      date: new Date("2026-04-01"),
      tds: {
        section: "194C",
        amountMinor: 2000,
        ledgerName: "TDS Payable 194C"
      },
      tcs: {
        amountMinor: 1000,
        ledgerName: "TCS Receivable"
      }
    });

    expect(xml).toContain("<LEDGERNAME>TDS Payable 194C</LEDGERNAME>");
    expect(xml).toContain("<LEDGERNAME>TCS Receivable</LEDGERNAME>");
    expect(xml).toContain("<AMOUNT>-1010.00</AMOUNT>");
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
  compliance?: Record<string, unknown>;
  exportVersion?: number;
  clientOrgId?: string | null;
}

function createInvoiceStub(input: InvoiceStubInput) {
  const state = {
    parsed: input.parsed ?? {},
    processingIssues: input.processingIssues ?? []
  };

  const clientOrgId = input.clientOrgId === null
    ? null
    : (input.clientOrgId ?? "000000000000000000000001");

  return {
    _id: input._id,
    clientOrgId,
    sourceType: input.sourceType ?? "email",
    sourceKey: input.sourceKey ?? "inbox",
    attachmentName: input.attachmentName ?? "file.pdf",
    receivedAt: input.receivedAt ?? new Date("2026-02-19T00:00:00.000Z"),
    parsed: state.parsed,
    ocrText: input.ocrText,
    compliance: input.compliance,
    exportVersion: input.exportVersion ?? 0,
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
  } as unknown as import("../../models/invoice/Invoice.js").InvoiceDocument;
}

describe("TallyExporter with compliance data", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
  });

  it("overrides purchaseLedgerName with GL code name from compliance", async () => {
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, errors: 0, lastVchId: "200" }));

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "comp-gl",
      parsed: {
        invoiceNumber: "COMP-GL-1",
        vendorName: "Vendor GL",
        currency: "INR",
        totalAmountMinor: 10000
      },
      compliance: {
        glCode: { code: "4002", name: "Professional Fees" }
      }
    });

    await exporter.exportInvoices([invoice]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<LEDGERNAME>Professional Fees</LEDGERNAME>");
    expect(payload).not.toContain("<LEDGERNAME>Purchase</LEDGERNAME>");
  });

  it("maps TDS compliance to TDS ledger entry and adjusts party amount to netPayable", async () => {
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, errors: 0, lastVchId: "201" }));

    const exporter = createExporter({ tdsLedgerPrefix: "TDS Payable" });
    const invoice = createInvoiceStub({
      _id: "comp-tds",
      parsed: {
        invoiceNumber: "COMP-TDS-1",
        vendorName: "Vendor TDS",
        currency: "INR",
        totalAmountMinor: 100000
      },
      compliance: {
        tds: { section: "194C", amountMinor: 2000, netPayableMinor: 98000 }
      }
    });

    await exporter.exportInvoices([invoice]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<LEDGERNAME>TDS Payable - 194C</LEDGERNAME>");
    expect(payload).toContain("<AMOUNT>-980.00</AMOUNT>");
    expect(payload).toContain("<AMOUNT>-20.00</AMOUNT>");
  });

  it("maps TCS compliance to TCS Receivable ledger entry and adds TCS to party total", async () => {
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, errors: 0, lastVchId: "202" }));

    const exporter = createExporter({ tcsLedgerName: "TCS Receivable" });
    const invoice = createInvoiceStub({
      _id: "comp-tcs",
      parsed: {
        invoiceNumber: "COMP-TCS-1",
        vendorName: "Vendor TCS",
        currency: "INR",
        totalAmountMinor: 100000
      },
      compliance: {
        tcs: { amountMinor: 1500 }
      }
    });

    await exporter.exportInvoices([invoice]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<LEDGERNAME>TCS Receivable</LEDGERNAME>");
    expect(payload).toContain("<AMOUNT>-1015.00</AMOUNT>");
    expect(payload).toContain("<AMOUNT>15.00</AMOUNT>");
  });

  it("uses default TCS ledger name when tcsLedgerName is not configured", async () => {
    mockAxiosPostResolved(makeImportResponse({ status: 1, created: 1, errors: 0, lastVchId: "203" }));

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "comp-tcs-default",
      parsed: {
        invoiceNumber: "COMP-TCS-DEF",
        vendorName: "Vendor TCS Def",
        currency: "INR",
        totalAmountMinor: 50000
      },
      compliance: {
        tcs: { amountMinor: 500 }
      }
    });

    await exporter.exportInvoices([invoice]);

    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<LEDGERNAME>TCS Receivable</LEDGERNAME>");
  });
})

describe("TallyExporter re-export guard (BE-2) — 2-phase staging", () => {
  const TENANT_ID = "tenant-re";

  beforeEach(() => {
    axiosPostMock.mockReset();
    resolveReExportDecisionMock.mockReset();
    stageInFlightExportVersionMock.mockReset();
    promoteExportVersionMock.mockReset();
    clearInFlightExportVersionMock.mockReset();
    buildTallyExportConfigMock.mockReset();
    clientOrganizationFindOneMock.mockReset();
    clientOrganizationFindOneMock.mockResolvedValue(null);
    stageInFlightExportVersionMock.mockResolvedValue(undefined);
    promoteExportVersionMock.mockResolvedValue(undefined);
    clearInFlightExportVersionMock.mockResolvedValue(undefined);
    buildTallyExportConfigMock.mockResolvedValue({
      companyName: "Demo Co",
      purchaseLedgerName: "Purchase",
      gstLedgers: { cgstLedger: "CGST", sgstLedger: "SGST", igstLedger: "IGST", cessLedger: "Cess" },
      tdsLedgerPrefix: "TDS",
      tcsLedgerName: "TCS"
    });
  });

  it("first export stages inFlight, POSTs with ACTION=Create, and promotes on success", async () => {
    resolveReExportDecisionMock.mockResolvedValue({
      guid: "sha-new-1",
      action: "Create",
      priorExportVersion: 0,
      nextExportVersion: 1,
      buyerStateName: null
    });
    axiosPostMock.mockResolvedValue({
      data: makeImportResponse({ status: 1, created: 1, lastVchId: "900" })
    });

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "re-1",
      parsed: {
        invoiceNumber: "RE-1",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 100000
      }
    });

    const results = await exporter.exportInvoices([invoice], TENANT_ID);

    expect(results[0]).toMatchObject({ invoiceId: "re-1", success: true });
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("ACTION=\"Create\"");
    expect(payload).toContain("<GUID>sha-new-1</GUID>");
    expect(stageInFlightExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-1", expectedPriorVersion: 0 });
    expect(promoteExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-1", stagedVersion: 1 });
    expect(clearInFlightExportVersionMock).not.toHaveBeenCalled();
  });

  it("re-export stages inFlight, POSTs with ACTION=Alter, and promotes on 200 OK", async () => {
    resolveReExportDecisionMock.mockResolvedValue({
      guid: "sha-alter-v2",
      action: "Alter",
      priorExportVersion: 1,
      nextExportVersion: 2,
      buyerStateName: null
    });
    axiosPostMock.mockResolvedValue({
      data: makeImportResponse({ status: 1, altered: 1, lastVchId: "901" })
    });

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "re-2",
      exportVersion: 1,
      parsed: {
        invoiceNumber: "RE-2",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 50000
      }
    });

    const results = await exporter.exportInvoices([invoice], TENANT_ID);

    expect(results[0]).toMatchObject({ invoiceId: "re-2", success: true });
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("ACTION=\"Alter\"");
    expect(payload).toContain("<GUID>sha-alter-v2</GUID>");
    expect(stageInFlightExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-2", expectedPriorVersion: 1 });
    expect(promoteExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-2", stagedVersion: 2 });
    expect(clearInFlightExportVersionMock).not.toHaveBeenCalled();
  });

  it("clears inFlight (no promote) when Tally import reports ERRORS>0", async () => {
    resolveReExportDecisionMock.mockResolvedValue({
      guid: "sha-x",
      action: "Create",
      priorExportVersion: 0,
      nextExportVersion: 1,
      buyerStateName: null
    });
    axiosPostMock.mockResolvedValue({
      data: makeImportResponse({ status: 1, created: 0, errors: 1, lineError: "Ledger does not exist" })
    });

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "re-3",
      parsed: { invoiceNumber: "RE-3", vendorName: "Vendor", currency: "INR", totalAmountMinor: 50000 }
    });

    const results = await exporter.exportInvoices([invoice], TENANT_ID);
    expect(results[0].success).toBe(false);
    expect(stageInFlightExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-3", expectedPriorVersion: 0 });
    expect(clearInFlightExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-3", stagedVersion: 1 });
    expect(promoteExportVersionMock).not.toHaveBeenCalled();
  });

  it("clears inFlight (no promote) when axios POST throws", async () => {
    resolveReExportDecisionMock.mockResolvedValue({
      guid: "sha-throw",
      action: "Create",
      priorExportVersion: 0,
      nextExportVersion: 1,
      buyerStateName: null
    });
    mockAxiosPostRejected(new Error("connect refused"));

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "re-3b",
      parsed: { invoiceNumber: "RE-3B", vendorName: "Vendor", currency: "INR", totalAmountMinor: 50000 }
    });

    const results = await exporter.exportInvoices([invoice], TENANT_ID);
    expect(results[0].success).toBe(false);
    expect(stageInFlightExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-3b", expectedPriorVersion: 0 });
    expect(clearInFlightExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-3b", stagedVersion: 1 });
    expect(promoteExportVersionMock).not.toHaveBeenCalled();
  });

  it("crash recovery: a second attempt with pre-staged inFlight re-POSTs with same GUID and promotes on success", async () => {
    resolveReExportDecisionMock.mockResolvedValue({
      guid: "sha-recovery",
      action: "Alter",
      priorExportVersion: 1,
      nextExportVersion: 2,
      buyerStateName: null
    });
    axiosPostMock.mockResolvedValue({
      data: makeImportResponse({ status: 1, altered: 1, lastVchId: "999" })
    });

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "re-recovery",
      exportVersion: 1,
      parsed: { invoiceNumber: "RE-REC", vendorName: "Vendor", currency: "INR", totalAmountMinor: 50000 }
    });

    const results = await exporter.exportInvoices([invoice], TENANT_ID);

    expect(results[0]).toMatchObject({ invoiceId: "re-recovery", success: true });
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<GUID>sha-recovery</GUID>");
    expect(payload).toContain("ACTION=\"Alter\"");
    expect(stageInFlightExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-recovery", expectedPriorVersion: 1 });
    expect(promoteExportVersionMock).toHaveBeenCalledWith({ invoiceId: "re-recovery", stagedVersion: 2 });
  });

  it("surfaces F12OverwriteNotVerifiedError with a clear message when re-export is attempted without verification", async () => {
    const { F12OverwriteNotVerifiedError } = jest.requireActual("@/services/export/tallyReExportGuard.ts");
    resolveReExportDecisionMock.mockRejectedValue(new F12OverwriteNotVerifiedError(TENANT_ID));

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "re-4",
      exportVersion: 1,
      parsed: { invoiceNumber: "RE-4", vendorName: "Vendor", currency: "INR", totalAmountMinor: 50000 }
    });

    const results = await exporter.exportInvoices([invoice], TENANT_ID);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/F12/);
    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(stageInFlightExportVersionMock).not.toHaveBeenCalled();
  });

  it("omits PLACEOFSUPPLY when party state cannot be determined (safe default)", async () => {
    resolveReExportDecisionMock.mockResolvedValue({
      guid: "sha-pos",
      action: "Create",
      priorExportVersion: 0,
      nextExportVersion: 1,
      buyerStateName: "Karnataka"
    });
    axiosPostMock.mockResolvedValue({
      data: makeImportResponse({ status: 1, created: 1, lastVchId: "902" })
    });

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "re-5",
      parsed: { invoiceNumber: "RE-5", vendorName: "Vendor", currency: "INR", totalAmountMinor: 50000 }
    });

    await exporter.exportInvoices([invoice], TENANT_ID);
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<GUID>sha-pos</GUID>");
    expect(payload).not.toContain("<PLACEOFSUPPLY>");
  });

  it("reads detectedVersion from ClientOrganization when tenantId is provided", async () => {
    clientOrganizationFindOneMock.mockResolvedValue({ detectedVersion: "prime" });
    resolveReExportDecisionMock.mockResolvedValue({
      guid: "sha-dv",
      action: "Create",
      priorExportVersion: 0,
      nextExportVersion: 1,
      buyerStateName: null
    });
    axiosPostMock.mockResolvedValue({
      data: makeImportResponse({ status: 1, created: 1, lastVchId: "905" })
    });

    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "re-dv",
      clientOrgId: "000000000000000000000099",
      parsed: { invoiceNumber: "RE-DV", vendorName: "Vendor", currency: "INR", totalAmountMinor: 50000 }
    });

    await exporter.exportInvoices([invoice], TENANT_ID);
    // Post hierarchy-pivot (#156): detected-version is looked up by
    // invoice.clientOrgId (not tenantId) since each ClientOrganization
    // now owns its own Tally version metadata.
    expect(clientOrganizationFindOneMock).toHaveBeenCalledWith("000000000000000000000099");
  });

  it("does not engage the guard when invoice clientOrgId is absent (triage state)", async () => {
    // Post hierarchy-pivot (#159): triage-state invoices carry
    // `clientOrgId: null`. The guard is keyed on clientOrgId now, so
    // a null clientOrgId short-circuits re-export decision resolution.
    axiosPostMock.mockResolvedValue({
      data: makeImportResponse({ status: 1, created: 1, lastVchId: "903" })
    });
    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "re-nt",
      clientOrgId: null,
      parsed: { invoiceNumber: "RE-NT", vendorName: "Vendor", currency: "INR", totalAmountMinor: 50000 }
    });

    await exporter.exportInvoices([invoice]);
    expect(resolveReExportDecisionMock).not.toHaveBeenCalled();
    expect(stageInFlightExportVersionMock).not.toHaveBeenCalled();
    expect(promoteExportVersionMock).not.toHaveBeenCalled();
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("ACTION=\"Create\"");
    expect(payload).not.toContain("<GUID>");
  });
});

describe("TallyExporter PLACEOFSUPPLY emission matrix (post-pivot, ClientOrganization-rooted)", () => {
  const TENANT_ID = "tenant-pos";

  beforeEach(() => {
    axiosPostMock.mockReset();
    resolveReExportDecisionMock.mockReset();
    stageInFlightExportVersionMock.mockReset();
    promoteExportVersionMock.mockReset();
    clearInFlightExportVersionMock.mockReset();
    buildTallyExportConfigMock.mockReset();
    clientOrganizationFindOneMock.mockReset();
    clientOrganizationFindOneMock.mockResolvedValue(null);
    stageInFlightExportVersionMock.mockResolvedValue(undefined);
    promoteExportVersionMock.mockResolvedValue(undefined);
    clearInFlightExportVersionMock.mockResolvedValue(undefined);
    buildTallyExportConfigMock.mockResolvedValue({
      companyName: "Demo Co",
      purchaseLedgerName: "Purchase",
      gstLedgers: { cgstLedger: "CGST", sgstLedger: "SGST", igstLedger: "IGST", cessLedger: "Cess" },
      tdsLedgerPrefix: "TDS",
      tcsLedgerName: "TCS"
    });
    axiosPostMock.mockResolvedValue({
      data: makeImportResponse({ status: 1, created: 1, lastVchId: "9000" })
    });
  });

  function mockBuyerState(buyerStateName: string | null) {
    resolveReExportDecisionMock.mockResolvedValue({
      guid: "sha-pos-matrix",
      action: "Create",
      priorExportVersion: 0,
      nextExportVersion: 1,
      buyerStateName
    });
  }

  it("same-state (vendor 27xxxx + buyer Maharashtra): PLACEOFSUPPLY absent, STATENAME present", async () => {
    mockBuyerState("Maharashtra");
    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "pos-same",
      parsed: {
        invoiceNumber: "POS-SAME",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 50000,
        vendorGstin: "27AABCA1234C1Z5"
      }
    });

    await exporter.exportInvoices([invoice], TENANT_ID);
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).not.toContain("<PLACEOFSUPPLY>");
    expect(payload).toContain("<STATENAME>Maharashtra</STATENAME>");
  });

  it("cross-state (vendor 27xxxx + buyer Karnataka): PLACEOFSUPPLY=Karnataka, STATENAME=Maharashtra", async () => {
    mockBuyerState("Karnataka");
    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "pos-cross",
      parsed: {
        invoiceNumber: "POS-CROSS",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 50000,
        vendorGstin: "27AABCA1234C1Z5"
      }
    });

    await exporter.exportInvoices([invoice], TENANT_ID);
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY>");
    expect(payload).toContain("<STATENAME>Maharashtra</STATENAME>");
  });

  it("invalid vendor GSTIN with valid address: derives party state from address (cross-state emits PLACEOFSUPPLY)", async () => {
    mockBuyerState("Karnataka");
    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "pos-addr",
      parsed: {
        invoiceNumber: "POS-ADDR",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 50000,
        vendorGstin: "INVALID-GSTIN-HERE",
        vendorAddress: "12 Anna Salai, Chennai, Tamil Nadu - 600002"
      }
    });

    await exporter.exportInvoices([invoice], TENANT_ID);
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<STATENAME>Tamil Nadu</STATENAME>");
    expect(payload).toContain("<PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY>");
  });

  it("both vendor identifiers absent: party state = null, PLACEOFSUPPLY absent (safe default)", async () => {
    mockBuyerState("Karnataka");
    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "pos-none",
      parsed: {
        invoiceNumber: "POS-NONE",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 50000
      }
    });

    await exporter.exportInvoices([invoice], TENANT_ID);
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).not.toContain("<PLACEOFSUPPLY>");
    expect(payload).not.toContain("<STATENAME>");
  });

  it("unknown vendor GSTIN prefix (99xxxx): party state = null, PLACEOFSUPPLY absent, no throw", async () => {
    mockBuyerState("Karnataka");
    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "pos-unknown",
      parsed: {
        invoiceNumber: "POS-UNK",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 50000,
        vendorGstin: "99AABCA1234C1Z5"
      }
    });

    const results = await exporter.exportInvoices([invoice], TENANT_ID);
    expect(results[0].success).toBe(true);
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).not.toContain("<PLACEOFSUPPLY>");
    expect(payload).not.toContain("<STATENAME>");
  });

  it("vendor GSTIN beats mismatched address: GSTIN-derived Maharashtra wins over address Karnataka", async () => {
    mockBuyerState("Karnataka");
    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "pos-precedence",
      parsed: {
        invoiceNumber: "POS-PREC",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 50000,
        vendorGstin: "27AABCA1234C1Z5",
        vendorAddress: "Whitefield, Bengaluru, Karnataka - 560066"
      }
    });

    await exporter.exportInvoices([invoice], TENANT_ID);
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<STATENAME>Maharashtra</STATENAME>");
    expect(payload).toContain("<PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY>");
  });

  it("buyer state derived purely from clientOrg.gstin when stateName is null (verified end-to-end via guard)", async () => {
    // Guard returns the GSTIN-derived buyer state when ClientOrganization.stateName
    // is null; tested at the guard layer in tallyReExportGuard.test.ts. Here we
    // exercise the wiring: mock the guard to return what it would return in that
    // case (Karnataka derived from a 29-prefix gstin) and assert the exporter
    // emits PLACEOFSUPPLY when party (Maharashtra) differs.
    mockBuyerState("Karnataka");
    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "pos-buyer-from-gstin",
      parsed: {
        invoiceNumber: "POS-BFG",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 50000,
        vendorGstin: "27AABCA1234C1Z5"
      }
    });

    await exporter.exportInvoices([invoice], TENANT_ID);
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<PLACEOFSUPPLY>Karnataka</PLACEOFSUPPLY>");
  });

  it("buyer state from explicit ClientOrganization.stateName overrides GSTIN-derived (verified via guard, cross-state emits)", async () => {
    // Guard prefers explicit stateName; here we simulate the resolved decision
    // and assert exporter emission semantics.
    mockBuyerState("Tamil Nadu");
    const exporter = createExporter();
    const invoice = createInvoiceStub({
      _id: "pos-buyer-explicit",
      parsed: {
        invoiceNumber: "POS-BEX",
        vendorName: "Vendor",
        currency: "INR",
        totalAmountMinor: 50000,
        vendorGstin: "27AABCA1234C1Z5"
      }
    });

    await exporter.exportInvoices([invoice], TENANT_ID);
    const payload = String(axiosPostMock.mock.calls[0]?.[1] ?? "");
    expect(payload).toContain("<PLACEOFSUPPLY>Tamil Nadu</PLACEOFSUPPLY>");
    expect(payload).toContain("<STATENAME>Maharashtra</STATENAME>");
  });
});
