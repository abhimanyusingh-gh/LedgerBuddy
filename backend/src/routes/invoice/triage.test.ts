jest.mock("../../auth/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
}));

jest.mock("../../auth/requireCapability.js", () => ({
  requireCap: () => (_req: unknown, _res: unknown, next: Function) => next(),
  resolveCapabilities: jest.fn()
}));

import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";
import { createTriageRouter } from "./triage.ts";
import { TRIAGE_REJECT_REASON } from "@/types/invoice.ts";
import type { TriageService } from "@/services/invoice/triageService.ts";
import { HttpError } from "@/errors/HttpError.ts";

const nextFn = jest.fn();

beforeEach(() => {
  nextFn.mockReset();
});

function buildService(overrides: Partial<TriageService> = {}): TriageService {
  return {
    list: jest.fn(),
    assignClientOrg: jest.fn(),
    reject: jest.fn(),
    ...overrides
  } as unknown as TriageService;
}

describe("GET /invoices/triage", () => {
  it("returns the service result and forwards tenantId", async () => {
    const list = jest.fn().mockResolvedValue({ items: [{ _id: "x" }], total: 1 });
    const service = buildService({ list });
    const router = createTriageRouter(service);
    const handler = findHandler(router, "get", "/invoices/triage");
    const res = mockResponse();

    await handler(mockRequest({ authContext: defaultAuth }), res, nextFn);

    expect(list).toHaveBeenCalledWith(defaultAuth.tenantId);
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ items: [{ _id: "x" }], total: 1 });
    expect(nextFn).not.toHaveBeenCalled();
  });

  it("propagates HttpError to next()", async () => {
    const error = new HttpError("boom", 500, "boom");
    const list = jest.fn().mockRejectedValue(error);
    const service = buildService({ list });
    const router = createTriageRouter(service);
    const handler = findHandler(router, "get", "/invoices/triage");

    await handler(mockRequest({ authContext: defaultAuth }), mockResponse(), nextFn);

    expect(nextFn).toHaveBeenCalledWith(error);
  });
});

describe("PATCH /invoices/:id/assign-client-org", () => {
  it("forwards tenantId, invoiceId, and clientOrgId to the service and returns ok", async () => {
    const assignClientOrg = jest.fn().mockResolvedValue(undefined);
    const service = buildService({ assignClientOrg });
    const router = createTriageRouter(service);
    const handler = findHandler(router, "patch", "/invoices/:id/assign-client-org");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        params: { id: "inv-1" },
        body: { clientOrgId: "org-1" }
      }),
      res,
      nextFn
    );

    expect(assignClientOrg).toHaveBeenCalledWith({
      tenantId: defaultAuth.tenantId,
      invoiceId: "inv-1",
      clientOrgId: "org-1"
    });
    expect(res.jsonBody).toEqual({ ok: true });
  });

  it("passes empty-string clientOrgId when body is missing the field (service surfaces the 400)", async () => {
    const assignClientOrg = jest.fn().mockResolvedValue(undefined);
    const service = buildService({ assignClientOrg });
    const router = createTriageRouter(service);
    const handler = findHandler(router, "patch", "/invoices/:id/assign-client-org");

    await handler(
      mockRequest({ authContext: defaultAuth, params: { id: "inv-1" }, body: {} }),
      mockResponse(),
      nextFn
    );

    expect(assignClientOrg).toHaveBeenCalledWith(
      expect.objectContaining({ clientOrgId: "" })
    );
  });

  it("propagates service errors via next()", async () => {
    const error = new HttpError("nope", 409, "triage_invoice_wrong_status");
    const assignClientOrg = jest.fn().mockRejectedValue(error);
    const service = buildService({ assignClientOrg });
    const router = createTriageRouter(service);
    const handler = findHandler(router, "patch", "/invoices/:id/assign-client-org");

    await handler(
      mockRequest({
        authContext: defaultAuth,
        params: { id: "inv-1" },
        body: { clientOrgId: "org-1" }
      }),
      mockResponse(),
      nextFn
    );

    expect(nextFn).toHaveBeenCalledWith(error);
  });
});

describe("PATCH /invoices/:id/reject", () => {
  it("forwards reasonCode and notes to the service", async () => {
    const reject = jest.fn().mockResolvedValue(undefined);
    const service = buildService({ reject });
    const router = createTriageRouter(service);
    const handler = findHandler(router, "patch", "/invoices/:id/reject");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        params: { id: "inv-1" },
        body: { reasonCode: TRIAGE_REJECT_REASON.OTHER, notes: "weird" }
      }),
      res,
      nextFn
    );

    expect(reject).toHaveBeenCalledWith({
      tenantId: defaultAuth.tenantId,
      invoiceId: "inv-1",
      reasonCode: TRIAGE_REJECT_REASON.OTHER,
      notes: "weird"
    });
    expect(res.jsonBody).toEqual({ ok: true });
  });

  it("forwards reasonCode without notes when notes are absent", async () => {
    const reject = jest.fn().mockResolvedValue(undefined);
    const service = buildService({ reject });
    const router = createTriageRouter(service);
    const handler = findHandler(router, "patch", "/invoices/:id/reject");

    await handler(
      mockRequest({
        authContext: defaultAuth,
        params: { id: "inv-1" },
        body: { reasonCode: TRIAGE_REJECT_REASON.SPAM }
      }),
      mockResponse(),
      nextFn
    );

    expect(reject).toHaveBeenCalledWith({
      tenantId: defaultAuth.tenantId,
      invoiceId: "inv-1",
      reasonCode: TRIAGE_REJECT_REASON.SPAM,
      notes: undefined
    });
  });

  it("propagates 400 invalid-reason errors via next()", async () => {
    const error = new HttpError("bad", 400, "triage_reject_reason_invalid");
    const reject = jest.fn().mockRejectedValue(error);
    const service = buildService({ reject });
    const router = createTriageRouter(service);
    const handler = findHandler(router, "patch", "/invoices/:id/reject");

    await handler(
      mockRequest({
        authContext: defaultAuth,
        params: { id: "inv-1" },
        body: { reasonCode: "garbage" }
      }),
      mockResponse(),
      nextFn
    );

    expect(nextFn).toHaveBeenCalledWith(error);
  });
});
