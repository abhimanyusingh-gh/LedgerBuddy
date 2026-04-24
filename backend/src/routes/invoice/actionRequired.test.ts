jest.mock("../../auth/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
}));

const fetchActionRequiredMock = jest.fn();

jest.mock("../../services/invoice/actionRequired.js", () => {
  const actual = jest.requireActual<typeof import("../../services/invoice/actionRequired.ts")>(
    "../../services/invoice/actionRequired.ts"
  );
  return {
    ...actual,
    fetchActionRequired: (...args: unknown[]) => fetchActionRequiredMock(...args)
  };
});

import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";
import { createActionRequiredRouter } from "./actionRequired.ts";
import {
  ACTION_REASON,
  ACTION_REQUIRED_DEFAULT_LIMIT,
  ACTION_REQUIRED_MAX_LIMIT,
  emptyReasonCounts
} from "@/services/invoice/actionRequired.ts";
import { encodeActionRequiredCursor } from "@/services/invoice/actionRequiredCursor.ts";

const nextFn = jest.fn();

beforeEach(() => {
  fetchActionRequiredMock.mockReset();
  nextFn.mockReset();
});

describe("GET /invoices/action-required", () => {
  it("defaults limit to 50 and passes tenantId from auth", async () => {
    fetchActionRequiredMock.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      totalByReason: emptyReasonCounts(),
      total: 0
    });

    const router = createActionRequiredRouter();
    const handler = findHandler(router, "get", "/invoices/action-required");
    const res = mockResponse();

    await handler(mockRequest({ authContext: defaultAuth, query: {} }), res, nextFn);

    expect(fetchActionRequiredMock).toHaveBeenCalledWith({
      tenantId: defaultAuth.tenantId,
      limit: ACTION_REQUIRED_DEFAULT_LIMIT,
      cursor: null
    });
    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as Record<string, unknown>;
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.total).toBe(0);
    expect(body.totalByReason).toEqual(emptyReasonCounts());
  });

  it("caps limit at the documented maximum", async () => {
    fetchActionRequiredMock.mockResolvedValueOnce({
      items: [], nextCursor: null, totalByReason: emptyReasonCounts(), total: 0
    });
    const router = createActionRequiredRouter();
    const handler = findHandler(router, "get", "/invoices/action-required");

    await handler(mockRequest({ authContext: defaultAuth, query: { limit: "9999" } }), mockResponse(), nextFn);

    expect(fetchActionRequiredMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: ACTION_REQUIRED_MAX_LIMIT
    }));
  });

  it.each([
    ["negative", "-5"],
    ["zero", "0"],
    ["non-numeric", "abc"]
  ])("%s limit falls back to default", async (_label, raw) => {
    fetchActionRequiredMock.mockResolvedValueOnce({
      items: [], nextCursor: null, totalByReason: emptyReasonCounts(), total: 0
    });
    const router = createActionRequiredRouter();
    const handler = findHandler(router, "get", "/invoices/action-required");

    await handler(mockRequest({ authContext: defaultAuth, query: { limit: raw } }), mockResponse(), nextFn);

    expect(fetchActionRequiredMock).toHaveBeenCalledWith(expect.objectContaining({
      limit: ACTION_REQUIRED_DEFAULT_LIMIT
    }));
  });

  it("decodes valid cursor and passes it through", async () => {
    fetchActionRequiredMock.mockResolvedValueOnce({
      items: [], nextCursor: null, totalByReason: emptyReasonCounts(), total: 0
    });
    const router = createActionRequiredRouter();
    const handler = findHandler(router, "get", "/invoices/action-required");

    const cursor = {
      lastSeverity: 70,
      lastCreatedAt: "2026-04-22T12:00:00.000Z",
      lastInvoiceId: "507f1f77bcf86cd799439011"
    };
    const encoded = encodeActionRequiredCursor(cursor);

    await handler(
      mockRequest({ authContext: defaultAuth, query: { cursor: encoded } }),
      mockResponse(),
      nextFn
    );

    expect(fetchActionRequiredMock).toHaveBeenCalledWith(expect.objectContaining({ cursor }));
  });

  it("returns 400 on malformed cursor", async () => {
    const router = createActionRequiredRouter();
    const handler = findHandler(router, "get", "/invoices/action-required");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth, query: { cursor: "garbage!!" } }),
      res,
      nextFn
    );

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { message: string }).message).toMatch(/cursor/i);
    expect(fetchActionRequiredMock).not.toHaveBeenCalled();
  });

  it("encodes nextCursor before sending it out", async () => {
    fetchActionRequiredMock.mockResolvedValueOnce({
      items: [{
        invoiceId: "507f1f77bcf86cd799439011",
        reason: ACTION_REASON.FailedOcr,
        severity: 100,
        vendorName: "Acme",
        amountMinor: 12345,
        createdAt: "2026-04-22T12:00:00.000Z"
      }],
      nextCursor: {
        lastSeverity: 100,
        lastCreatedAt: "2026-04-22T12:00:00.000Z",
        lastInvoiceId: "507f1f77bcf86cd799439011"
      },
      totalByReason: { ...emptyReasonCounts(), [ACTION_REASON.FailedOcr]: 5 },
      total: 5
    });

    const router = createActionRequiredRouter();
    const handler = findHandler(router, "get", "/invoices/action-required");
    const res = mockResponse();

    await handler(mockRequest({ authContext: defaultAuth, query: {} }), res, nextFn);

    const body = res.jsonBody as { nextCursor: string | null };
    expect(typeof body.nextCursor).toBe("string");
    expect(body.nextCursor).not.toMatch(/[+/=]/);
  });
});
