jest.mock("../../models/invoice/ApprovalWorkflow.js");
jest.mock("../../models/invoice/Invoice.js");
jest.mock("../../models/core/TenantUserRole.js", () => {
  const actual = jest.requireActual("../../models/core/TenantUserRole.js");
  return {
    ...actual,
    TenantUserRoleModel: {
      findOne: jest.fn(),
      countDocuments: jest.fn()
    }
  };
});
jest.mock("../../utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import { ApprovalWorkflowModel } from "@/models/invoice/ApprovalWorkflow.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { TenantUserRoleModel, normalizeTenantRole } from "@/models/core/TenantUserRole.js";
import { WORKFLOW_STATUS, WORKFLOW_STEP_ACTION } from "@/models/invoice/ApprovalWorkflow.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { HttpError } from "@/errors/HttpError.js";
import { ApprovalWorkflowService } from "@/services/invoice/approvalWorkflowService.js";
import type { AuthenticatedRequestContext } from "@/types/auth.js";
import { toUUID } from "@/types/uuid.js";
import { Types } from "mongoose";

const TENANT_ID = toUUID("tenant-001");
const USER_ID = toUUID("user-001");
const CLIENT_ORG_ID = new Types.ObjectId();
const WORKFLOW_ID = "workflow-001";
const INVOICE_ID = "invoice-001";

function makeAuth(overrides: Partial<AuthenticatedRequestContext> = {}): AuthenticatedRequestContext {
  return {
    userId: USER_ID,
    email: "user@test.com",
    tenantId: TENANT_ID,
    tenantName: "Test Tenant",
    onboardingStatus: "completed",
    role: "TENANT_ADMIN",
    isPlatformAdmin: false,
    ...overrides
  };
}

function makeWorkflowDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: WORKFLOW_ID,
    tenantId: TENANT_ID,
    enabled: true,
    mode: "advanced",
    simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
    steps: [
      { order: 1, name: "Step 1", type: "approval", approverType: "any_member", rule: "any", approverUserIds: [], condition: null, timeoutHours: null, escalateTo: null }
    ],
    ...overrides
  };
}

function makeInvoiceDoc(overrides: Record<string, unknown> = {}) {
  const workflowState = {
    workflowId: WORKFLOW_ID,
    currentStep: 1,
    status: WORKFLOW_STATUS.IN_PROGRESS,
    stepResults: [] as Array<Record<string, unknown>>,
    ...(overrides.workflowState as Record<string, unknown> ?? {})
  };
  const processingIssues: string[] = [];
  const result = {
    _id: INVOICE_ID,
    tenantId: TENANT_ID,
    status: (overrides.status as string) ?? INVOICE_STATUS.AWAITING_APPROVAL,
    processingIssues,
    parsed: (overrides.parsed as Record<string, unknown>) ?? { totalAmountMinor: 50000 },
    compliance: (overrides.compliance as unknown) ?? null,
    _data: {} as Record<string, unknown>,
    get(key: string): unknown { return result._data[key]; },
    set(key: string, val: unknown) {
      result._data[key] = val;
      if (key === "workflowState" || key === "approval") return;
      (result as Record<string, unknown>)[key] = val;
    },
    save: jest.fn().mockResolvedValue(undefined)
  };
  result._data = { workflowState, approval: undefined };
  return result;
}

const service = new ApprovalWorkflowService();

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ApprovalWorkflowService", () => {
  describe("buildSimpleSteps", () => {
    it.each([
      ["both false", false, false, 1, []],
      ["manager review only", true, false, 2, ["Manager review"]],
      ["final signoff only", false, true, 2, ["Final sign-off"]],
      ["both true", true, true, 3, ["Manager review", "Final sign-off"]],
    ])("%s flag combination", (_label, requireManagerReview, requireFinalSignoff, expectedLen, expectedExtraNames) => {
      const steps = service.buildSimpleSteps({ requireManagerReview, requireFinalSignoff });
      expect(steps).toHaveLength(expectedLen);
      expect(steps[0]).toEqual({
        order: 1,
        name: "Team member approval",
        approverType: "any_member",
        rule: "any"
      });
      for (let i = 0; i < expectedExtraNames.length; i++) {
        const step = steps[i + 1];
        expect(step.order).toBe(i + 2);
        expect(step.name).toBe(expectedExtraNames[i]);
        expect(step.approverType).toBe("role");
        expect(step.approverRole).toBe("TENANT_ADMIN");
        expect(step.rule).toBe("any");
      }
    });
  });

  describe("evaluateCondition", () => {
    describe("no condition", () => {
      const baseStep = { order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const };
      it.each([
        ["step has no condition", baseStep],
        ["condition field is empty string", { ...baseStep, condition: { field: "", operator: "gt", value: 100 } }],
        ["condition is null", { ...baseStep, condition: null }],
      ])("returns true when %s", (_label, step) => {
        expect(service.evaluateCondition(step as never, {})).toBe(true);
      });
    });

    describe("unknown field", () => {
      it("returns true for unknown condition field", () => {
        const step = { order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const, condition: { field: "unknownField", operator: "gt", value: 100 } };
        expect(service.evaluateCondition(step, {})).toBe(true);
      });
    });

    describe("totalAmountMinor", () => {
      const makeStep = (operator: string, value: unknown) => ({
        order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const,
        condition: { field: "totalAmountMinor", operator, value }
      });

      it.each([
        ["value is null", { parsed: { totalAmountMinor: null } }],
        ["value is undefined", { parsed: { totalAmountMinor: undefined } }],
        ["parsed is null", { parsed: null }],
        ["parsed is undefined", {}],
      ])("null-pass-through: returns true when %s", (_label, ctx) => {
        expect(service.evaluateCondition(makeStep("gt", 100), ctx as never)).toBe(true);
      });

      it.each([
        ["gt", 100, 200, true],
        ["gt", 100, 100, false],
        ["gt", 100, 50, false],
        ["gte", 100, 100, true],
        ["gte", 100, 99, false],
        ["lt", 100, 50, true],
        ["lt", 100, 100, false],
        ["lte", 100, 100, true],
        ["lte", 100, 101, false],
        ["eq", 100, 100, true],
        ["eq", 100, 99, false],
      ])("operator %s threshold=%i value=%i -> %s", (op, threshold, value, expected) => {
        expect(service.evaluateCondition(makeStep(op, threshold), { parsed: { totalAmountMinor: value } })).toBe(expected);
      });

      it.each([
        ["in: in array", [100, 200, 300], 200, true],
        ["in: not in array", [100, 200, 300], 150, false],
        ["in: threshold not an array", 100, 100, false],
      ])("%s", (_label, threshold, value, expected) => {
        expect(service.evaluateCondition(makeStep("in", threshold), { parsed: { totalAmountMinor: value } })).toBe(expected);
      });

      it("returns true for unknown operator", () => {
        expect(service.evaluateCondition(makeStep("neq", 100), { parsed: { totalAmountMinor: 100 } })).toBe(true);
      });

      it.each([
        ["non-numeric threshold", "abc", 100],
        ["non-numeric value", 100, "abc"],
      ])("returns true when numeric operator used with %s", (_label, threshold, value) => {
        expect(service.evaluateCondition(makeStep("gt", threshold), { parsed: { totalAmountMinor: value as unknown as number } })).toBe(true);
      });
    });

    describe("tdsAmountMinor", () => {
      const makeStep = (operator: string, value: unknown) => ({
        order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const,
        condition: { field: "tdsAmountMinor", operator, value }
      });

      it.each([
        ["compliance is null", { compliance: null }],
        ["compliance.tds is undefined", { compliance: {} }],
        ["compliance.tds.amountMinor is null", { compliance: { tds: { amountMinor: null } } }],
      ])("null-pass-through: returns true when %s", (_label, ctx) => {
        expect(service.evaluateCondition(makeStep("gt", 100), ctx as never)).toBe(true);
      });

      it.each([
        ["gt", 100, 200, true],
        ["lt", 100, 50, true],
        ["eq", 100, 100, true],
      ])("operator %s compares tds amount", (op, threshold, value, expected) => {
        expect(service.evaluateCondition(makeStep(op, threshold), { compliance: { tds: { amountMinor: value } } })).toBe(expected);
      });
    });

    describe("riskSignalMaxSeverity", () => {
      const makeStep = (operator: string, value: unknown) => ({
        order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const,
        condition: { field: "riskSignalMaxSeverity", operator, value }
      });

      it.each([
        ["compliance is null", { compliance: null }],
        ["riskSignals is undefined", { compliance: {} }],
        ["riskSignals array is empty", { compliance: { riskSignals: [] } }],
      ])("null-pass-through: returns true when %s", (_label, ctx) => {
        expect(service.evaluateCondition(makeStep("eq", 3), ctx as never)).toBe(true);
      });

      it.each([
        ["critical/warning -> 3", [{ severity: "warning" }, { severity: "critical" }], "eq", 3],
        ["warning+info -> 2", [{ severity: "warning" }, { severity: "info" }], "eq", 2],
        ["info -> 1", [{ severity: "info" }], "eq", 1],
        ["unknown severity -> 0", [{ severity: "unknown_level" }], "eq", 0],
        ["critical gt 2", [{ severity: "critical" }], "gt", 2],
        ["info lte 1", [{ severity: "info" }], "lte", 1],
      ])("computes max severity: %s", (_label, riskSignals, op, value) => {
        const compliance = { riskSignals };
        expect(service.evaluateCondition(makeStep(op, value), { compliance })).toBe(true);
      });
    });

    describe("glCodeSource", () => {
      const makeStep = (operator: string, value: unknown) => ({
        order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const,
        condition: { field: "glCodeSource", operator, value }
      });

      it.each([
        ["compliance is null", { compliance: null }],
        ["glCode is undefined", { compliance: {} }],
        ["glCode.source is undefined", { compliance: { glCode: {} } }],
      ])("null-pass-through: returns true when %s", (_label, ctx) => {
        expect(service.evaluateCondition(makeStep("eq", "manual"), ctx as never)).toBe(true);
      });

      it.each([
        ["eq matches", "eq", "manual", "manual", true],
        ["eq does not match", "eq", "manual", "auto", false],
        ["in matches", "in", ["manual", "override"], "manual", true],
        ["in does not match", "in", ["manual", "override"], "auto", false],
      ])("%s", (_label, op, threshold, source, expected) => {
        expect(service.evaluateCondition(makeStep(op, threshold), { compliance: { glCode: { source } } })).toBe(expected);
      });

      it("returns true for numeric operator on string value (type mismatch fallback)", () => {
        expect(service.evaluateCondition(makeStep("gt", "manual"), { compliance: { glCode: { source: "auto" } } })).toBe(true);
      });
    });
  });

  describe("canUserApproveStep", () => {
    describe("specific_users", () => {
      it("returns true when userId is in approverUserIds", async () => {
        const step = { order: 1, name: "S", approverType: "specific_users" as const, rule: "any" as const, approverUserIds: [USER_ID] };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(true);
      });

      it("returns false when userId is not in approverUserIds", async () => {
        const step = { order: 1, name: "S", approverType: "specific_users" as const, rule: "any" as const, approverUserIds: ["other-user"] };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(false);
      });

    });

    describe("no role record found", () => {
      it("returns false when no TenantUserRole exists", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
        const step = { order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(false);
      });
    });

    describe("role", () => {
      it("returns true when user role matches approverRole", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN" }) });
        const step = { order: 1, name: "S", approverType: "role" as const, rule: "any" as const, approverRole: "TENANT_ADMIN" };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(true);
      });

      it("returns false when user role does not match approverRole", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "ap_clerk" }) });
        const step = { order: 1, name: "S", approverType: "role" as const, rule: "any" as const, approverRole: "TENANT_ADMIN" };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(false);
      });

    });

    describe("persona", () => {
      it("returns true when user role matches approverPersona", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "ca" }) });
        const step = { order: 1, name: "S", approverType: "persona" as const, rule: "any" as const, approverPersona: "ca" };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(true);
      });

      it("returns false when user role does not match approverPersona", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "ap_clerk" }) });
        const step = { order: 1, name: "S", approverType: "persona" as const, rule: "any" as const, approverPersona: "ca" };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(false);
      });

    });

    describe("capability", () => {
      it("returns true when user has the required capability", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
          lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { canSignOffCompliance: true } })
        });
        const step = { order: 1, name: "S", approverType: "capability" as const, rule: "any" as const, approverCapability: "canSignOffCompliance" };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(true);
      });

      it("returns false when user does not have the required capability", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
          lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { canSignOffCompliance: false } })
        });
        const step = { order: 1, name: "S", approverType: "capability" as const, rule: "any" as const, approverCapability: "canSignOffCompliance" };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(false);
      });

      it("returns false when capabilities object is undefined", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
          lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN" })
        });
        const step = { order: 1, name: "S", approverType: "capability" as const, rule: "any" as const, approverCapability: "canSignOffCompliance" };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(false);
      });

    });

    describe("any_member (fallback)", () => {
      it("returns true for non-PLATFORM_ADMIN roles", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN" }) });
        const step = { order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(true);
      });

      it("returns false for PLATFORM_ADMIN role", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "PLATFORM_ADMIN" }) });
        const step = { order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(false);
      });
    });
  });

  describe("getWorkflowConfig", () => {
    it("returns null when no workflow exists", async () => {
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      const result = await service.getWorkflowConfig(TENANT_ID);
      expect(result).toBeNull();
    });

    it("returns config with mapped steps when workflow exists", async () => {
      const doc = makeWorkflowDoc();
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
      const result = await service.getWorkflowConfig(TENANT_ID);
      expect(result).not.toBeNull();
      expect(result!.enabled).toBe(true);
      expect(result!.mode).toBe("advanced");
      expect(result!.steps).toHaveLength(1);
      expect(result!.steps[0].type).toBe("approval");
    });

    it("defaults simpleConfig values when they are undefined", async () => {
      const doc = makeWorkflowDoc({ simpleConfig: undefined });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
      const result = await service.getWorkflowConfig(TENANT_ID);
      expect(result!.simpleConfig.requireManagerReview).toBe(false);
      expect(result!.simpleConfig.requireFinalSignoff).toBe(false);
    });

    it("maps condition correctly when condition.field is present", async () => {
      const doc = makeWorkflowDoc({
        steps: [{ order: 1, name: "S", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: 500000 } }]
      });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
      const result = await service.getWorkflowConfig(TENANT_ID);
      expect(result!.steps[0].condition).toEqual({ field: "totalAmountMinor", operator: "gt", value: 500000 });
    });

  });

  describe("saveWorkflowConfig", () => {
    it("uses buildSimpleSteps when mode is simple", async () => {
      const config = {
        enabled: true,
        mode: "simple" as const,
        simpleConfig: { requireManagerReview: true, requireFinalSignoff: false },
        steps: []
      };
      const savedDoc = makeWorkflowDoc({ mode: "simple", steps: [{ order: 1, name: "Team member approval", approverType: "any_member", rule: "any" }, { order: 2, name: "Manager review", approverType: "role", approverRole: "TENANT_ADMIN", rule: "any" }] });
      (ApprovalWorkflowModel.findOneAndUpdate as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(savedDoc) });

      const result = await service.saveWorkflowConfig(TENANT_ID, CLIENT_ORG_ID, config, USER_ID);
      const call = (ApprovalWorkflowModel.findOneAndUpdate as jest.Mock).mock.calls[0];
      const passedSteps = call[1].steps;
      expect(passedSteps).toHaveLength(2);
      expect(passedSteps[0].name).toBe("Team member approval");
      expect(passedSteps[1].name).toBe("Manager review");
    });

    it("uses config.steps directly when mode is advanced", async () => {
      const advancedSteps = [
        { order: 1, name: "Custom Step", approverType: "role" as const, approverRole: "ca", rule: "any" as const }
      ];
      const config = {
        enabled: true,
        mode: "advanced" as const,
        simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
        steps: advancedSteps
      };
      const savedDoc = makeWorkflowDoc({ mode: "advanced", steps: advancedSteps });
      (ApprovalWorkflowModel.findOneAndUpdate as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(savedDoc) });

      await service.saveWorkflowConfig(TENANT_ID, CLIENT_ORG_ID, config, USER_ID);
      const call = (ApprovalWorkflowModel.findOneAndUpdate as jest.Mock).mock.calls[0];
      expect(call[1].steps).toBe(advancedSteps);
    });

    it("reverts awaiting_approval invoices to needs_review when workflow is disabled", async () => {
      const config = {
        enabled: false,
        mode: "simple" as const,
        simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
        steps: []
      };
      const savedDoc = makeWorkflowDoc({ enabled: false });
      (ApprovalWorkflowModel.findOneAndUpdate as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(savedDoc) });
      (InvoiceModel.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 3 });

      await service.saveWorkflowConfig(TENANT_ID, CLIENT_ORG_ID, config, USER_ID);

      expect(InvoiceModel.updateMany).toHaveBeenCalledWith(
        { tenantId: TENANT_ID, clientOrgId: CLIENT_ORG_ID, status: INVOICE_STATUS.AWAITING_APPROVAL },
        expect.objectContaining({
          $set: { status: INVOICE_STATUS.NEEDS_REVIEW },
          $unset: { workflowState: "" },
          $push: { processingIssues: "Approval workflow disabled — returned to review." }
        })
      );
    });

    it("does not revert invoices when workflow is enabled", async () => {
      const config = {
        enabled: true,
        mode: "simple" as const,
        simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
        steps: []
      };
      const savedDoc = makeWorkflowDoc({ enabled: true });
      (ApprovalWorkflowModel.findOneAndUpdate as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(savedDoc) });

      await service.saveWorkflowConfig(TENANT_ID, CLIENT_ORG_ID, config, USER_ID);
      expect(InvoiceModel.updateMany).not.toHaveBeenCalled();
    });

  });

  describe("isWorkflowEnabled", () => {
    it("returns true when enabled workflow exists", async () => {
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: "some-id" }) }) });
      const result = await service.isWorkflowEnabled(TENANT_ID);
      expect(result).toBe(true);
    });

    it("returns false when no enabled workflow exists", async () => {
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) });
      const result = await service.isWorkflowEnabled(TENANT_ID);
      expect(result).toBe(false);
    });
  });

  describe("initiateWorkflow", () => {
    it("returns false when no enabled workflow exists", async () => {
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      const result = await service.initiateWorkflow(INVOICE_ID, TENANT_ID);
      expect(result).toBe(false);
    });

    it("returns false when workflow has no steps", async () => {
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(makeWorkflowDoc({ steps: [] })) });
      const result = await service.initiateWorkflow(INVOICE_ID, TENANT_ID);
      expect(result).toBe(false);
    });

    it("returns false when invoice is not found", async () => {
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(makeWorkflowDoc()) });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(null);
      const result = await service.initiateWorkflow(INVOICE_ID, TENANT_ID);
      expect(result).toBe(false);
    });

    it("returns false when invoice status is not PARSED or NEEDS_REVIEW", async () => {
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(makeWorkflowDoc()) });
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.APPROVED });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const result = await service.initiateWorkflow(INVOICE_ID, TENANT_ID);
      expect(result).toBe(false);
    });

    it("returns false when first step has no order=1", async () => {
      const wf = makeWorkflowDoc({ steps: [{ order: 2, name: "S2", approverType: "any_member", rule: "any" }] });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.PARSED });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const result = await service.initiateWorkflow(INVOICE_ID, TENANT_ID);
      expect(result).toBe(false);
    });

    it("initiates workflow starting at step 1 when condition is met", async () => {
      const wf = makeWorkflowDoc({
        steps: [
          { order: 1, name: "S1", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: 100 } },
          { order: 2, name: "S2", approverType: "any_member", rule: "any" }
        ]
      });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.PARSED, parsed: { totalAmountMinor: 200 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);

      const result = await service.initiateWorkflow(INVOICE_ID, TENANT_ID);

      expect(result).toBe(true);
      expect(invoice.status).toBe(INVOICE_STATUS.AWAITING_APPROVAL);
      expect(invoice._data.workflowState).toEqual(expect.objectContaining({ currentStep: 1, status: WORKFLOW_STATUS.IN_PROGRESS }));
      expect((invoice._data.workflowState as Record<string, unknown>).stepResults).toEqual([]);
      expect(invoice.save).toHaveBeenCalled();
    });

    it("skips first step and starts at step 2 when condition is not met", async () => {
      const wf = makeWorkflowDoc({
        steps: [
          { order: 1, name: "S1", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: 1000 } },
          { order: 2, name: "S2", approverType: "any_member", rule: "any" }
        ]
      });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.NEEDS_REVIEW, parsed: { totalAmountMinor: 500 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);

      const result = await service.initiateWorkflow(INVOICE_ID, TENANT_ID);

      expect(result).toBe(true);
      const ws = invoice._data.workflowState as Record<string, unknown>;
      expect(ws.currentStep).toBe(2);
      const stepResults = ws.stepResults as Array<Record<string, unknown>>;
      expect(stepResults).toHaveLength(1);
      expect(stepResults[0].action).toBe(WORKFLOW_STEP_ACTION.SKIPPED);
      expect(stepResults[0].note).toBe("Condition not met");
    });

    it("returns false when only step is skipped (single step workflow condition not met)", async () => {
      const wf = makeWorkflowDoc({
        steps: [
          { order: 1, name: "S1", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: 1000 } }
        ]
      });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.PARSED, parsed: { totalAmountMinor: 500 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);

      const result = await service.initiateWorkflow(INVOICE_ID, TENANT_ID);
      expect(result).toBe(false);
    });

    it("accepts NEEDS_REVIEW status invoices", async () => {
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(makeWorkflowDoc()) });
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.NEEDS_REVIEW });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);

      const result = await service.initiateWorkflow(INVOICE_ID, TENANT_ID);
      expect(result).toBe(true);
    });

    it("pushes processing issue message on initiation", async () => {
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(makeWorkflowDoc()) });
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.PARSED });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);

      await service.initiateWorkflow(INVOICE_ID, TENANT_ID);
      expect(invoice.processingIssues).toContain("Approval workflow initiated.");
    });
  });

  describe("approveStep", () => {
    beforeEach(() => {
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: null } })
      });
    });

    it("throws 404 when invoice is not found", async () => {
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toThrow(HttpError);
      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({ statusCode: 404, code: "invoice_not_found" });
    });

    it("throws 400 when invoice is not awaiting approval", async () => {
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.PARSED });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({ statusCode: 400, code: "invoice_not_awaiting" });
    });

    it("throws 400 when workflowState is undefined", async () => {
      const invoice = makeInvoiceDoc();
      invoice._data.workflowState = undefined;
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({ statusCode: 400, code: "no_active_workflow" });
    });

    it("throws 400 when workflowState status is not in_progress", async () => {
      const invoice = makeInvoiceDoc({ workflowState: { status: WORKFLOW_STATUS.APPROVED } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({ statusCode: 400, code: "no_active_workflow" });
    });

    it("throws 404 when workflow config is not found", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({ statusCode: 404, code: "workflow_missing" });
    });

    it("throws 400 when current step is not found in workflow", async () => {
      const invoice = makeInvoiceDoc({ workflowState: { currentStep: 99 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(makeWorkflowDoc()) });
      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({ statusCode: 400, code: "step_missing" });
    });

    it("throws 403 when user is not eligible to approve", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({ steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: ["other-user"], rule: "any" }] });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: {} }) });
      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({ statusCode: 403, code: "not_eligible" });
    });

    it("throws 400 when user already approved this step", async () => {
      const invoice = makeInvoiceDoc({
        workflowState: {
          currentStep: 1,
          status: WORKFLOW_STATUS.IN_PROGRESS,
          stepResults: [{ step: 1, name: "S1", action: WORKFLOW_STEP_ACTION.APPROVED, userId: USER_ID, timestamp: new Date() }]
        }
      });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({ steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "all" }] });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({ statusCode: 400, code: "already_approved" });
    });

    describe("rule: any", () => {
      it("advances to next step on single approval", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [
            { order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" },
            { order: 2, name: "S2", approverType: "any_member", rule: "any" }
          ]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: true, fullyApproved: false });
        const ws = invoice._data.workflowState as Record<string, unknown>;
        expect(ws.currentStep).toBe(2);
      });

      it("fully approves when last step is approved", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: true, fullyApproved: true });
        expect(invoice.status).toBe(INVOICE_STATUS.APPROVED);
        const ws = invoice._data.workflowState as Record<string, unknown>;
        expect(ws.status).toBe(WORKFLOW_STATUS.APPROVED);
        expect(ws.currentStep).toBe(0);
      });
    });

    describe("rule: all", () => {
      it("returns partial approval when not all required approvers have approved (specific_users)", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID, "user-002"], rule: "all" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: false, fullyApproved: false });
        expect(invoice.save).toHaveBeenCalled();
      });

      it("advances when all specific_users have approved", async () => {
        const invoice = makeInvoiceDoc({
          workflowState: {
            currentStep: 1,
            status: WORKFLOW_STATUS.IN_PROGRESS,
            stepResults: [{ step: 1, name: "S1", action: WORKFLOW_STEP_ACTION.APPROVED, userId: "user-002", timestamp: new Date() }]
          }
        });
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID, "user-002"], rule: "all" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: true, fullyApproved: true });
      });

      it("counts required approvers from TenantUserRoleModel for role-based all rule", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "role", approverRole: "TENANT_ADMIN", rule: "all" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN" }) });
        (TenantUserRoleModel.countDocuments as jest.Mock).mockResolvedValue(3);

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: false, fullyApproved: false });
        expect(TenantUserRoleModel.countDocuments).toHaveBeenCalledWith({
          tenantId: TENANT_ID,
          role: normalizeTenantRole("TENANT_ADMIN")
        });
      });

      it("counts required approvers from TenantUserRoleModel for persona-based all rule", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "persona", approverPersona: "ca", rule: "all" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "ca" }) });
        (TenantUserRoleModel.countDocuments as jest.Mock).mockResolvedValue(2);

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: false, fullyApproved: false });
        expect(TenantUserRoleModel.countDocuments).toHaveBeenCalledWith({
          tenantId: TENANT_ID,
          role: normalizeTenantRole("ca")
        });
      });

      it("counts required approvers for any_member (all assignable roles)", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "any_member", rule: "all" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN" }) });
        (TenantUserRoleModel.countDocuments as jest.Mock).mockResolvedValue(1);

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: true, fullyApproved: true });
        expect(TenantUserRoleModel.countDocuments).toHaveBeenCalledWith({
          tenantId: TENANT_ID,
          role: { $in: expect.any(Array) }
        });
      });

    });

    describe("step skipping on advance", () => {
      it("skips steps whose conditions are not met during advancement", async () => {
        const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 50 } });
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [
            { order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" },
            { order: 2, name: "S2 (skipped)", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: 1000 } },
            { order: 3, name: "S3", approverType: "any_member", rule: "any" }
          ]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: true, fullyApproved: false });
        const ws = invoice._data.workflowState as Record<string, unknown>;
        expect(ws.currentStep).toBe(3);
        const stepResults = ws.stepResults as Array<Record<string, unknown>>;
        const skipped = stepResults.find((r) => r.step === 2);
        expect(skipped).toBeDefined();
        expect(skipped!.action).toBe(WORKFLOW_STEP_ACTION.SKIPPED);
      });

      it("fully approves when all remaining steps are skipped", async () => {
        const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 50 } });
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [
            { order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" },
            { order: 2, name: "S2 (skipped)", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: 1000 } }
          ]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: true, fullyApproved: true });
        expect(invoice.status).toBe(INVOICE_STATUS.APPROVED);
      });

      it("skips non-existent step orders (gaps in ordering)", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [
            { order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" },
            { order: 3, name: "S3", approverType: "any_member", rule: "any" }
          ]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        const result = await service.approveStep(INVOICE_ID, makeAuth());

        expect(result).toEqual({ advanced: true, fullyApproved: false });
        const ws = invoice._data.workflowState as Record<string, unknown>;
        expect(ws.currentStep).toBe(3);
      });
    });

    describe("approval metadata", () => {
      it("records step result with user info", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        await service.approveStep(INVOICE_ID, makeAuth());

        const ws = invoice._data.workflowState as Record<string, unknown>;
        const stepResults = ws.stepResults as Array<Record<string, unknown>>;
        expect(stepResults[0]).toMatchObject({
          step: 1,
          name: "S1",
          action: WORKFLOW_STEP_ACTION.APPROVED,
          userId: USER_ID,
          email: "user@test.com",
          role: "TENANT_ADMIN"
        });
      });

      it("sets approval metadata on invoice when fully approved", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
        const auth = makeAuth();

        await service.approveStep(INVOICE_ID, auth);

        expect(invoice._data.approval).toEqual(expect.objectContaining({
          approvedBy: auth.email,
          userId: auth.userId,
          email: auth.email,
          role: auth.role
        }));
      });

    });
  });

  describe("rejectStep", () => {
    it("throws 404 when invoice is not found", async () => {
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.rejectStep(INVOICE_ID, "Bad invoice", makeAuth())).rejects.toMatchObject({ statusCode: 404, code: "invoice_not_found" });
    });

    it("throws 400 when invoice is not awaiting approval", async () => {
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.PARSED });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      await expect(service.rejectStep(INVOICE_ID, "Bad invoice", makeAuth())).rejects.toMatchObject({ statusCode: 400, code: "invoice_not_awaiting" });
    });

    it("throws 400 when workflowState is undefined", async () => {
      const invoice = makeInvoiceDoc();
      invoice._data.workflowState = undefined;
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      await expect(service.rejectStep(INVOICE_ID, "Bad invoice", makeAuth())).rejects.toMatchObject({ statusCode: 400, code: "no_active_workflow" });
    });

    it("throws 400 when workflowState status is not in_progress", async () => {
      const invoice = makeInvoiceDoc({ workflowState: { status: WORKFLOW_STATUS.REJECTED } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      await expect(service.rejectStep(INVOICE_ID, "Bad invoice", makeAuth())).rejects.toMatchObject({ statusCode: 400, code: "no_active_workflow" });
    });

    it("throws 404 when workflow config is not found", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.rejectStep(INVOICE_ID, "Bad invoice", makeAuth())).rejects.toMatchObject({ statusCode: 404, code: "workflow_missing" });
    });

    it("throws 400 when current step is not found", async () => {
      const invoice = makeInvoiceDoc({ workflowState: { currentStep: 99 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(makeWorkflowDoc()) });
      await expect(service.rejectStep(INVOICE_ID, "Bad invoice", makeAuth())).rejects.toMatchObject({ statusCode: 400, code: "step_missing" });
    });

    it("throws 403 when user is not eligible to reject", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({ steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: ["other-user"], rule: "any" }] });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      await expect(service.rejectStep(INVOICE_ID, "Bad invoice", makeAuth())).rejects.toMatchObject({ statusCode: 403, code: "not_eligible" });
    });

    it("records rejection, sets status to NEEDS_REVIEW, and marks workflow as rejected", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({ steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }] });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

      await service.rejectStep(INVOICE_ID, "Amount mismatch", makeAuth());

      expect(invoice.status).toBe(INVOICE_STATUS.NEEDS_REVIEW);
      const ws = invoice._data.workflowState as Record<string, unknown>;
      expect(ws.status).toBe(WORKFLOW_STATUS.REJECTED);
      const stepResults = ws.stepResults as Array<Record<string, unknown>>;
      expect(stepResults[0]).toMatchObject({
        step: 1,
        name: "S1",
        action: WORKFLOW_STEP_ACTION.REJECTED,
        userId: USER_ID,
        email: "user@test.com",
        note: "Amount mismatch"
      });
      expect(invoice.processingIssues).toEqual(
        expect.arrayContaining([expect.stringContaining("Rejected at step 1")])
      );
      expect(invoice.save).toHaveBeenCalled();
    });
  });

  describe("resetWorkflowOnEdit", () => {
    it("does nothing when invoice is not found", async () => {
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(null);
      await service.resetWorkflowOnEdit(INVOICE_ID, TENANT_ID);
    });

    it("does nothing when invoice status is not AWAITING_APPROVAL", async () => {
      const invoice = makeInvoiceDoc({ status: INVOICE_STATUS.PARSED });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      await service.resetWorkflowOnEdit(INVOICE_ID, TENANT_ID);
      expect(invoice.save).not.toHaveBeenCalled();
    });

    it("does nothing when workflowState is undefined", async () => {
      const invoice = makeInvoiceDoc();
      invoice._data.workflowState = undefined;
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      await service.resetWorkflowOnEdit(INVOICE_ID, TENANT_ID);
      expect(invoice.save).not.toHaveBeenCalled();
    });

    it("does nothing when workflowState status is not in_progress", async () => {
      const invoice = makeInvoiceDoc({ workflowState: { status: WORKFLOW_STATUS.APPROVED } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      await service.resetWorkflowOnEdit(INVOICE_ID, TENANT_ID);
      expect(invoice.save).not.toHaveBeenCalled();
    });

    it("resets workflow when invoice is awaiting approval and workflow is in progress", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);

      await service.resetWorkflowOnEdit(INVOICE_ID, TENANT_ID);

      expect(invoice.status).toBe(INVOICE_STATUS.NEEDS_REVIEW);
      expect(invoice._data.workflowState).toBeUndefined();
      expect(invoice.processingIssues).toContain("Approval workflow reset — parsed fields modified.");
      expect(invoice.save).toHaveBeenCalled();
    });
  });

  describe("compliance_signoff enforcement", () => {
    it("rejects compliance_signoff step when user lacks canSignOffCompliance capability", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "Compliance Step", type: "compliance_signoff", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { canSignOffCompliance: false } })
      });

      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({
        statusCode: 403,
        code: "compliance_signoff_required",
        message: "Compliance sign-off requires the compliance sign-off capability."
      });
    });

    it("rejects compliance_signoff step when capabilities object is missing", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "Compliance Step", type: "compliance_signoff", approverType: "any_member", rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN" })
      });

      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({
        statusCode: 403,
        code: "compliance_signoff_required"
      });
    });

    it("rejects compliance_signoff step when no role record exists", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "Compliance Step", type: "compliance_signoff", approverType: "any_member", rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({
        statusCode: 403,
        code: "compliance_signoff_required"
      });
    });

    it("allows compliance_signoff step when user has canSignOffCompliance capability", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "Compliance Step", type: "compliance_signoff", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { canSignOffCompliance: true, approvalLimitMinor: null } })
      });

      const result = await service.approveStep(INVOICE_ID, makeAuth());
      expect(result.fullyApproved).toBe(true);
    });

    it("records qualifyingCapability in stepResults for compliance_signoff", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "Compliance Step", type: "compliance_signoff", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "ca", capabilities: { canSignOffCompliance: true, approvalLimitMinor: null } })
      });

      await service.approveStep(INVOICE_ID, makeAuth());

      const ws = invoice._data.workflowState as Record<string, unknown>;
      const stepResults = ws.stepResults as Array<Record<string, unknown>>;
      expect(stepResults[0]).toMatchObject({
        qualifyingCapability: "canSignOffCompliance"
      });
    });

    it("does not set qualifyingCapability for regular approval steps", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", type: "approval", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

      await service.approveStep(INVOICE_ID, makeAuth());

      const ws = invoice._data.workflowState as Record<string, unknown>;
      const stepResults = ws.stepResults as Array<Record<string, unknown>>;
      expect(stepResults[0].qualifyingCapability).toBeUndefined();
    });
  });

  describe("canUserApproveStep with compliance_signoff", () => {
    it("returns false for compliance_signoff when user lacks canSignOffCompliance even if in specific_users list", async () => {
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { canSignOffCompliance: false } })
      });
      const step = { order: 1, name: "S", type: "compliance_signoff" as const, approverType: "specific_users" as const, rule: "any" as const, approverUserIds: [USER_ID] };
      const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
      expect(result).toBe(false);
    });

    it("returns true for compliance_signoff when user has canSignOffCompliance and is in specific_users list", async () => {
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { canSignOffCompliance: true } })
      });
      const step = { order: 1, name: "S", type: "compliance_signoff" as const, approverType: "specific_users" as const, rule: "any" as const, approverUserIds: [USER_ID] };
      const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
      expect(result).toBe(true);
    });

    it("returns false for compliance_signoff when user has canSignOffCompliance but wrong role", async () => {
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "ap_clerk", capabilities: { canSignOffCompliance: true } })
      });
      const step = { order: 1, name: "S", type: "compliance_signoff" as const, approverType: "role" as const, rule: "any" as const, approverRole: "TENANT_ADMIN" };
      const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
      expect(result).toBe(false);
    });

    it("returns false for compliance_signoff when no role record exists", async () => {
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });
      const step = { order: 1, name: "S", type: "compliance_signoff" as const, approverType: "any_member" as const, rule: "any" as const };
      const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
      expect(result).toBe(false);
    });

    it("returns true for compliance_signoff with any_member when user has canSignOffCompliance and is not PLATFORM_ADMIN", async () => {
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "ca", capabilities: { canSignOffCompliance: true } })
      });
      const step = { order: 1, name: "S", type: "compliance_signoff" as const, approverType: "any_member" as const, rule: "any" as const };
      const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
      expect(result).toBe(true);
    });
  });

  describe("approval limit enforcement", () => {
    it("rejects when invoice amount exceeds user approval limit", async () => {
      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 5000000 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: 1000000 } })
      });

      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({
        statusCode: 403,
        code: "approval_limit_exceeded"
      });
    });

    it("allows approval when amount is within limit", async () => {
      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 500000 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: 1000000 } })
      });

      const result = await service.approveStep(INVOICE_ID, makeAuth());
      expect(result.fullyApproved).toBe(true);
    });

    it("allows approval when amount equals limit", async () => {
      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 1000000 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: 1000000 } })
      });

      const result = await service.approveStep(INVOICE_ID, makeAuth());
      expect(result.fullyApproved).toBe(true);
    });

    it("treats null approvalLimitMinor as unlimited", async () => {
      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 99999999 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: null } })
      });

      const result = await service.approveStep(INVOICE_ID, makeAuth());
      expect(result.fullyApproved).toBe(true);
    });

    it("skips limit check when invoice amount is undefined", async () => {
      const invoice = makeInvoiceDoc({ parsed: {} });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: 100 } })
      });

      const result = await service.approveStep(INVOICE_ID, makeAuth());
      expect(result.fullyApproved).toBe(true);
    });
  });

  describe("audit trail metadata in stepResults", () => {
    it("records approvalLimitAtApproval and invoiceAmountMinor for approval steps", async () => {
      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 50000 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: 100000 } })
      });

      await service.approveStep(INVOICE_ID, makeAuth());

      const ws = invoice._data.workflowState as Record<string, unknown>;
      const stepResults = ws.stepResults as Array<Record<string, unknown>>;
      expect(stepResults[0]).toMatchObject({
        approvalLimitAtApproval: 100000,
        invoiceAmountMinor: 50000
      });
    });

    it("records null approvalLimitAtApproval when limit is null (unlimited)", async () => {
      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 50000 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: null } })
      });

      await service.approveStep(INVOICE_ID, makeAuth());

      const ws = invoice._data.workflowState as Record<string, unknown>;
      const stepResults = ws.stepResults as Array<Record<string, unknown>>;
      expect(stepResults[0].approvalLimitAtApproval).toBeNull();
      expect(stepResults[0].invoiceAmountMinor).toBe(50000);
    });
  });

  describe("multi-step advanced workflow end-to-end", () => {
    it("progresses through a 3-step workflow with condition-based skipping", async () => {
      const wf = makeWorkflowDoc({
        steps: [
          { order: 1, name: "Initial Review", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" },
          { order: 2, name: "High Value Check", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: 100000 } },
          { order: 3, name: "Final Sign-off", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }
        ]
      });

      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 5000 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: null } })
      });

      const result1 = await service.approveStep(INVOICE_ID, makeAuth());
      expect(result1).toEqual({ advanced: true, fullyApproved: false });
      const ws1 = invoice._data.workflowState as Record<string, unknown>;
      expect(ws1.currentStep).toBe(3);

      const result2 = await service.approveStep(INVOICE_ID, makeAuth());
      expect(result2).toEqual({ advanced: true, fullyApproved: true });
      expect(invoice.status).toBe(INVOICE_STATUS.APPROVED);
    });
  });

  describe("enforcement integration: approval limit + approveStep", () => {
    it("rejects when invoice amount is exactly one unit above the limit", async () => {
      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 100001 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: 100000 } })
      });

      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({
        statusCode: 403,
        code: "approval_limit_exceeded"
      });
    });

    it("approval limit check happens after eligibility check (not_eligible before limit_exceeded)", async () => {
      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 5000000 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: ["other-user"], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: 100000 } })
      });

      const error = await service.approveStep(INVOICE_ID, makeAuth()).catch((e) => e);
      expect(error.code).toBe("not_eligible");
    });

  });

  describe("enforcement integration: concurrent approvals on rule:all steps", () => {
    it("second approver on rule:all step completes it when first already approved", async () => {
      const USER_2 = toUUID("user-002");
      const invoice = makeInvoiceDoc({
        workflowState: {
          currentStep: 1,
          status: WORKFLOW_STATUS.IN_PROGRESS,
          stepResults: [
            { step: 1, name: "S1", action: WORKFLOW_STEP_ACTION.APPROVED, userId: USER_2, timestamp: new Date(), approvalLimitAtApproval: null, invoiceAmountMinor: 50000 }
          ]
        }
      });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID, USER_2], rule: "all" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: null } })
      });

      const result = await service.approveStep(INVOICE_ID, makeAuth());
      expect(result).toEqual({ advanced: true, fullyApproved: true });
    });

    it("prevents duplicate approval by same user on rule:all step", async () => {
      const invoice = makeInvoiceDoc({
        workflowState: {
          currentStep: 1,
          status: WORKFLOW_STATUS.IN_PROGRESS,
          stepResults: [
            { step: 1, name: "S1", action: WORKFLOW_STEP_ACTION.APPROVED, userId: USER_ID, timestamp: new Date() }
          ]
        }
      });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID, "user-002", "user-003"], rule: "all" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: null } })
      });

      await expect(service.approveStep(INVOICE_ID, makeAuth())).rejects.toMatchObject({
        statusCode: 400,
        code: "already_approved"
      });
    });

  });

  describe("enforcement integration: audit metadata completeness", () => {
    it("records undefined invoiceAmountMinor when parsed data has no totalAmountMinor", async () => {
      const invoice = makeInvoiceDoc({ parsed: {} });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: null } })
      });

      await service.approveStep(INVOICE_ID, makeAuth());

      const ws = invoice._data.workflowState as Record<string, unknown>;
      const stepResults = ws.stepResults as Array<Record<string, unknown>>;
      expect(stepResults[0].invoiceAmountMinor).toBeUndefined();
    });

    it("each approver in a rule:all step gets their own audit metadata recorded", async () => {
      const USER_2 = toUUID("user-002");
      const invoice = makeInvoiceDoc({
        parsed: { totalAmountMinor: 50000 },
        workflowState: {
          currentStep: 1,
          status: WORKFLOW_STATUS.IN_PROGRESS,
          stepResults: [
            { step: 1, name: "S1", action: WORKFLOW_STEP_ACTION.APPROVED, userId: USER_2, timestamp: new Date(), approvalLimitAtApproval: 200000, invoiceAmountMinor: 50000 }
          ]
        }
      });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID, USER_2], rule: "all" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: 100000 } })
      });

      await service.approveStep(INVOICE_ID, makeAuth());

      const ws = invoice._data.workflowState as Record<string, unknown>;
      const stepResults = ws.stepResults as Array<Record<string, unknown>>;
      const user1Result = stepResults.find((r) => r.userId === USER_ID);
      const user2Result = stepResults.find((r) => r.userId === USER_2);
      expect(user1Result).toMatchObject({
        approvalLimitAtApproval: 100000,
        invoiceAmountMinor: 50000
      });
      expect(user2Result).toMatchObject({
        approvalLimitAtApproval: 200000,
        invoiceAmountMinor: 50000
      });
    });
  });
});
