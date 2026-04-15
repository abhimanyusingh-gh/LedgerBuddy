import { resolveTenantComplianceConfig } from "@/services/compliance/tenantConfigResolver";
import { TenantComplianceConfigModel } from "@/models/integration/TenantComplianceConfig";
import { toUUID } from "@/types/uuid";

jest.mock("@/models/integration/TenantComplianceConfig");

describe("resolveTenantComplianceConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no config exists for tenant", async () => {
    (TenantComplianceConfigModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    });

    const result = await resolveTenantComplianceConfig(toUUID("tenant-1"));

    expect(result).toBeNull();
    expect(TenantComplianceConfigModel.findOne).toHaveBeenCalledWith({ tenantId: "tenant-1" });
  });

  it("returns config fields when document exists", async () => {
    const doc = {
      tenantId: "tenant-1",
      complianceEnabled: true,
      maxInvoiceTotalMinor: 500000,
      maxDueDays: 60,
      eInvoiceThresholdMinor: 1000000,
      msmePaymentWarningDays: 25,
      msmePaymentOverdueDays: 40,
      ocrWeight: 0.7,
      completenessWeight: 0.3,
      reconciliationAutoMatchThreshold: 60,
      reconciliationSuggestThreshold: 35,
      reconciliationAmountToleranceMinor: 200,
    };
    (TenantComplianceConfigModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue(doc)
    });

    const result = await resolveTenantComplianceConfig(toUUID("tenant-1"));

    expect(result).not.toBeNull();
    expect(result!.tenantId).toBe("tenant-1");
    expect(result!.maxInvoiceTotalMinor).toBe(500000);
    expect(result!.maxDueDays).toBe(60);
    expect(result!.eInvoiceThresholdMinor).toBe(1000000);
    expect(result!.msmePaymentWarningDays).toBe(25);
    expect(result!.msmePaymentOverdueDays).toBe(40);
    expect(result!.ocrWeight).toBe(0.7);
    expect(result!.reconciliationAutoMatchThreshold).toBe(60);
  });

  it("returns fields as undefined when not set in document", async () => {
    const doc = {
      tenantId: "tenant-2",
      complianceEnabled: false,
    };
    (TenantComplianceConfigModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue(doc)
    });

    const result = await resolveTenantComplianceConfig(toUUID("tenant-2"));

    expect(result).not.toBeNull();
    expect(result!.maxInvoiceTotalMinor).toBeUndefined();
    expect(result!.maxDueDays).toBeUndefined();
    expect(result!.ocrWeight).toBeUndefined();
    expect(result!.reconciliationAutoMatchThreshold).toBeUndefined();
  });
});
