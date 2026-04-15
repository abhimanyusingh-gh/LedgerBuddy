import {
  resolveTenantComplianceConfig,
  resolveFreemailConfig,
  resolveLearningModeConfig,
  resolveDefaultCurrencyConfig,
  resolveTdsRatesConfig,
  resolveApprovalLimitConfig
} from "@/services/compliance/tenantConfigResolver";
import { TenantComplianceConfigModel } from "@/models/integration/TenantComplianceConfig";
import { toUUID } from "@/types/uuid";

jest.mock("@/models/integration/TenantComplianceConfig");

function mockFindOne(doc: Record<string, unknown> | null) {
  (TenantComplianceConfigModel.findOne as jest.Mock).mockReturnValue({
    lean: jest.fn().mockResolvedValue(doc),
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(doc)
    })
  });
}

describe("resolveTenantComplianceConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no config exists for tenant", async () => {
    mockFindOne(null);

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
    mockFindOne(doc);

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
    mockFindOne(doc);

    const result = await resolveTenantComplianceConfig(toUUID("tenant-2"));

    expect(result).not.toBeNull();
    expect(result!.maxInvoiceTotalMinor).toBeUndefined();
    expect(result!.maxDueDays).toBeUndefined();
    expect(result!.ocrWeight).toBeUndefined();
    expect(result!.reconciliationAutoMatchThreshold).toBeUndefined();
  });
});

describe("resolveFreemailConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no config exists", async () => {
    mockFindOne(null);
    const result = await resolveFreemailConfig("tenant-1");
    expect(result).toBeNull();
  });

  it("returns freemail domains when configured", async () => {
    mockFindOne({ additionalFreemailDomains: ["custom.com", "test.org"] });
    const result = await resolveFreemailConfig("tenant-1");
    expect(result).not.toBeNull();
    expect(result!.additionalFreemailDomains).toEqual(["custom.com", "test.org"]);
  });
});

describe("resolveLearningModeConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no config exists", async () => {
    mockFindOne(null);
    const result = await resolveLearningModeConfig("tenant-1");
    expect(result).toBeNull();
  });

  it("returns learning mode when configured", async () => {
    mockFindOne({ learningMode: "active" });
    const result = await resolveLearningModeConfig("tenant-1");
    expect(result!.learningMode).toBe("active");
  });
});

describe("resolveDefaultCurrencyConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no config exists", async () => {
    mockFindOne(null);
    const result = await resolveDefaultCurrencyConfig("tenant-1");
    expect(result).toBeNull();
  });

  it("returns default currency when configured", async () => {
    mockFindOne({ defaultCurrency: "USD" });
    const result = await resolveDefaultCurrencyConfig("tenant-1");
    expect(result!.defaultCurrency).toBe("USD");
  });
});

describe("resolveTdsRatesConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no config exists", async () => {
    mockFindOne(null);
    const result = await resolveTdsRatesConfig("tenant-1");
    expect(result).toBeNull();
  });

  it("returns tds rates when configured", async () => {
    const rates = [{ section: "194J", rateIndividual: 1000 }];
    mockFindOne({ tdsRates: rates });
    const result = await resolveTdsRatesConfig("tenant-1");
    expect(result!.tdsRates).toEqual(rates);
  });
});

describe("resolveApprovalLimitConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no config exists", async () => {
    mockFindOne(null);
    const result = await resolveApprovalLimitConfig("tenant-1");
    expect(result).toBeNull();
  });

  it("returns approval limit overrides when configured", async () => {
    mockFindOne({ approvalLimitOverrides: { MEMBER: 50000 } });
    const result = await resolveApprovalLimitConfig("tenant-1");
    expect(result!.approvalLimitOverrides).toEqual({ MEMBER: 50000 });
  });
});
