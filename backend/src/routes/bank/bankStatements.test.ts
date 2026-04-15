import { requireNotViewer } from "@/auth/middleware.ts";
import { mockRequest, mockResponse, defaultAuth } from "@/routes/testHelpers.ts";
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

const mockStatementFind = jest.fn();
const mockStatementFindOne = jest.fn();
const mockStatementCountDocuments = jest.fn();
const mockStatementUpdateOne = jest.fn();

jest.mock("@/models/bank/BankStatement.ts", () => ({
  BankStatementModel: {
    find: (...args: unknown[]) => mockStatementFind(...args),
    findOne: (...args: unknown[]) => mockStatementFindOne(...args),
    countDocuments: (...args: unknown[]) => mockStatementCountDocuments(...args),
    updateOne: (...args: unknown[]) => mockStatementUpdateOne(...args)
  }
}));

const mockTransactionFind = jest.fn();
const mockTransactionCountDocuments = jest.fn();
const mockTransactionUpdateOne = jest.fn();

jest.mock("@/models/bank/BankTransaction.ts", () => {
  const actual = jest.requireActual("@/models/bank/BankTransaction.ts");
  return {
    BANK_TRANSACTION_MATCH_STATUS: actual.BANK_TRANSACTION_MATCH_STATUS,
    BankTransactionModel: {
      find: (...args: unknown[]) => mockTransactionFind(...args),
      countDocuments: (...args: unknown[]) => mockTransactionCountDocuments(...args),
      updateOne: (...args: unknown[]) => mockTransactionUpdateOne(...args)
    }
  };
});

const mockInvoiceFind = jest.fn();

jest.mock("@/models/invoice/Invoice.ts", () => ({
  InvoiceModel: {
    find: (...args: unknown[]) => mockInvoiceFind(...args)
  }
}));

jest.mock("@/models/core/TenantUserRole.ts", () => {
  const actual = jest.requireActual("@/models/core/TenantUserRole.ts");
  return {
    ...actual,
    TenantUserRoleModel: { findOne: jest.fn() }
  };
});
jest.mock("@/models/integration/TenantTcsConfig.ts");

const mockUnmatch = jest.fn();
const mockManualMatch = jest.fn();
const mockReconcileStatement = jest.fn();

jest.mock("@/services/bank/ReconciliationService.ts", () => ({
  ReconciliationService: jest.fn().mockImplementation(() => ({
    unmatch: mockUnmatch,
    manualMatch: mockManualMatch,
    reconcileStatement: mockReconcileStatement
  }))
}));

jest.mock("@/ai/extractors/bank/BankStatementExtractionPipeline.ts", () => ({
  BankStatementExtractionPipeline: jest.fn().mockImplementation(() => ({
    parseCsv: jest.fn(),
    parsePdf: jest.fn()
  }))
}));

jest.mock("@/ai/extractors/bank/BankStatementParseProgress.ts", () => {
  const actual = jest.requireActual("@/ai/extractors/bank/BankStatementParseProgress.ts");
  return actual;
});

import { createBankStatementsRouter } from "@/routes/bank/bankStatements.ts";

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

function chainable() {
  const chain: Record<string, Function> = {};
  chain.sort = jest.fn().mockReturnValue(chain);
  chain.skip = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.lean = jest.fn().mockResolvedValue([]);
  return chain;
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

describe("GET /bank-statements pagination and filtering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns paginated statements with total, page, limit", async () => {
    const items = [{ _id: "s1", bankName: "HDFC", periodFrom: "2024-02-01", periodTo: "2024-02-28" }];
    const chain = chainable();
    chain.lean = jest.fn().mockResolvedValue(items);
    mockStatementFind.mockReturnValue(chain);
    mockStatementCountDocuments.mockResolvedValue(1);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth, query: { page: "1", limit: "20" } }),
      res,
      jest.fn()
    );

    const body = res.jsonBody as { items: unknown[]; total: number; page: number; limit: number };
    expect(body.items).toEqual(items);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  it("filters statements by period overlap (statement Feb 1-28, filter Feb 2-16 matches)", async () => {
    const chain = chainable();
    chain.lean = jest.fn().mockResolvedValue([]);
    mockStatementFind.mockReturnValue(chain);
    mockStatementCountDocuments.mockResolvedValue(0);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        query: { periodFrom: "2024-02-02", periodTo: "2024-02-16" }
      }),
      res,
      jest.fn()
    );

    const findQuery = mockStatementFind.mock.calls[0][0];
    expect(findQuery.periodTo).toEqual({ $gte: "2024-02-02" });
    expect(findQuery.periodFrom).toEqual({ $lte: "2024-02-16" });
  });

  it("filters statements by period — no overlap (statement Feb 1-28, filter Mar 1-15)", async () => {
    const chain = chainable();
    chain.lean = jest.fn().mockResolvedValue([]);
    mockStatementFind.mockReturnValue(chain);
    mockStatementCountDocuments.mockResolvedValue(0);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        query: { periodFrom: "2024-03-01", periodTo: "2024-03-15" }
      }),
      res,
      jest.fn()
    );

    const findQuery = mockStatementFind.mock.calls[0][0];
    expect(findQuery.periodTo).toEqual({ $gte: "2024-03-01" });
    expect(findQuery.periodFrom).toEqual({ $lte: "2024-03-15" });
  });

  it("filters statements by accountName", async () => {
    const chain = chainable();
    chain.lean = jest.fn().mockResolvedValue([]);
    mockStatementFind.mockReturnValue(chain);
    mockStatementCountDocuments.mockResolvedValue(0);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        query: { accountName: "HDFC XX1234" }
      }),
      res,
      jest.fn()
    );

    const findQuery = mockStatementFind.mock.calls[0][0];
    expect(findQuery.bankName).toBe("HDFC");
    expect(findQuery.accountNumberMasked).toBe("XX1234");
  });
});

describe("GET /bank-statements/:id/transactions filtering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("filters transactions by text search (case-insensitive)", async () => {
    const chain = chainable();
    chain.lean = jest.fn().mockResolvedValue([]);
    mockTransactionFind.mockReturnValue(chain);
    mockTransactionCountDocuments.mockResolvedValue(0);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/:id/transactions");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        params: { id: "s1" },
        query: { search: "Office Rent" }
      }),
      res,
      jest.fn()
    );

    const findQuery = mockTransactionFind.mock.calls[0][0];
    expect(findQuery.$or).toEqual([
      { description: { $regex: "Office Rent", $options: "i" } },
      { reference: { $regex: "Office Rent", $options: "i" } }
    ]);
  });

  it("filters transactions by date range", async () => {
    const chain = chainable();
    chain.lean = jest.fn().mockResolvedValue([]);
    mockTransactionFind.mockReturnValue(chain);
    mockTransactionCountDocuments.mockResolvedValue(0);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/:id/transactions");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        params: { id: "s1" },
        query: { dateFrom: "2024-02-05", dateTo: "2024-02-20" }
      }),
      res,
      jest.fn()
    );

    const findQuery = mockTransactionFind.mock.calls[0][0];
    expect(findQuery.date).toEqual({ $gte: new Date("2024-02-05"), $lte: new Date("2024-02-20") });
  });

  it("filters transactions by matchStatus", async () => {
    const chain = chainable();
    chain.lean = jest.fn().mockResolvedValue([]);
    mockTransactionFind.mockReturnValue(chain);
    mockTransactionCountDocuments.mockResolvedValue(0);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/:id/transactions");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        params: { id: "s1" },
        query: { matchStatus: "unmatched" }
      }),
      res,
      jest.fn()
    );

    const findQuery = mockTransactionFind.mock.calls[0][0];
    expect(findQuery.matchStatus).toBe("unmatched");
  });

  it("paginates transactions with page and limit", async () => {
    const txns = Array.from({ length: 5 }, (_, i) => ({ _id: `t${i}`, description: `Txn ${i}` }));
    const chain = chainable();
    chain.lean = jest.fn().mockResolvedValue(txns);
    mockTransactionFind.mockReturnValue(chain);
    mockTransactionCountDocuments.mockResolvedValue(25);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/:id/transactions");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        params: { id: "s1" },
        query: { page: "2", limit: "5" }
      }),
      res,
      jest.fn()
    );

    expect(chain.skip).toHaveBeenCalledWith(5);
    expect(chain.limit).toHaveBeenCalledWith(5);
    const body = res.jsonBody as { items: unknown[]; total: number; page: number; limit: number };
    expect(body.total).toBe(25);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(5);
    expect(body.items).toHaveLength(5);
  });
});

describe("GET /bank-statements/account-names", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns deduplicated and sorted account names", async () => {
    const statements = [
      { bankName: "HDFC", accountNumberMasked: "XX1234" },
      { bankName: "HDFC", accountNumberMasked: "XX1234" },
      { bankName: "ICICI", accountNumberMasked: "XX5678" },
      { bankName: "Axis", accountNumberMasked: null }
    ];
    const chain = chainable();
    chain.lean = jest.fn().mockResolvedValue(statements);
    mockStatementFind.mockReturnValue(chain);

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/account-names");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth }),
      res,
      jest.fn()
    );

    const body = res.jsonBody as { items: Array<{ bankName: string; accountNumberMasked: string; label: string }> };
    expect(body.items).toHaveLength(3);
    expect(body.items[0].label).toBe("Axis");
    expect(body.items[1].label).toBe("HDFC XX1234");
    expect(body.items[2].label).toBe("ICICI XX5678");
  });
});

describe("GET /bank-statements/parse/sse", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sets SSE headers and sends initial keepalive comment", () => {
    jest.useFakeTimers();
    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/parse/sse");
    const req = mockRequest({ authContext: defaultAuth });
    const res = mockResponse();

    handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.headers as Record<string, string>)["Content-Type"]).toBe("text/event-stream");
    expect((res.headers as Record<string, string>)["Cache-Control"]).toBe("no-cache, no-transform");
    expect((res.written as string[]).length).toBeGreaterThanOrEqual(1);
    expect((res.written as string[])[0]).toBe(":\n\n");

    (req as ReturnType<typeof mockRequest>)._emit("close");
    jest.useRealTimers();
  });

  it("sends keepalive heartbeat at configured interval", () => {
    jest.useFakeTimers();

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/parse/sse");
    const req = mockRequest({ authContext: defaultAuth });
    const res = mockResponse();

    handler(req, res);

    const initialWrites = (res.written as string[]).length;

    jest.advanceTimersByTime(30_000);

    expect((res.written as string[]).length).toBeGreaterThan(initialWrites);
    const heartbeats = (res.written as string[]).filter(w => w === ":\n\n");
    expect(heartbeats.length).toBeGreaterThanOrEqual(2);

    (req as ReturnType<typeof mockRequest>)._emit("close");
    jest.useRealTimers();
  });

  it("cleans up on client disconnect", () => {
    jest.useFakeTimers();

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/parse/sse");
    const req = mockRequest({ authContext: defaultAuth });
    const res = mockResponse();

    handler(req, res);

    (req as ReturnType<typeof mockRequest>)._emit("close");

    const countBefore = (res.written as string[]).length;
    jest.advanceTimersByTime(60_000);
    expect((res.written as string[]).length).toBe(countBefore);

    jest.useRealTimers();
  });
});

describe("BankStatementParseProgress broadcast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("broadcasts progress events to SSE subscribers", () => {
    const { BankStatementParseProgress } = jest.requireActual("@/ai/extractors/bank/BankStatementParseProgress.ts");
    const progress = new BankStatementParseProgress();

    const req = mockRequest({ authContext: defaultAuth });
    const res = mockResponse();
    progress.addSubscriber("tenant-a", res as unknown as import("express").Response, req as unknown as import("express").Request);

    progress.broadcast("tenant-a", { type: "start", fileName: "test.pdf" });

    const dataWrites = (res.written as string[]).filter((w: string) => w.startsWith("data:"));
    expect(dataWrites.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(dataWrites[dataWrites.length - 1].replace("data: ", "").replace("\n\n", ""));
    expect(parsed.type).toBe("start");
    expect(parsed.fileName).toBe("test.pdf");

    (req as ReturnType<typeof mockRequest>)._emit("close");
  });

  it("sends progress with chunk info", () => {
    const { BankStatementParseProgress } = jest.requireActual("@/ai/extractors/bank/BankStatementParseProgress.ts");
    const progress = new BankStatementParseProgress();

    const req = mockRequest({ authContext: defaultAuth });
    const res = mockResponse();
    progress.addSubscriber("tenant-a", res as unknown as import("express").Response, req as unknown as import("express").Request);

    progress.broadcast("tenant-a", {
      type: "progress",
      stage: "slm-chunk",
      chunk: 2,
      totalChunks: 5,
      transactionsSoFar: 12
    });

    const dataWrites = (res.written as string[]).filter((w: string) => w.startsWith("data:"));
    const parsed = JSON.parse(dataWrites[dataWrites.length - 1].replace("data: ", "").replace("\n\n", ""));
    expect(parsed.stage).toBe("slm-chunk");
    expect(parsed.chunk).toBe(2);
    expect(parsed.totalChunks).toBe(5);
    expect(parsed.transactionsSoFar).toBe(12);

    (req as ReturnType<typeof mockRequest>)._emit("close");
  });

  it("sends complete event with transaction count and warnings", () => {
    const { BankStatementParseProgress } = jest.requireActual("@/ai/extractors/bank/BankStatementParseProgress.ts");
    const progress = new BankStatementParseProgress();

    const req = mockRequest({ authContext: defaultAuth });
    const res = mockResponse();
    progress.addSubscriber("tenant-a", res as unknown as import("express").Response, req as unknown as import("express").Request);

    progress.broadcast("tenant-a", {
      type: "complete",
      statementId: "stmt-1",
      transactionCount: 42,
      warnings: ["some warning"]
    });

    const dataWrites = (res.written as string[]).filter((w: string) => w.startsWith("data:"));
    const parsed = JSON.parse(dataWrites[dataWrites.length - 1].replace("data: ", "").replace("\n\n", ""));
    expect(parsed.type).toBe("complete");
    expect(parsed.transactionCount).toBe(42);
    expect(parsed.warnings).toEqual(["some warning"]);

    (req as ReturnType<typeof mockRequest>)._emit("close");
  });

  it("sends error event", () => {
    const { BankStatementParseProgress } = jest.requireActual("@/ai/extractors/bank/BankStatementParseProgress.ts");
    const progress = new BankStatementParseProgress();

    const req = mockRequest({ authContext: defaultAuth });
    const res = mockResponse();
    progress.addSubscriber("tenant-a", res as unknown as import("express").Response, req as unknown as import("express").Request);

    progress.broadcast("tenant-a", {
      type: "error",
      message: "SLM not available"
    });

    const dataWrites = (res.written as string[]).filter((w: string) => w.startsWith("data:"));
    const parsed = JSON.parse(dataWrites[dataWrites.length - 1].replace("data: ", "").replace("\n\n", ""));
    expect(parsed.type).toBe("error");
    expect(parsed.message).toBe("SLM not available");

    (req as ReturnType<typeof mockRequest>)._emit("close");
  });
});

describe("GET /bank-statements/:id/matches", () => {
  function txnChain(items: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.sort = jest.fn().mockReturnValue(chain);
    chain.lean = jest.fn().mockResolvedValue(items);
    return chain;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when statement is not found", async () => {
    mockStatementFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/:id/matches");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth, params: { id: "stmt-99" } }),
      res,
      jest.fn()
    );

    expect(res.statusCode).toBe(404);
  });

  it("returns all transactions with summary counts when all unmatched", async () => {
    mockStatementFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: "stmt-1", tenantId: "tenant-a" }) });
    mockTransactionFind.mockReturnValue(txnChain([
      { _id: "t1", date: "2024-02-05", description: "Payment", debitMinor: 100000, matchStatus: "unmatched" },
      { _id: "t2", date: "2024-02-10", description: "Credit", creditMinor: 50000, matchStatus: "unmatched" }
    ]));
    mockInvoiceFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/:id/matches");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth, params: { id: "stmt-1" } }),
      res,
      jest.fn()
    );

    const body = res.jsonBody as { items: unknown[]; summary: { totalTransactions: number; matched: number; suggested: number; unmatched: number } };
    expect(body.items).toHaveLength(2);
    expect(body.summary.totalTransactions).toBe(2);
    expect(body.summary.matched).toBe(0);
    expect(body.summary.unmatched).toBe(2);
  });

  it("embeds invoice data for matched transactions and counts correctly", async () => {
    mockStatementFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: "stmt-1" }) });
    mockTransactionFind.mockReturnValue(txnChain([
      { _id: "t1", date: "2024-02-05", description: "Payment A", debitMinor: 100000, matchStatus: "matched", matchedInvoiceId: "inv-1", matchConfidence: 90 },
      { _id: "t2", date: "2024-02-10", description: "Payment B", debitMinor: 50000, matchStatus: "suggested", matchedInvoiceId: "inv-2", matchConfidence: 40 },
      { _id: "t3", date: "2024-02-15", description: "Misc", debitMinor: 20000, matchStatus: "unmatched" }
    ]));
    mockInvoiceFind.mockReturnValue({ lean: jest.fn().mockResolvedValue([
      { _id: "inv-1", status: "AWAITING_APPROVAL", parsed: { invoiceNumber: "INV-001", vendorName: "ACME", totalAmountMinor: 100000, invoiceDate: new Date("2024-02-01") } },
      { _id: "inv-2", status: "PENDING", parsed: { invoiceNumber: "INV-002", vendorName: "Corp B", totalAmountMinor: 50000, invoiceDate: new Date("2024-02-08") } }
    ]) });

    const router = createBankStatementsRouter();
    const handler = findRouteHandler(router, "get", "/bank-statements/:id/matches");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth, params: { id: "stmt-1" } }),
      res,
      jest.fn()
    );

    const body = res.jsonBody as {
      items: Array<{ _id: string; matchStatus: string; invoice: { invoiceNumber: string | null } | null }>;
      summary: { matched: number; suggested: number; unmatched: number };
    };
    expect(body.summary.matched).toBe(1);
    expect(body.summary.suggested).toBe(1);
    expect(body.summary.unmatched).toBe(1);

    const t1 = body.items.find((i) => i._id === "t1");
    expect(t1?.invoice?.invoiceNumber).toBe("INV-001");

    const t3 = body.items.find((i) => i._id === "t3");
    expect(t3?.invoice).toBeNull();
  });
});
