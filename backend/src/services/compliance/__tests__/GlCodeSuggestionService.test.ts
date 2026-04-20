import { GlCodeSuggestionService } from "@/services/compliance/GlCodeSuggestionService";
import { GlCodeMasterModel } from "@/models/compliance/GlCodeMaster";

jest.mock("../../../models/compliance/GlCodeMaster");
jest.mock("../../../models/compliance/VendorGlMapping");
jest.mock("../../../models/compliance/VendorMaster");

const service = new GlCodeSuggestionService();

describe("GlCodeSuggestionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("suggestFromSlmClassification", () => {
    it.each([
      ["slmGlCategory is empty", "  ", null],
      ["no GL codes exist for tenant", "Professional Services", []],
    ])("returns null when %s", async (_label, slmCategory, docs) => {
      if (docs !== null) {
        (GlCodeMasterModel.find as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(docs) });
      }
      const result = await service.suggestFromSlmClassification("tenant-1", slmCategory);
      expect(result).toBeNull();
    });

    it.each([
      ["exact category name match", "professional services", [
        { code: "4001", name: "Office Rent", category: "Rent", isActive: true },
        { code: "4002", name: "Legal Fees", category: "Professional Services", isActive: true }
      ]],
      ["exact GL code name match", "software subscription", [
        { code: "4001", name: "Office Rent", category: "Rent", isActive: true },
        { code: "4002", name: "Software Subscription", category: "Other", isActive: true }
      ]],
    ])("matches %s (case-insensitive) with confidence 80", async (_label, query, docs) => {
      (GlCodeMasterModel.find as jest.Mock).mockReturnValue({ lean: () => Promise.resolve(docs) });

      const result = await service.suggestFromSlmClassification("tenant-1", query);
      expect(result).not.toBeNull();
      expect(result!.glCode.code).toBe("4002");
      expect(result!.glCode.source).toBe("slm-classification");
      expect(result!.glCode.confidence).toBe(80);
    });

    it("falls back to token matching when no exact match", async () => {
      (GlCodeMasterModel.find as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve([
          { code: "4001", name: "Monthly Office Rent Payment", category: "Rent", isActive: true },
          { code: "4003", name: "Cloud Services", category: "Software Subscription", isActive: true }
        ])
      });

      const result = await service.suggestFromSlmClassification("tenant-1", "Software License");
      expect(result).not.toBeNull();
      expect(result!.glCode.code).toBe("4003");
      expect(result!.glCode.source).toBe("slm-classification");
      expect(result!.glCode.confidence).toBeLessThanOrEqual(70);
    });

    it("returns null when no token match found", async () => {
      (GlCodeMasterModel.find as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve([
          { code: "4001", name: "Office Rent", category: "Rent", isActive: true }
        ])
      });

      const result = await service.suggestFromSlmClassification("tenant-1", "Utilities");
      expect(result).toBeNull();
    });
  });

  describe("suggest with slmGlCategory", () => {
    it("prioritizes vendor history over SLM classification", async () => {
      const { VendorGlMappingModel } = jest.requireMock("../../../models/compliance/VendorGlMapping") as { VendorGlMappingModel: { find: jest.Mock } };
      VendorGlMappingModel.find = jest.fn().mockReturnValue({
        lean: () => Promise.resolve([
          { glCode: "5001", glCodeName: "Vendor Default GL", usageCount: 10, recentUsages: [new Date()] }
        ])
      });

      const result = await service.suggest("tenant-1", "fp-123", {}, undefined, "Professional Services");
      expect(result.glCode.code).toBe("5001");
      expect(result.glCode.source).toBe("vendor-default");
    });

    it("uses SLM classification when vendor history has no matches", async () => {
      const { VendorGlMappingModel } = jest.requireMock("../../../models/compliance/VendorGlMapping") as { VendorGlMappingModel: { find: jest.Mock } };
      VendorGlMappingModel.find = jest.fn().mockReturnValue({ lean: () => Promise.resolve([]) });

      (GlCodeMasterModel.find as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve([
          { code: "4002", name: "Consulting Fees", category: "Professional Services", isActive: true }
        ])
      });

      const result = await service.suggest("tenant-1", "fp-123", {}, undefined, "Professional Services");
      expect(result.glCode.code).toBe("4002");
      expect(result.glCode.source).toBe("slm-classification");
    });
  });
});
