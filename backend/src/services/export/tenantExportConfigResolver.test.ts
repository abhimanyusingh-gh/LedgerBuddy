import { TenantExportConfigModel } from "@/models/integration/TenantExportConfig.ts";
import { buildTallyExportConfig, buildCsvExportConfig } from "@/services/export/tenantExportConfigResolver.ts";

jest.mock("@/config/env.js", () => ({
  env: {
    TALLY_COMPANY: "EnvCompany",
    TALLY_PURCHASE_LEDGER: "EnvPurchase",
    TALLY_CGST_LEDGER: "Env CGST",
    TALLY_SGST_LEDGER: "Env SGST",
    TALLY_IGST_LEDGER: "Env IGST",
    TALLY_CESS_LEDGER: "Env Cess",
    TALLY_TDS_LEDGER: "Env TDS",
    TALLY_TCS_LEDGER: "Env TCS"
  }
}));

describe("buildTallyExportConfig", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const systemDefaults = {
    companyName: "SystemCompany",
    purchaseLedgerName: "SystemPurchase",
    gstLedgers: {
      cgstLedger: "System CGST",
      sgstLedger: "System SGST",
      igstLedger: "System IGST",
      cessLedger: "System Cess"
    },
    tdsLedgerPrefix: "System TDS",
    tcsLedgerName: "System TCS"
  };

  it("returns tenant config when tenant has overrides", async () => {
    jest.spyOn(TenantExportConfigModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        tenantId: "tenant-a",
        tallyCompanyName: "TenantCompany",
        tallyPurchaseLedger: "TenantPurchase",
        tallyCgstLedger: "Tenant CGST",
        tallySgstLedger: null,
        tallyIgstLedger: undefined
      })
    } as never);

    const result = await buildTallyExportConfig("tenant-a", systemDefaults);

    expect(result.companyName).toBe("TenantCompany");
    expect(result.purchaseLedgerName).toBe("TenantPurchase");
    expect(result.gstLedgers.cgstLedger).toBe("Tenant CGST");
    expect(result.gstLedgers.sgstLedger).toBe("System SGST");
    expect(result.gstLedgers.igstLedger).toBe("System IGST");
  });

  it("falls back to system defaults when no tenant config exists", async () => {
    jest.spyOn(TenantExportConfigModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    } as never);

    const result = await buildTallyExportConfig("tenant-b", systemDefaults);

    expect(result.companyName).toBe("SystemCompany");
    expect(result.purchaseLedgerName).toBe("SystemPurchase");
    expect(result.gstLedgers.cgstLedger).toBe("System CGST");
    expect(result.tdsLedgerPrefix).toBe("System TDS");
    expect(result.tcsLedgerName).toBe("System TCS");
  });

  it("falls back to env vars when system defaults are missing", async () => {
    jest.spyOn(TenantExportConfigModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    } as never);

    const result = await buildTallyExportConfig("tenant-c", {
      companyName: "",
      purchaseLedgerName: "",
      gstLedgers: undefined as never,
      tdsLedgerPrefix: undefined as never,
      tcsLedgerName: undefined as never
    });

    expect(result.companyName).toBe("EnvCompany");
    expect(result.purchaseLedgerName).toBe("EnvPurchase");
    expect(result.gstLedgers.cgstLedger).toBe("Env CGST");
    expect(result.tdsLedgerPrefix).toBe("Env TDS");
    expect(result.tcsLedgerName).toBe("Env TCS");
  });

  it("tenant tds/tcs ledger overrides system defaults", async () => {
    jest.spyOn(TenantExportConfigModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        tenantId: "tenant-d",
        tallyTdsLedger: "Custom TDS",
        tallyTcsLedger: "Custom TCS"
      })
    } as never);

    const result = await buildTallyExportConfig("tenant-d", systemDefaults);

    expect(result.tdsLedgerPrefix).toBe("Custom TDS");
    expect(result.tcsLedgerName).toBe("Custom TCS");
  });
});

describe("buildCsvExportConfig", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns undefined columns when no tenant config exists", async () => {
    jest.spyOn(TenantExportConfigModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    } as never);

    const result = await buildCsvExportConfig("tenant-a");
    expect(result.columns).toBeUndefined();
  });

  it("returns undefined columns when tenant config has empty csvColumns", async () => {
    jest.spyOn(TenantExportConfigModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({ tenantId: "tenant-a", csvColumns: [] })
    } as never);

    const result = await buildCsvExportConfig("tenant-a");
    expect(result.columns).toBeUndefined();
  });

  it("returns tenant columns when configured", async () => {
    const tenantCols = [
      { key: "invoiceNumber", label: "Inv #" },
      { key: "vendorName", label: "Vendor" },
      { key: "total", label: "Amount" }
    ];
    jest.spyOn(TenantExportConfigModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({ tenantId: "tenant-b", csvColumns: tenantCols })
    } as never);

    const result = await buildCsvExportConfig("tenant-b");
    expect(result.columns).toEqual(tenantCols);
  });
});
