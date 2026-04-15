import { PanValidationService } from "@/services/compliance/PanValidationService";

const service = new PanValidationService();

describe("PanValidationService", () => {
  describe("valid PAN with GSTIN cross-ref", () => {
    it("returns L2 valid when PAN matches GSTIN chars 3-12", () => {
      const result = service.validate("ABCPK1234F", "29ABCPK1234F1Z5");
      expect(result.pan.value).toBe("ABCPK1234F");
      expect(result.pan.validationLevel).toBe("L2");
      expect(result.pan.validationResult).toBe("valid");
      expect(result.pan.gstinCrossRef).toBe(true);
      expect(result.riskSignals).toHaveLength(0);
    });
  });

  describe("valid PAN without GSTIN", () => {
    it("returns L1 valid when PAN format is correct but no GSTIN", () => {
      const result = service.validate("ABCPK1234F", null);
      expect(result.pan.validationLevel).toBe("L1");
      expect(result.pan.validationResult).toBe("valid");
      expect(result.pan.gstinCrossRef).toBe(false);
      expect(result.riskSignals).toHaveLength(0);
    });

    it("returns L1 valid when GSTIN format is invalid", () => {
      const result = service.validate("ABCPK1234F", "INVALID");
      expect(result.pan.validationLevel).toBe("L1");
      expect(result.pan.validationResult).toBe("valid");
    });
  });

  describe("PAN format invalid", () => {
    it("flags PAN_FORMAT_INVALID for short PAN", () => {
      const result = service.validate("ABCP", null);
      expect(result.pan.validationResult).toBe("format-invalid");
      expect(result.riskSignals).toHaveLength(1);
      expect(result.riskSignals[0].code).toBe("PAN_FORMAT_INVALID");
    });

    it("flags PAN_FORMAT_INVALID for numeric PAN", () => {
      const result = service.validate("1234567890", null);
      expect(result.pan.validationResult).toBe("format-invalid");
    });
  });

  describe("PAN-GSTIN mismatch", () => {
    it("flags PAN_GSTIN_MISMATCH when PAN doesn't match GSTIN", () => {
      const result = service.validate("ABCPK1234F", "29XYZPK5678G1Z5");
      expect(result.pan.validationResult).toBe("gstin-mismatch");
      expect(result.pan.validationLevel).toBe("L2");
      expect(result.pan.gstinCrossRef).toBe(true);
      expect(result.riskSignals).toHaveLength(1);
      expect(result.riskSignals[0].code).toBe("PAN_GSTIN_MISMATCH");
    });
  });

  describe("null/missing PAN", () => {
    it("returns null value with no signals when no GSTIN either", () => {
      const result = service.validate(null, null);
      expect(result.pan.value).toBeNull();
      expect(result.pan.validationLevel).toBeNull();
      expect(result.riskSignals).toHaveLength(0);
    });

    it("derives PAN from GSTIN when PAN missing but GSTIN valid", () => {
      const result = service.validate(null, "29ABCPK1234F1Z5");
      expect(result.pan.value).toBe("ABCPK1234F");
      expect(result.pan.source).toBe("vendor-master");
      expect(result.pan.validationLevel).toBe("L2");
      expect(result.pan.validationResult).toBe("valid");
      expect(result.pan.gstinCrossRef).toBe(true);
      expect(result.riskSignals).toHaveLength(0);
    });

    it("no PAN_MISSING when GSTIN format is invalid", () => {
      const result = service.validate(undefined, "INVALID");
      expect(result.riskSignals).toHaveLength(0);
    });
  });

  describe("case handling", () => {
    it("uppercases PAN before validation", () => {
      const result = service.validate("abcpk1234f", "29ABCPK1234F1Z5");
      expect(result.pan.value).toBe("ABCPK1234F");
      expect(result.pan.validationResult).toBe("valid");
    });
  });
});
