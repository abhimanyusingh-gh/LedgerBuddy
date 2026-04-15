import {
  getRoleDefaults,
  mergeCapabilitiesWithDefaults,
  applyApprovalLimitOverrides
} from "@/auth/personaDefaults.js";

describe("personaDefaults", () => {
  describe("getRoleDefaults", () => {
    it("returns ap_clerk defaults with 10000000 approval limit", () => {
      const caps = getRoleDefaults("ap_clerk");
      expect(caps.approvalLimitMinor).toBe(10000000);
      expect(caps.canApproveInvoices).toBe(true);
    });

    it("returns senior_accountant defaults with 100000000 approval limit", () => {
      const caps = getRoleDefaults("senior_accountant");
      expect(caps.approvalLimitMinor).toBe(100000000);
    });

    it("returns TENANT_ADMIN defaults with null (unlimited) approval limit", () => {
      const caps = getRoleDefaults("TENANT_ADMIN");
      expect(caps.approvalLimitMinor).toBeNull();
    });
  });

  describe("applyApprovalLimitOverrides", () => {
    it("returns original capabilities when overrides is undefined", () => {
      const caps = getRoleDefaults("ap_clerk");
      const result = applyApprovalLimitOverrides(caps, "ap_clerk", undefined);
      expect(result.approvalLimitMinor).toBe(10000000);
    });

    it("returns original capabilities when overrides is null", () => {
      const caps = getRoleDefaults("ap_clerk");
      const result = applyApprovalLimitOverrides(caps, "ap_clerk", null);
      expect(result.approvalLimitMinor).toBe(10000000);
    });

    it("returns original capabilities when role not in overrides", () => {
      const caps = getRoleDefaults("ap_clerk");
      const result = applyApprovalLimitOverrides(caps, "ap_clerk", { senior_accountant: 50000000 });
      expect(result.approvalLimitMinor).toBe(10000000);
    });

    it("applies override when role is present", () => {
      const caps = getRoleDefaults("ap_clerk");
      const result = applyApprovalLimitOverrides(caps, "ap_clerk", { ap_clerk: 20000000 });
      expect(result.approvalLimitMinor).toBe(20000000);
    });

    it("applies zero override to effectively remove approval ability", () => {
      const caps = getRoleDefaults("senior_accountant");
      const result = applyApprovalLimitOverrides(caps, "senior_accountant", { senior_accountant: 0 });
      expect(result.approvalLimitMinor).toBe(0);
    });

    it("does not mutate original capabilities", () => {
      const caps = getRoleDefaults("ap_clerk");
      const original = caps.approvalLimitMinor;
      applyApprovalLimitOverrides(caps, "ap_clerk", { ap_clerk: 99999 });
      expect(caps.approvalLimitMinor).toBe(original);
    });

    it("preserves all other capabilities when applying override", () => {
      const caps = getRoleDefaults("ap_clerk");
      const result = applyApprovalLimitOverrides(caps, "ap_clerk", { ap_clerk: 5000000 });
      expect(result.canApproveInvoices).toBe(true);
      expect(result.canEditInvoiceFields).toBe(true);
      expect(result.canExportToTally).toBe(true);
    });

    it("applies override for multiple roles independently", () => {
      const clerkCaps = getRoleDefaults("ap_clerk");
      const seniorCaps = getRoleDefaults("senior_accountant");
      const overrides = { ap_clerk: 15000000, senior_accountant: 250000000 };
      expect(applyApprovalLimitOverrides(clerkCaps, "ap_clerk", overrides).approvalLimitMinor).toBe(15000000);
      expect(applyApprovalLimitOverrides(seniorCaps, "senior_accountant", overrides).approvalLimitMinor).toBe(250000000);
    });
  });

  describe("mergeCapabilitiesWithDefaults", () => {
    it("returns role defaults when storedCaps is null", () => {
      const result = mergeCapabilitiesWithDefaults("ap_clerk", null);
      expect(result.approvalLimitMinor).toBe(10000000);
    });

    it("overrides specific capability from stored caps", () => {
      const result = mergeCapabilitiesWithDefaults("ap_clerk", { approvalLimitMinor: 5000000 });
      expect(result.approvalLimitMinor).toBe(5000000);
    });
  });
});
