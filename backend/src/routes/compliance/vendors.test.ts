import { createVendorsRouter } from "@/routes/compliance/vendors.ts";
import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.ts";
import { InvoiceModel } from "@/models/invoice/Invoice.ts";

jest.mock("../../models/compliance/VendorMaster.ts");
jest.mock("../../models/invoice/Invoice.ts");
jest.mock("../../models/core/TenantUserRole.ts", () => {
  const actual = jest.requireActual("../../models/core/TenantUserRole.ts");
  return {
    ...actual,
    TenantUserRoleModel: {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) })
    }
  };
});
jest.mock("../../models/integration/TenantComplianceConfig.ts", () => ({
  TenantComplianceConfigModel: {
    findOne: jest.fn(() => ({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) })
    }))
  }
}));

describe("vendors routes", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("PATCH /vendors/:id", () => {
    function setupVendorMock(vendor: Record<string, unknown> | null) {
      const saveFn = jest.fn().mockResolvedValue(undefined);
      const setFn = jest.fn();
      if (vendor) {
        (VendorMasterModel.findOne as jest.Mock)
          .mockResolvedValueOnce({ ...vendor, set: setFn, save: saveFn })
          .mockReturnValue({ lean: jest.fn().mockResolvedValue(vendor) });
      } else {
        (VendorMasterModel.findOne as jest.Mock).mockResolvedValueOnce(null);
      }
      return { saveFn, setFn };
    }

    it("returns 404 when vendor does not exist", async () => {
      setupVendorMock(null);
      const router = createVendorsRouter();
      const handler = findHandler(router, "patch", "/vendors/:id");
      const req = mockRequest({
        authContext: defaultAuth,
        params: { id: "nonexistent" },
        body: { msme: { agreedPaymentDays: 30 } }
      });
      const res = mockResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(404);
    });

    it("updates agreedPaymentDays successfully", async () => {
      const vendor = {
        _id: "v1",
        tenantId: "tenant-a",
        vendorFingerprint: "fp-1",
        msme: { classification: "micro", agreedPaymentDays: null }
      };
      const { saveFn, setFn } = setupVendorMock(vendor);
      (InvoiceModel.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([])
      });

      const router = createVendorsRouter();
      const handler = findHandler(router, "patch", "/vendors/:id");
      const req = mockRequest({
        authContext: defaultAuth,
        params: { id: "v1" },
        body: { msme: { agreedPaymentDays: 30 } }
      });
      const res = mockResponse();

      await handler(req, res, jest.fn());

      expect(setFn).toHaveBeenCalledWith("msme.agreedPaymentDays", 30);
      expect(saveFn).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it("rejects non-integer agreedPaymentDays", async () => {
      const vendor = { _id: "v1", tenantId: "tenant-a", vendorFingerprint: "fp-1", msme: {} };
      setupVendorMock(vendor);

      const router = createVendorsRouter();
      const handler = findHandler(router, "patch", "/vendors/:id");
      const req = mockRequest({
        authContext: defaultAuth,
        params: { id: "v1" },
        body: { msme: { agreedPaymentDays: 2.5 } }
      });
      const res = mockResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as Record<string, string>).message).toContain("integer");
    });

    it("rejects agreedPaymentDays below 1", async () => {
      const vendor = { _id: "v1", tenantId: "tenant-a", vendorFingerprint: "fp-1", msme: {} };
      setupVendorMock(vendor);

      const router = createVendorsRouter();
      const handler = findHandler(router, "patch", "/vendors/:id");
      const req = mockRequest({
        authContext: defaultAuth,
        params: { id: "v1" },
        body: { msme: { agreedPaymentDays: 0 } }
      });
      const res = mockResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);
    });

    it("rejects agreedPaymentDays above 365", async () => {
      const vendor = { _id: "v1", tenantId: "tenant-a", vendorFingerprint: "fp-1", msme: {} };
      setupVendorMock(vendor);

      const router = createVendorsRouter();
      const handler = findHandler(router, "patch", "/vendors/:id");
      const req = mockRequest({
        authContext: defaultAuth,
        params: { id: "v1" },
        body: { msme: { agreedPaymentDays: 400 } }
      });
      const res = mockResponse();

      await handler(req, res, jest.fn());

      expect(res.statusCode).toBe(400);
    });

    it("allows null to clear agreedPaymentDays", async () => {
      const vendor = {
        _id: "v1",
        tenantId: "tenant-a",
        vendorFingerprint: "fp-1",
        msme: { classification: "micro", agreedPaymentDays: 30 }
      };
      const { saveFn, setFn } = setupVendorMock(vendor);
      (InvoiceModel.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([])
      });

      const router = createVendorsRouter();
      const handler = findHandler(router, "patch", "/vendors/:id");
      const req = mockRequest({
        authContext: defaultAuth,
        params: { id: "v1" },
        body: { msme: { agreedPaymentDays: null } }
      });
      const res = mockResponse();

      await handler(req, res, jest.fn());

      expect(setFn).toHaveBeenCalledWith("msme.agreedPaymentDays", null);
      expect(saveFn).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
    });

    it("recomputes paymentDeadline on unpaid invoices", async () => {
      const vendor = {
        _id: "v1",
        tenantId: "tenant-a",
        vendorFingerprint: "fp-1",
        msme: { classification: "micro", agreedPaymentDays: 30 }
      };
      const { saveFn } = setupVendorMock(vendor);
      const invoiceDate = new Date("2026-03-01");
      (InvoiceModel.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: "inv-1", parsed: { invoiceDate: invoiceDate.toISOString() } }
        ])
      });
      (InvoiceModel.bulkWrite as jest.Mock).mockResolvedValue({});

      const router = createVendorsRouter();
      const handler = findHandler(router, "patch", "/vendors/:id");
      const req = mockRequest({
        authContext: defaultAuth,
        params: { id: "v1" },
        body: { msme: { agreedPaymentDays: 30 } }
      });
      const res = mockResponse();

      await handler(req, res, jest.fn());

      expect(saveFn).toHaveBeenCalled();
      expect(InvoiceModel.bulkWrite).toHaveBeenCalled();
      const bulkOps = (InvoiceModel.bulkWrite as jest.Mock).mock.calls[0][0];
      expect(bulkOps).toHaveLength(1);
      expect(bulkOps[0].updateOne.filter._id).toBe("inv-1");
      const deadline = bulkOps[0].updateOne.update.$set["compliance.msme.paymentDeadline"];
      expect(deadline).toBeInstanceOf(Date);
      const expectedDeadline = new Date(invoiceDate.getTime() + 30 * 86400000);
      expect(deadline.getTime()).toBe(expectedDeadline.getTime());
    });

    it("caps paymentDeadline recomputation at statutory 45 days", async () => {
      const vendor = {
        _id: "v1",
        tenantId: "tenant-a",
        vendorFingerprint: "fp-1",
        msme: { classification: "micro", agreedPaymentDays: 60 }
      };
      setupVendorMock(vendor);
      const invoiceDate = new Date("2026-03-01");
      (InvoiceModel.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: "inv-1", parsed: { invoiceDate: invoiceDate.toISOString() } }
        ])
      });
      (InvoiceModel.bulkWrite as jest.Mock).mockResolvedValue({});

      const router = createVendorsRouter();
      const handler = findHandler(router, "patch", "/vendors/:id");
      const req = mockRequest({
        authContext: defaultAuth,
        params: { id: "v1" },
        body: { msme: { agreedPaymentDays: 60 } }
      });
      const res = mockResponse();

      await handler(req, res, jest.fn());

      expect(InvoiceModel.bulkWrite).toHaveBeenCalled();
      const bulkOps = (InvoiceModel.bulkWrite as jest.Mock).mock.calls[0][0];
      const deadline = bulkOps[0].updateOne.update.$set["compliance.msme.paymentDeadline"];
      const expectedDeadline = new Date(invoiceDate.getTime() + 45 * 86400000);
      expect(deadline.getTime()).toBe(expectedDeadline.getTime());
    });
  });
});
