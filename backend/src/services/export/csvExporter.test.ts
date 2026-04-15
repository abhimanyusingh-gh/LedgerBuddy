jest.mock("@/services/compliance/tenantConfigResolver.js", () => {
  let configStore: Record<string, { defaultCurrency?: string }> = {};

  return {
    resolveDefaultCurrencyConfig: jest.fn(async (tenantId: string) => configStore[tenantId] ?? null),
    _setConfig: (tenantId: string, config: { defaultCurrency?: string }) => {
      configStore[tenantId] = config;
    },
    _resetStore: () => { configStore = {}; }
  };
});

jest.mock("@/services/export/tenantExportConfigResolver.js", () => ({
  buildCsvExportConfig: jest.fn(async () => ({ columns: undefined }))
}));

import { generateCsvExport } from "@/services/export/csvExporter.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import type { InvoiceDocument } from "@/models/invoice/Invoice.js";

const mockResolver = jest.requireMock("@/services/compliance/tenantConfigResolver.js") as {
  _setConfig: (id: string, cfg: { defaultCurrency?: string }) => void;
  _resetStore: () => void;
};

function makeInvoice(overrides: Record<string, unknown> = {}): InvoiceDocument {
  return {
    status: INVOICE_STATUS.APPROVED,
    parsed: {
      invoiceNumber: "INV-001",
      vendorName: "Test Vendor",
      totalAmountMinor: 100000,
      ...((overrides.parsed ?? {}) as Record<string, unknown>)
    },
    ...overrides
  } as unknown as InvoiceDocument;
}

describe("csvExporter — defaultCurrency from tenant config", () => {
  beforeEach(() => {
    mockResolver._resetStore();
  });

  it("uses INR as fallback when no tenant config exists", async () => {
    const result = await generateCsvExport([makeInvoice()], undefined, "tenant-a");
    const lines = result.content.split("\n");
    const dataLine = lines[1];
    expect(dataLine).toContain("INR");
  });

  it("uses tenant defaultCurrency when invoice has no currency", async () => {
    mockResolver._setConfig("tenant-b", { defaultCurrency: "USD" });
    const inv = makeInvoice({ parsed: { invoiceNumber: "INV-002", vendorName: "V", totalAmountMinor: 50000 } });
    const result = await generateCsvExport([inv], undefined, "tenant-b");
    const lines = result.content.split("\n");
    const dataLine = lines[1];
    expect(dataLine).toContain("USD");
  });

  it("uses invoice currency over tenant default when present", async () => {
    mockResolver._setConfig("tenant-c", { defaultCurrency: "USD" });
    const inv = makeInvoice({
      parsed: { invoiceNumber: "INV-003", vendorName: "V", totalAmountMinor: 50000, currency: "EUR" }
    });
    const result = await generateCsvExport([inv], undefined, "tenant-c");
    const lines = result.content.split("\n");
    const dataLine = lines[1];
    expect(dataLine).toContain("EUR");
    expect(dataLine).not.toContain("USD");
  });

  it("falls back to INR when no tenantId is provided", async () => {
    const result = await generateCsvExport([makeInvoice()]);
    const lines = result.content.split("\n");
    const dataLine = lines[1];
    expect(dataLine).toContain("INR");
  });
});
