import { Types } from "mongoose";
import {
  resolveClientComplianceConfig,
  resolveFreemailConfig,
  resolveLearningModeConfig,
  resolveDefaultCurrencyConfig,
  resolveTdsRatesConfig,
  resolveApprovalLimitConfig
} from "@/services/compliance/clientConfigResolver";
import { ClientComplianceConfigModel } from "@/models/integration/ClientComplianceConfig";
import { toUUID } from "@/types/uuid";

jest.mock("@/models/integration/ClientComplianceConfig");

const CLIENT_ORG_ID = new Types.ObjectId();

function mockFindOne(doc: Record<string, unknown> | null) {
  (ClientComplianceConfigModel.findOne as jest.Mock).mockReturnValue({
    lean: jest.fn().mockResolvedValue(doc),
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(doc)
    })
  });
}

describe("resolveClientComplianceConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when no config exists for tenant + clientOrg", async () => {
    mockFindOne(null);

    const result = await resolveClientComplianceConfig(toUUID("tenant-1"), CLIENT_ORG_ID);

    expect(result).toBeNull();
    expect(ClientComplianceConfigModel.findOne).toHaveBeenCalledWith({ tenantId: "tenant-1", clientOrgId: CLIENT_ORG_ID });
  });

  it("returns config fields when document exists", async () => {
    const doc = {
      tenantId: "tenant-1",
      clientOrgId: CLIENT_ORG_ID,
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

    const result = await resolveClientComplianceConfig(toUUID("tenant-1"), CLIENT_ORG_ID);

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
      clientOrgId: CLIENT_ORG_ID,
      complianceEnabled: false,
    };
    mockFindOne(doc);

    const result = await resolveClientComplianceConfig(toUUID("tenant-2"), CLIENT_ORG_ID);

    expect(result).not.toBeNull();
    expect(result!.maxInvoiceTotalMinor).toBeUndefined();
    expect(result!.maxDueDays).toBeUndefined();
    expect(result!.ocrWeight).toBeUndefined();
    expect(result!.reconciliationAutoMatchThreshold).toBeUndefined();
  });
});

describe("specialized resolvers (per-field projections)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolveFreemailConfig returns freemail domains when configured", async () => {
    mockFindOne({ additionalFreemailDomains: ["custom.com", "test.org"] });
    const result = await resolveFreemailConfig("tenant-1", CLIENT_ORG_ID);
    expect(result!.additionalFreemailDomains).toEqual(["custom.com", "test.org"]);
  });

  it("resolveLearningModeConfig returns learning mode when configured", async () => {
    mockFindOne({ learningMode: "active" });
    const result = await resolveLearningModeConfig("tenant-1", CLIENT_ORG_ID);
    expect(result!.learningMode).toBe("active");
  });

  it("resolveDefaultCurrencyConfig short-circuits when clientOrgId is undefined", async () => {
    const result = await resolveDefaultCurrencyConfig("tenant-1", undefined);
    expect(result).toBeNull();
    expect(ClientComplianceConfigModel.findOne).not.toHaveBeenCalled();
  });

  it("resolveDefaultCurrencyConfig returns default currency when configured", async () => {
    mockFindOne({ defaultCurrency: "USD" });
    const result = await resolveDefaultCurrencyConfig("tenant-1", CLIENT_ORG_ID);
    expect(result!.defaultCurrency).toBe("USD");
  });

  it("resolveTdsRatesConfig returns tds rates when configured", async () => {
    const rates = [{ section: "194J", rateIndividual: 1000 }];
    mockFindOne({ tdsRates: rates });
    const result = await resolveTdsRatesConfig("tenant-1", CLIENT_ORG_ID);
    expect(result!.tdsRates).toEqual(rates);
  });

  it("resolveApprovalLimitConfig returns approval limit overrides when configured", async () => {
    mockFindOne({ approvalLimitOverrides: { MEMBER: 50000 } });
    const result = await resolveApprovalLimitConfig("tenant-1", CLIENT_ORG_ID);
    expect(result!.approvalLimitOverrides).toEqual({ MEMBER: 50000 });
  });
});
