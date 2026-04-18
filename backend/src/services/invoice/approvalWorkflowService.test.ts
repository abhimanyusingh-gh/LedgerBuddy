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

const TENANT_ID = toUUID("tenant-001");
const USER_ID = toUUID("user-001");
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
    it("returns one step when both flags are false", () => {
      const steps = service.buildSimpleSteps({ requireManagerReview: false, requireFinalSignoff: false });
      expect(steps).toHaveLength(1);
      expect(steps[0]).toEqual({
        order: 1,
        name: "Team member approval",
        approverType: "any_member",
        rule: "any"
      });
    });

    it("adds manager review step when requireManagerReview is true", () => {
      const steps = service.buildSimpleSteps({ requireManagerReview: true, requireFinalSignoff: false });
      expect(steps).toHaveLength(2);
      expect(steps[1]).toEqual({
        order: 2,
        name: "Manager review",
        approverType: "role",
        approverRole: "TENANT_ADMIN",
        rule: "any"
      });
    });

    it("adds final signoff step when requireFinalSignoff is true", () => {
      const steps = service.buildSimpleSteps({ requireManagerReview: false, requireFinalSignoff: true });
      expect(steps).toHaveLength(2);
      expect(steps[1]).toEqual({
        order: 2,
        name: "Final sign-off",
        approverType: "role",
        approverRole: "TENANT_ADMIN",
        rule: "any"
      });
    });

    it("adds both manager review and final signoff when both flags are true", () => {
      const steps = service.buildSimpleSteps({ requireManagerReview: true, requireFinalSignoff: true });
      expect(steps).toHaveLength(3);
      expect(steps[1].order).toBe(2);
      expect(steps[1].name).toBe("Manager review");
      expect(steps[2].order).toBe(3);
      expect(steps[2].name).toBe("Final sign-off");
    });
  });

  describe("evaluateCondition", () => {
    describe("no condition", () => {
      it("returns true when step has no condition", () => {
        const step = { order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const };
        expect(service.evaluateCondition(step, {})).toBe(true);
      });

      it("returns true when condition field is empty string", () => {
        const step = { order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const, condition: { field: "", operator: "gt", value: 100 } };
        expect(service.evaluateCondition(step, {})).toBe(true);
      });

      it("returns true when condition is null", () => {
        const step = { order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const, condition: null };
        expect(service.evaluateCondition(step, {})).toBe(true);
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

      it("returns true when value is null (null-pass-through behavior)", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { parsed: { totalAmountMinor: null } })).toBe(true);
      });

      it("returns true when value is undefined (null-pass-through behavior)", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { parsed: { totalAmountMinor: undefined } })).toBe(true);
      });

      it("returns true when parsed is null (null-pass-through behavior)", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { parsed: null })).toBe(true);
      });

      it("returns true when parsed is undefined (null-pass-through behavior)", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), {})).toBe(true);
      });

      it("gt: returns true when amount exceeds threshold", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { parsed: { totalAmountMinor: 200 } })).toBe(true);
      });

      it("gt: returns false when amount equals threshold", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { parsed: { totalAmountMinor: 100 } })).toBe(false);
      });

      it("gt: returns false when amount is below threshold", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { parsed: { totalAmountMinor: 50 } })).toBe(false);
      });

      it("gte: returns true when amount equals threshold", () => {
        expect(service.evaluateCondition(makeStep("gte", 100), { parsed: { totalAmountMinor: 100 } })).toBe(true);
      });

      it("gte: returns false when amount is below threshold", () => {
        expect(service.evaluateCondition(makeStep("gte", 100), { parsed: { totalAmountMinor: 99 } })).toBe(false);
      });

      it("lt: returns true when amount is below threshold", () => {
        expect(service.evaluateCondition(makeStep("lt", 100), { parsed: { totalAmountMinor: 50 } })).toBe(true);
      });

      it("lt: returns false when amount equals threshold", () => {
        expect(service.evaluateCondition(makeStep("lt", 100), { parsed: { totalAmountMinor: 100 } })).toBe(false);
      });

      it("lte: returns true when amount equals threshold", () => {
        expect(service.evaluateCondition(makeStep("lte", 100), { parsed: { totalAmountMinor: 100 } })).toBe(true);
      });

      it("lte: returns false when amount exceeds threshold", () => {
        expect(service.evaluateCondition(makeStep("lte", 100), { parsed: { totalAmountMinor: 101 } })).toBe(false);
      });

      it("eq: returns true when amount equals threshold", () => {
        expect(service.evaluateCondition(makeStep("eq", 100), { parsed: { totalAmountMinor: 100 } })).toBe(true);
      });

      it("eq: returns false when amount differs", () => {
        expect(service.evaluateCondition(makeStep("eq", 100), { parsed: { totalAmountMinor: 99 } })).toBe(false);
      });

      it("in: returns true when amount is in threshold array", () => {
        expect(service.evaluateCondition(makeStep("in", [100, 200, 300]), { parsed: { totalAmountMinor: 200 } })).toBe(true);
      });

      it("in: returns false when amount is not in threshold array", () => {
        expect(service.evaluateCondition(makeStep("in", [100, 200, 300]), { parsed: { totalAmountMinor: 150 } })).toBe(false);
      });

      it("in: returns false when threshold is not an array", () => {
        expect(service.evaluateCondition(makeStep("in", 100), { parsed: { totalAmountMinor: 100 } })).toBe(false);
      });

      it("returns true for unknown operator", () => {
        expect(service.evaluateCondition(makeStep("neq", 100), { parsed: { totalAmountMinor: 100 } })).toBe(true);
      });

      it("returns true when numeric operator used with non-numeric threshold", () => {
        expect(service.evaluateCondition(makeStep("gt", "abc"), { parsed: { totalAmountMinor: 100 } })).toBe(true);
      });

      it("returns true when numeric operator used with non-numeric value", () => {
        const step = {
          order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const,
          condition: { field: "totalAmountMinor", operator: "gt", value: 100 }
        };
        expect(service.evaluateCondition(step, { parsed: { totalAmountMinor: "abc" as unknown as number } })).toBe(true);
      });
    });

    describe("tdsAmountMinor", () => {
      const makeStep = (operator: string, value: unknown) => ({
        order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const,
        condition: { field: "tdsAmountMinor", operator, value }
      });

      it("returns true when compliance is null (null-pass-through)", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { compliance: null })).toBe(true);
      });

      it("returns true when compliance.tds is undefined (null-pass-through)", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { compliance: {} })).toBe(true);
      });

      it("returns true when compliance.tds.amountMinor is null (null-pass-through)", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { compliance: { tds: { amountMinor: null } } })).toBe(true);
      });

      it("gt: compares tds amount", () => {
        expect(service.evaluateCondition(makeStep("gt", 100), { compliance: { tds: { amountMinor: 200 } } })).toBe(true);
      });

      it("lt: compares tds amount", () => {
        expect(service.evaluateCondition(makeStep("lt", 100), { compliance: { tds: { amountMinor: 50 } } })).toBe(true);
      });

      it("eq: compares tds amount", () => {
        expect(service.evaluateCondition(makeStep("eq", 100), { compliance: { tds: { amountMinor: 100 } } })).toBe(true);
      });
    });

    describe("riskSignalMaxSeverity", () => {
      const makeStep = (operator: string, value: unknown) => ({
        order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const,
        condition: { field: "riskSignalMaxSeverity", operator, value }
      });

      it("returns true when compliance is null (null-pass-through)", () => {
        expect(service.evaluateCondition(makeStep("eq", 3), { compliance: null })).toBe(true);
      });

      it("returns true when riskSignals is undefined (null-pass-through)", () => {
        expect(service.evaluateCondition(makeStep("eq", 3), { compliance: {} })).toBe(true);
      });

      it("returns true when riskSignals array is empty (value stays undefined)", () => {
        expect(service.evaluateCondition(makeStep("eq", 3), { compliance: { riskSignals: [] } })).toBe(true);
      });

      it("computes max severity from signals and uses eq", () => {
        const compliance = { riskSignals: [{ severity: "warning" }, { severity: "critical" }] };
        expect(service.evaluateCondition(makeStep("eq", 3), { compliance })).toBe(true);
      });

      it("computes max severity: warning=2", () => {
        const compliance = { riskSignals: [{ severity: "warning" }, { severity: "info" }] };
        expect(service.evaluateCondition(makeStep("eq", 2), { compliance })).toBe(true);
      });

      it("computes max severity: info=1", () => {
        const compliance = { riskSignals: [{ severity: "info" }] };
        expect(service.evaluateCondition(makeStep("eq", 1), { compliance })).toBe(true);
      });

      it("computes max severity: unknown severity maps to 0", () => {
        const compliance = { riskSignals: [{ severity: "unknown_level" }] };
        expect(service.evaluateCondition(makeStep("eq", 0), { compliance })).toBe(true);
      });

      it("gt: compares numeric severity", () => {
        const compliance = { riskSignals: [{ severity: "critical" }] };
        expect(service.evaluateCondition(makeStep("gt", 2), { compliance })).toBe(true);
      });

      it("lte: compares numeric severity", () => {
        const compliance = { riskSignals: [{ severity: "info" }] };
        expect(service.evaluateCondition(makeStep("lte", 1), { compliance })).toBe(true);
      });
    });

    describe("glCodeSource", () => {
      const makeStep = (operator: string, value: unknown) => ({
        order: 1, name: "S", approverType: "any_member" as const, rule: "any" as const,
        condition: { field: "glCodeSource", operator, value }
      });

      it("returns true when compliance is null (null-pass-through)", () => {
        expect(service.evaluateCondition(makeStep("eq", "manual"), { compliance: null })).toBe(true);
      });

      it("returns true when glCode is undefined (null-pass-through)", () => {
        expect(service.evaluateCondition(makeStep("eq", "manual"), { compliance: {} })).toBe(true);
      });

      it("returns true when glCode.source is undefined (null-pass-through)", () => {
        expect(service.evaluateCondition(makeStep("eq", "manual"), { compliance: { glCode: {} } })).toBe(true);
      });

      it("eq: matches string source", () => {
        expect(service.evaluateCondition(makeStep("eq", "manual"), { compliance: { glCode: { source: "manual" } } })).toBe(true);
      });

      it("eq: does not match different source", () => {
        expect(service.evaluateCondition(makeStep("eq", "manual"), { compliance: { glCode: { source: "auto" } } })).toBe(false);
      });

      it("in: matches source in array", () => {
        expect(service.evaluateCondition(makeStep("in", ["manual", "override"]), { compliance: { glCode: { source: "manual" } } })).toBe(true);
      });

      it("in: does not match source not in array", () => {
        expect(service.evaluateCondition(makeStep("in", ["manual", "override"]), { compliance: { glCode: { source: "auto" } } })).toBe(false);
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

      it("returns false when approverUserIds is undefined (defaults to empty array)", async () => {
        const step = { order: 1, name: "S", approverType: "specific_users" as const, rule: "any" as const };
        const result = await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(result).toBe(false);
      });

      it("does not query TenantUserRoleModel (early return)", async () => {
        const step = { order: 1, name: "S", approverType: "specific_users" as const, rule: "any" as const, approverUserIds: [USER_ID] };
        await service.canUserApproveStep(USER_ID, TENANT_ID, step);
        expect(TenantUserRoleModel.findOne).not.toHaveBeenCalled();
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

      it("returns false when approverRole is undefined", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN" }) });
        const step = { order: 1, name: "S", approverType: "role" as const, rule: "any" as const };
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

      it("returns false when approverPersona is undefined", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "ca" }) });
        const step = { order: 1, name: "S", approverType: "persona" as const, rule: "any" as const };
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

      it("returns false when approverCapability is undefined (empty string lookup)", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
          lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: { canSignOffCompliance: true } })
        });
        const step = { order: 1, name: "S", approverType: "capability" as const, rule: "any" as const };
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

      it("returns true for persona roles (ap_clerk, ca, etc.)", async () => {
        (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ role: "ap_clerk" }) });
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

    it("defaults steps to empty array when undefined", async () => {
      const doc = makeWorkflowDoc({ steps: undefined });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
      const result = await service.getWorkflowConfig(TENANT_ID);
      expect(result!.steps).toEqual([]);
    });

    it("maps step.type to 'approval' when null", async () => {
      const doc = makeWorkflowDoc({
        steps: [{ order: 1, name: "S", type: null, approverType: "any_member", rule: "any", condition: null }]
      });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
      const result = await service.getWorkflowConfig(TENANT_ID);
      expect(result!.steps[0].type).toBe("approval");
    });

    it("maps condition to null when condition.field is falsy", async () => {
      const doc = makeWorkflowDoc({
        steps: [{ order: 1, name: "S", approverType: "any_member", rule: "any", condition: { field: null, operator: "gt", value: 100 } }]
      });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
      const result = await service.getWorkflowConfig(TENANT_ID);
      expect(result!.steps[0].condition).toBeNull();
    });

    it("maps condition correctly when condition.field is present", async () => {
      const doc = makeWorkflowDoc({
        steps: [{ order: 1, name: "S", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: 500000 } }]
      });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
      const result = await service.getWorkflowConfig(TENANT_ID);
      expect(result!.steps[0].condition).toEqual({ field: "totalAmountMinor", operator: "gt", value: 500000 });
    });

    it("defaults nullable step fields: approverRole, approverPersona, approverCapability, timeoutHours, escalateTo", async () => {
      const doc = makeWorkflowDoc({
        steps: [{ order: 1, name: "S", approverType: "any_member", rule: "any", approverRole: null, approverPersona: null, approverCapability: null, timeoutHours: null, escalateTo: null, condition: null }]
      });
      (ApprovalWorkflowModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
      const result = await service.getWorkflowConfig(TENANT_ID);
      const step = result!.steps[0];
      expect(step.approverRole).toBeUndefined();
      expect(step.approverPersona).toBeUndefined();
      expect(step.approverCapability).toBeUndefined();
      expect(step.timeoutHours).toBeNull();
      expect(step.escalateTo).toBeNull();
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

      const result = await service.saveWorkflowConfig(TENANT_ID, config, USER_ID);
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

      await service.saveWorkflowConfig(TENANT_ID, config, USER_ID);
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

      await service.saveWorkflowConfig(TENANT_ID, config, USER_ID);

      expect(InvoiceModel.updateMany).toHaveBeenCalledWith(
        { tenantId: TENANT_ID, status: INVOICE_STATUS.AWAITING_APPROVAL },
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

      await service.saveWorkflowConfig(TENANT_ID, config, USER_ID);
      expect(InvoiceModel.updateMany).not.toHaveBeenCalled();
    });

    it("defaults simpleConfig in returned value when doc.simpleConfig is undefined", async () => {
      const config = {
        enabled: true,
        mode: "simple" as const,
        simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
        steps: []
      };
      const savedDoc = makeWorkflowDoc({ simpleConfig: undefined, steps: undefined });
      (ApprovalWorkflowModel.findOneAndUpdate as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(savedDoc) });

      const result = await service.saveWorkflowConfig(TENANT_ID, config, USER_ID);
      expect(result.simpleConfig.requireManagerReview).toBe(false);
      expect(result.simpleConfig.requireFinalSignoff).toBe(false);
      expect(result.steps).toEqual([]);
    });

    it("does not log when modifiedCount is 0", async () => {
      const config = {
        enabled: false,
        mode: "simple" as const,
        simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
        steps: []
      };
      const savedDoc = makeWorkflowDoc({ enabled: false });
      (ApprovalWorkflowModel.findOneAndUpdate as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(savedDoc) });
      (InvoiceModel.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 0 });

      const { logger } = jest.requireMock("../../utils/logger.js");
      await service.saveWorkflowConfig(TENANT_ID, config, USER_ID);
      expect(logger.info).not.toHaveBeenCalledWith("workflow.disabled.invoices_reverted", expect.anything());
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

      it("pushes processing issue for partial approval", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID, "user-002"], rule: "all" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        await service.approveStep(INVOICE_ID, makeAuth());

        expect(invoice.processingIssues).toEqual(
          expect.arrayContaining([expect.stringContaining("partial approval")])
        );
      });

      it("pushes processing issue for step advancement", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [
            { order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" },
            { order: 2, name: "S2", approverType: "any_member", rule: "any" }
          ]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        await service.approveStep(INVOICE_ID, makeAuth());

        expect(invoice.processingIssues).toEqual(
          expect.arrayContaining([expect.stringContaining("advancing to step 2")])
        );
      });

      it("pushes processing issue for workflow completion", async () => {
        const invoice = makeInvoiceDoc();
        (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
        const wf = makeWorkflowDoc({
          steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
        });
        (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

        await service.approveStep(INVOICE_ID, makeAuth());

        expect(invoice.processingIssues).toEqual(
          expect.arrayContaining([expect.stringContaining("Workflow completed")])
        );
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

    it("includes both amounts in the rejection message", async () => {
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
        message: expect.stringContaining("Rs 50000") && expect.stringContaining("Rs 10000")
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

    it("treats undefined approvalLimitMinor as unlimited", async () => {
      const invoice = makeInvoiceDoc({ parsed: { totalAmountMinor: 99999999 } });
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "S1", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN", capabilities: {} })
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

  describe("step type handling", () => {
    it("escalation steps are treated identically to approval steps (no timeout logic)", async () => {
      const invoice = makeInvoiceDoc();
      (InvoiceModel.findOne as jest.Mock).mockResolvedValue(invoice);
      const wf = makeWorkflowDoc({
        steps: [{ order: 1, name: "Escalation Step", type: "escalation", approverType: "specific_users", approverUserIds: [USER_ID], rule: "any", timeoutHours: 24, escalateTo: "admin-user" }]
      });
      (ApprovalWorkflowModel.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(wf) });

      const result = await service.approveStep(INVOICE_ID, makeAuth());

      expect(result.fullyApproved).toBe(true);
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
});
