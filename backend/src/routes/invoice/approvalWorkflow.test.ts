jest.mock("../../models/invoice/ApprovalWorkflow.js");
jest.mock("../../models/invoice/Invoice.js");
jest.mock("../../models/core/TenantUserRole.js", () => {
  const actual = jest.requireActual("../../models/core/TenantUserRole.js");
  return {
    ...actual,
    TenantUserRoleModel: {
      find: jest.fn(),
      findOne: jest.fn(),
      updateMany: jest.fn()
    }
  };
});
jest.mock("../../auth/personaDefaults.js", () => ({
  getRoleDefaults: jest.fn(() => ({ approvalLimitMinor: null }))
}));
jest.mock("../../models/core/AuditLog.js", () => ({
  AuditLogModel: { create: jest.fn().mockResolvedValue({}) }
}));
jest.mock("../../utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

import { createApprovalWorkflowRouter, validateStepCondition } from "@/routes/invoice/approvalWorkflow.js";
import { findHandler, defaultAuth, mockRequest, mockResponse } from "@/routes/testHelpers.js";

describe("validateStepCondition", () => {
  it.each([
    ["null condition", null],
    ["undefined condition", undefined],
    ["condition with empty field", { field: "", operator: "gt", value: 100 }],
    ["condition with null field", { field: null, operator: "gt", value: 100 }],
  ])("returns null for %s", (_label, condition) => {
    expect(validateStepCondition(condition)).toBeNull();
  });

  it.each([
    ["non-object condition", "bad"],
    ["array condition", [1, 2]],
  ])("returns error for %s", (_label, condition) => {
    expect(validateStepCondition(condition)).toBe("Condition must be an object with field, operator, and value.");
  });

  describe("field validation", () => {
    it("rejects unknown condition field", () => {
      const result = validateStepCondition({ field: "unknownField", operator: "gt", value: 100 });
      expect(result).toContain("Invalid condition field");
      expect(result).toContain("unknownField");
    });

    it.each([
      ["totalAmountMinor", "gt", 100],
      ["tdsAmountMinor", "lte", 500],
      ["riskSignalMaxSeverity", "eq", 3],
      ["glCodeSource", "eq", "manual"],
    ])("accepts %s", (field, operator, value) => {
      expect(validateStepCondition({ field, operator, value })).toBeNull();
    });
  });

  describe("operator validation for numeric fields", () => {
    for (const op of ["gt", "gte", "lt", "lte", "eq"]) {
      it(`accepts "${op}" for totalAmountMinor`, () => {
        expect(validateStepCondition({ field: "totalAmountMinor", operator: op, value: 100 })).toBeNull();
      });
    }

    it("rejects 'in' operator for numeric field", () => {
      const result = validateStepCondition({ field: "totalAmountMinor", operator: "in", value: [100] });
      expect(result).toContain("Invalid operator");
      expect(result).toContain("numeric field");
    });

    it("rejects unknown operator for numeric field", () => {
      const result = validateStepCondition({ field: "tdsAmountMinor", operator: "contains", value: 100 });
      expect(result).toContain("Invalid operator");
    });

    it("requires missing operator", () => {
      const result = validateStepCondition({ field: "totalAmountMinor", operator: "", value: 100 });
      expect(result).toContain("requires an operator");
    });
  });

  describe("operator validation for string fields", () => {
    it.each([
      ["eq", "manual"],
      ["in", ["manual", "auto"]],
    ])("accepts '%s' for glCodeSource", (operator, value) => {
      expect(validateStepCondition({ field: "glCodeSource", operator, value })).toBeNull();
    });

    it.each([["gt"], ["lte"]])("rejects '%s' for string field", (operator) => {
      const result = validateStepCondition({ field: "glCodeSource", operator, value: "manual" });
      expect(result).toContain("Invalid operator");
    });
  });

  describe("value type validation for numeric fields", () => {
    it.each([
      ["totalAmountMinor", "gt", "100"],
      ["tdsAmountMinor", "eq", null],
      ["riskSignalMaxSeverity", "eq", [1, 2]],
    ])("rejects non-number value for %s with operator %s", (field, operator, value) => {
      const result = validateStepCondition({ field, operator, value });
      expect(result).toContain("must be a number");
    });
  });

  describe("value type validation for string fields", () => {
    it("requires string value for eq operator on glCodeSource", () => {
      const result = validateStepCondition({ field: "glCodeSource", operator: "eq", value: 123 });
      expect(result).toContain("must be a string");
    });

    it.each([
      ["non-array value", "manual"],
      ["array with non-string elements", ["manual", 123]],
    ])("rejects in operator %s", (_label, value) => {
      const result = validateStepCondition({ field: "glCodeSource", operator: "in", value });
      expect(result).toContain("must be an array of strings");
    });

    it("accepts empty array for in operator", () => {
      expect(validateStepCondition({ field: "glCodeSource", operator: "in", value: [] })).toBeNull();
    });
  });
});

describe("PUT /admin/approval-workflow condition validation", () => {
  const workflowService = {
    getWorkflowConfig: jest.fn().mockResolvedValue(null),
    saveWorkflowConfig: jest.fn().mockResolvedValue({
      enabled: true,
      mode: "advanced",
      simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
      steps: []
    })
  };

  let handler: Function;

  beforeEach(() => {
    jest.clearAllMocks();
    const router = createApprovalWorkflowRouter(workflowService as never);
    handler = findHandler(router, "put", "/admin/approval-workflow");
  });

  it("rejects step with invalid condition field", async () => {
    const res = mockResponse();
    const req = mockRequest({
      authContext: defaultAuth,
      body: {
        enabled: true,
        mode: "advanced",
        steps: [{ order: 1, name: "S1", approverType: "any_member", rule: "any", condition: { field: "badField", operator: "gt", value: 100 } }]
      }
    });

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as Record<string, string>).message).toContain("Invalid condition field");
  });

  it("rejects step with invalid operator for numeric field", async () => {
    const res = mockResponse();
    const req = mockRequest({
      authContext: defaultAuth,
      body: {
        enabled: true,
        mode: "advanced",
        steps: [{ order: 1, name: "S1", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "in", value: [100] } }]
      }
    });

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as Record<string, string>).message).toContain("Invalid operator");
  });

  it("rejects step with non-number value for numeric field", async () => {
    const res = mockResponse();
    const req = mockRequest({
      authContext: defaultAuth,
      body: {
        enabled: true,
        mode: "advanced",
        steps: [{ order: 1, name: "S1", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: "abc" } }]
      }
    });

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as Record<string, string>).message).toContain("must be a number");
  });

  it("rejects step with wrong value type for string eq operator", async () => {
    const res = mockResponse();
    const req = mockRequest({
      authContext: defaultAuth,
      body: {
        enabled: true,
        mode: "advanced",
        steps: [{ order: 1, name: "S1", approverType: "any_member", rule: "any", condition: { field: "glCodeSource", operator: "eq", value: 42 } }]
      }
    });

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as Record<string, string>).message).toContain("must be a string");
  });

  it("includes step number in error message", async () => {
    const res = mockResponse();
    const req = mockRequest({
      authContext: defaultAuth,
      body: {
        enabled: true,
        mode: "advanced",
        steps: [
          { order: 1, name: "S1", approverType: "any_member", rule: "any" },
          { order: 2, name: "S2", approverType: "any_member", rule: "any", condition: { field: "badField", operator: "gt", value: 100 } }
        ]
      }
    });

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as Record<string, string>).message).toContain("Step 2:");
  });

  it("passes valid conditions through to saveWorkflowConfig", async () => {
    const res = mockResponse();
    const req = mockRequest({
      authContext: defaultAuth,
      body: {
        enabled: true,
        mode: "advanced",
        steps: [
          { order: 1, name: "S1", approverType: "any_member", rule: "any", condition: { field: "totalAmountMinor", operator: "gt", value: 500000 } },
          { order: 2, name: "S2", approverType: "any_member", rule: "any", condition: { field: "glCodeSource", operator: "in", value: ["manual", "override"] } }
        ]
      }
    });

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(workflowService.saveWorkflowConfig).toHaveBeenCalled();
  });

  it("skips validation for simple mode", async () => {
    const res = mockResponse();
    const req = mockRequest({
      authContext: defaultAuth,
      body: {
        enabled: true,
        mode: "simple",
        simpleConfig: { requireManagerReview: true, requireFinalSignoff: false },
        steps: [{ order: 1, name: "S1", condition: { field: "badField", operator: "gt", value: 100 } }]
      }
    });

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
    expect(workflowService.saveWorkflowConfig).toHaveBeenCalled();
  });

  it("passes steps with null conditions", async () => {
    const res = mockResponse();
    const req = mockRequest({
      authContext: defaultAuth,
      body: {
        enabled: true,
        mode: "advanced",
        steps: [{ order: 1, name: "S1", approverType: "any_member", rule: "any", condition: null }]
      }
    });

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
  });

  it("passes steps without condition property", async () => {
    const res = mockResponse();
    const req = mockRequest({
      authContext: defaultAuth,
      body: {
        enabled: true,
        mode: "advanced",
        steps: [{ order: 1, name: "S1", approverType: "any_member", rule: "any" }]
      }
    });

    await handler(req, res, jest.fn());

    expect(res.statusCode).toBe(200);
  });
});
