import { requireNotViewer } from "../auth/middleware.ts";
import { mockRequest, mockResponse, defaultAuth } from "./testHelpers.ts";
import type { Request, Response } from "express";

const viewerAuth = { ...defaultAuth, role: "audit_clerk" };

describe("requireNotViewer blocks viewer on write routes", () => {
  it("returns 403 for audit_clerk role (simulates upload-csv guard)", () => {
    const req = { authContext: viewerAuth } as unknown as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();

    requireNotViewer(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for audit_clerk role (simulates unmatch guard)", () => {
    const req = { authContext: viewerAuth } as unknown as Request;
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();

    requireNotViewer(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

jest.mock("../models/BankStatement.ts");
jest.mock("../models/BankTransaction.ts");
jest.mock("../models/TenantUserRole.ts", () => {
  const actual = jest.requireActual("../models/TenantUserRole.ts");
  return {
    ...actual,
    TenantUserRoleModel: { findOne: jest.fn() }
  };
});
jest.mock("../models/TenantTcsConfig.ts");

const mockUnmatch = jest.fn();
const mockManualMatch = jest.fn();
const mockReconcileStatement = jest.fn();

jest.mock("../services/reconciliation/ReconciliationService.ts", () => ({
  ReconciliationService: jest.fn().mockImplementation(() => ({
    unmatch: mockUnmatch,
    manualMatch: mockManualMatch,
    reconcileStatement: mockReconcileStatement
  }))
}));

jest.mock("../services/reconciliation/BankStatementParser.ts", () => ({
  BankStatementParser: jest.fn().mockImplementation(() => ({
    parseCsv: jest.fn()
  }))
}));

import { createBankStatementsRouter } from "./bankStatements.ts";

function findRouteHandler(router: ReturnType<typeof createBankStatementsRouter>, method: string, path: string): Function {
  for (const layer of (router as unknown as { stack: unknown[] }).stack) {
    const l = layer as { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Function }[] } };
    if (l.route?.path === path && l.route.methods[method]) {
      const stack = l.route.stack;
      return stack[stack.length - 1].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

describe("bankStatements route handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("DELETE unmatch calls reconciler.unmatch with tenantId and txnId", async () => {
    mockUnmatch.mockResolvedValue(undefined);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "delete", "/bank-statements/transactions/:txnId/match");

    const res = mockResponse();
    await handler(
      mockRequest({ authContext: defaultAuth, params: { txnId: "txn-42" } }),
      res,
      jest.fn()
    );

    expect(mockUnmatch).toHaveBeenCalledWith("tenant-a", "txn-42");
    expect((res.jsonBody as { unmatched: boolean }).unmatched).toBe(true);
  });

  it("POST match returns 400 when invoiceId is missing from body", async () => {
    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "post", "/bank-statements/transactions/:txnId/match");

    const res = mockResponse();
    await handler(
      mockRequest({ authContext: defaultAuth, params: { txnId: "txn-42" }, body: {} }),
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { message: string }).message).toContain("invoiceId");
  });
});
