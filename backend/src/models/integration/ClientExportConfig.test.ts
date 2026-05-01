import { ClientExportConfigModel } from "@/models/integration/ClientExportConfig.js";

describe("ClientExportConfig schema additive Tally fields (RFC-BACKEND Phase 2 step 2.4)", () => {
  it("adds tallyBankLedger with null default", () => {
    const path = ClientExportConfigModel.schema.paths.tallyBankLedger as unknown as { defaultValue: unknown };
    expect(path).toBeDefined();
    expect(path.defaultValue).toBeNull();
  });

  it("adds tallyEndpointUrl with null default", () => {
    const path = ClientExportConfigModel.schema.paths.tallyEndpointUrl as unknown as { defaultValue: unknown };
    expect(path).toBeDefined();
    expect(path.defaultValue).toBeNull();
  });

  it("adds autoCreateVendors required boolean defaulting to false", () => {
    const path = ClientExportConfigModel.schema.paths.autoCreateVendors as unknown as {
      isRequired: boolean;
      defaultValue: boolean;
    };
    expect(path).toBeDefined();
    expect(path.isRequired).toBe(true);
    expect(path.defaultValue).toBe(false);
  });

  it("preserves existing Tally ledger fields (no rename, additive only)", () => {
    const paths = ClientExportConfigModel.schema.paths;
    expect(paths.tallyCompanyName).toBeDefined();
    expect(paths.tallyPurchaseLedger).toBeDefined();
    expect(paths.tallyCgstLedger).toBeDefined();
    expect(paths.tallySgstLedger).toBeDefined();
    expect(paths.tallyIgstLedger).toBeDefined();
    expect(paths.tallyCessLedger).toBeDefined();
    expect(paths.tallyTdsLedger).toBeDefined();
    expect(paths.tallyTcsLedger).toBeDefined();
  });
});
