jest.mock("../../models/invoice/Invoice.js");
jest.mock("../../models/compliance/GlCodeMaster.js");
jest.mock("../../models/integration/TenantTcsConfig.js");
jest.mock("../../utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));
jest.mock("../compliance/TdsCalculationService.js", () => ({
  TdsCalculationService: jest.fn().mockImplementation(() => ({
    computeTds: jest.fn().mockResolvedValue({
      tds: { section: null, confidence: "low" },
      riskSignals: []
    })
  }))
}));

import { Types } from "mongoose";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { GlCodeMasterModel } from "@/models/compliance/GlCodeMaster.js";
import { TenantTcsConfigModel } from "@/models/integration/TenantTcsConfig.js";
import { InvoiceService } from "@/services/invoice/invoiceService.js";
import type { AuthenticatedRequestContext } from "@/types/auth.js";

const TENANT_ID = "65f0000000000000000000b1";

function makeAuth(overrides: Partial<AuthenticatedRequestContext> = {}): AuthenticatedRequestContext {
  return {
    userId: "user-1",
    email: "user@test.com",
    tenantId: TENANT_ID,
    tenantName: "Test Tenant",
    onboardingStatus: "completed",
    role: "TENANT_ADMIN",
    isPlatformAdmin: false,
    ...overrides
  };
}

function makeObjectId() {
  return new Types.ObjectId().toString();
}

describe("InvoiceService.retryInvoices", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("includes PENDING in the allowed status list", async () => {
    const updateManyMock = jest.spyOn(InvoiceModel, "updateMany").mockResolvedValue({ modifiedCount: 1 } as never);
    const service = new InvoiceService();
    const invoiceId = makeObjectId();

    await service.retryInvoices([invoiceId], makeAuth());

    const filter = updateManyMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const statusFilter = (filter.status as { $in: string[] }).$in;
    expect(statusFilter).toContain("PENDING");
  });

  it("includes FAILED_OCR, FAILED_PARSE, NEEDS_REVIEW, PARSED in the allowed status list", async () => {
    const updateManyMock = jest.spyOn(InvoiceModel, "updateMany").mockResolvedValue({ modifiedCount: 1 } as never);
    const service = new InvoiceService();
    const invoiceId = makeObjectId();

    await service.retryInvoices([invoiceId], makeAuth());

    const filter = updateManyMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const statusFilter = (filter.status as { $in: string[] }).$in;
    expect(statusFilter).toContain("FAILED_OCR");
    expect(statusFilter).toContain("FAILED_PARSE");
    expect(statusFilter).toContain("NEEDS_REVIEW");
    expect(statusFilter).toContain("PARSED");
  });

  it("sets status to PENDING on retry", async () => {
    const updateManyMock = jest.spyOn(InvoiceModel, "updateMany").mockResolvedValue({ modifiedCount: 1 } as never);
    const service = new InvoiceService();
    const invoiceId = makeObjectId();

    await service.retryInvoices([invoiceId], makeAuth());

    const update = updateManyMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect((update.$set as Record<string, unknown>).status).toBe("PENDING");
  });

  it("returns 0 and does not call updateMany when ids list is empty", async () => {
    const updateManyMock = jest.spyOn(InvoiceModel, "updateMany").mockResolvedValue({ modifiedCount: 0 } as never);
    const service = new InvoiceService();

    const count = await service.retryInvoices([], makeAuth());

    expect(count).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("filters out invalid ObjectIds before calling updateMany", async () => {
    const updateManyMock = jest.spyOn(InvoiceModel, "updateMany").mockResolvedValue({ modifiedCount: 0 } as never);
    const service = new InvoiceService();

    const count = await service.retryInvoices(["not-an-object-id"], makeAuth());

    expect(count).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});

describe("InvoiceService.listInvoices — comma-separated status filter", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  function mockListQuery(items: unknown[] = []) {
    (InvoiceModel.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(items)
    });
    (InvoiceModel.aggregate as jest.Mock).mockResolvedValue([{
      totalAll: [{ n: 0 }], approved: [], pending: [], failed: [], needsReview: [],
      parsed: [], awaitingApproval: [], failedOcr: [], failedParse: [], exported: [],
      duplicateHashes: [], duplicates: []
    }]);
  }

  it("uses $in operator when multiple comma-separated statuses are given", async () => {
    mockListQuery();
    const findMock = InvoiceModel.find as jest.Mock;
    const service = new InvoiceService();

    await service.listInvoices({ tenantId: TENANT_ID, status: "FAILED_OCR,FAILED_PARSE", page: 1, limit: 20 });

    const queryArg = findMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(queryArg.status).toEqual({ $in: ["FAILED_OCR", "FAILED_PARSE"] });
  });

  it("uses a plain string value when only one status is given", async () => {
    mockListQuery();
    const findMock = InvoiceModel.find as jest.Mock;
    const service = new InvoiceService();

    await service.listInvoices({ tenantId: TENANT_ID, status: "PARSED", page: 1, limit: 20 });

    const queryArg = findMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(queryArg.status).toBe("PARSED");
  });

  it("omits status filter entirely when no status param is provided", async () => {
    mockListQuery();
    const findMock = InvoiceModel.find as jest.Mock;
    const service = new InvoiceService();

    await service.listInvoices({ tenantId: TENANT_ID, page: 1, limit: 20 });

    const queryArg = findMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(queryArg.status).toBeUndefined();
  });

  it("trims whitespace from each status in the comma list", async () => {
    mockListQuery();
    const findMock = InvoiceModel.find as jest.Mock;
    const service = new InvoiceService();

    await service.listInvoices({ tenantId: TENANT_ID, status: "FAILED_OCR , FAILED_PARSE", page: 1, limit: 20 });

    const queryArg = findMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(queryArg.status).toEqual({ $in: ["FAILED_OCR", "FAILED_PARSE"] });
  });
});

describe("InvoiceService.retriggerCompliance — GL category lookup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (TenantTcsConfigModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    });
  });

  function makeInvoiceDoc(status = "PARSED") {
    return {
      status,
      toObject: jest.fn().mockReturnValue({
        status,
        parsed: { totalAmountMinor: 10000, currency: "INR" },
        compliance: {}
      }),
      set: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined)
    };
  }

  it("queries GlCodeMasterModel using tenantId, code, and isActive when retriggering compliance", async () => {
    const invoiceId = makeObjectId();
    const mockInvoice = makeInvoiceDoc();

    jest.spyOn(InvoiceModel, "findOne").mockResolvedValue(mockInvoice as never);
    (GlCodeMasterModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ category: "Professional Services" })
    });

    const service = new InvoiceService();
    await service.retriggerCompliance(invoiceId, TENANT_ID, "GL001", "Professional Fees");

    expect(GlCodeMasterModel.findOne).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      code: "GL001",
      isActive: true
    });
  });

  it("falls back to the GL code as category when no GlCodeMaster document is found", async () => {
    const invoiceId = makeObjectId();
    const mockInvoice = makeInvoiceDoc();

    jest.spyOn(InvoiceModel, "findOne").mockResolvedValue(mockInvoice as never);
    (GlCodeMasterModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    });

    const service = new InvoiceService();
    await service.retriggerCompliance(invoiceId, TENANT_ID, "GL999", "Unknown GL");

    expect(GlCodeMasterModel.findOne).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      code: "GL999",
      isActive: true
    });
    expect(mockInvoice.save).toHaveBeenCalled();
  });

  it("throws InvoiceUpdateError with 400 for invalid invoiceId", async () => {
    const service = new InvoiceService();
    await expect(service.retriggerCompliance("not-an-id", TENANT_ID, "GL001", "Fees")).rejects.toMatchObject({
      statusCode: 400
    });
  });

  it("throws InvoiceUpdateError with 404 when invoice is not found", async () => {
    jest.spyOn(InvoiceModel, "findOne").mockResolvedValue(null as never);
    const service = new InvoiceService();
    await expect(service.retriggerCompliance(makeObjectId(), TENANT_ID, "GL001", "Fees")).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("throws InvoiceUpdateError with 403 when invoice is EXPORTED", async () => {
    const mockInvoice = makeInvoiceDoc("EXPORTED");
    jest.spyOn(InvoiceModel, "findOne").mockResolvedValue(mockInvoice as never);
    const service = new InvoiceService();
    await expect(service.retriggerCompliance(makeObjectId(), TENANT_ID, "GL001", "Fees")).rejects.toMatchObject({
      statusCode: 403
    });
  });
});
