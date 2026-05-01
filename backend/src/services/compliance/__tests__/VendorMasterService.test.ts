import { Types } from "mongoose";
import { VendorMasterService } from "@/services/compliance/VendorMasterService";
import { VendorMasterModel } from "@/models/compliance/VendorMaster";
import type { AuditLogService } from "@/services/core/AuditLogService";
import { VENDOR_AUDIT_ACTION, VENDOR_STATUS } from "@/types/vendor";
import { AUDIT_ENTITY_TYPE } from "@/models/core/AuditLog";
import { toUUID } from "@/types/uuid";

jest.mock("@/models/compliance/VendorMaster");
jest.mock("@/models/compliance/TdsVendorLedger");
jest.mock("@/models/invoice/Invoice");

const TENANT_A = toUUID("tenant-a");
const TENANT_B = toUUID("tenant-b");
const CLIENT_ORG_ID = new Types.ObjectId("65f0000000000000000000aa");
const ACTOR = { userId: toUUID("user-1"), userEmail: "admin@example.com" };

function makeAuditLogServiceMock(): AuditLogService {
  return { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;
}

describe("VendorMasterService — CRUD + cert + status", () => {
  let service: VendorMasterService;
  let auditLogService: AuditLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VendorMasterService();
    auditLogService = makeAuditLogServiceMock();
  });

  describe("listVendors", () => {
    it("scopes the query to tenantId and clientOrgId", async () => {
      const findChain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      };
      (VendorMasterModel.find as jest.Mock).mockReturnValue(findChain);
      (VendorMasterModel.countDocuments as jest.Mock).mockResolvedValue(0);

      await service.listVendors({ tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID });

      expect(VendorMasterModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID })
      );
    });

    it("applies status and search filters when provided", async () => {
      const findChain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      };
      (VendorMasterModel.find as jest.Mock).mockReturnValue(findChain);
      (VendorMasterModel.countDocuments as jest.Mock).mockResolvedValue(0);

      await service.listVendors(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        { status: VENDOR_STATUS.BLOCKED, search: "Acme" }
      );

      const calledWith = (VendorMasterModel.find as jest.Mock).mock.calls[0][0];
      expect(calledWith.vendorStatus).toBe(VENDOR_STATUS.BLOCKED);
      expect(calledWith.name).toEqual({ $regex: "Acme", $options: "i" });
    });
  });

  describe("getVendorById", () => {
    it("filters by tenantId+clientOrgId", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: "v1" })
      });

      await service.getVendorById({ tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID }, "v1");

      expect(VendorMasterModel.findOne).toHaveBeenCalledWith({
        _id: "v1",
        tenantId: TENANT_A,
        clientOrgId: CLIENT_ORG_ID
      });
    });

    it("does not return vendors from a different tenant", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      const result = await service.getVendorById({ tenantId: TENANT_B, clientOrgId: CLIENT_ORG_ID }, "v1");
      expect(result).toBeNull();
    });
  });

  describe("createVendor", () => {
    it("strips server-derived tallyLedgerGuid from input", async () => {
      const created = { _id: "v1", toObject: () => ({ _id: "v1", name: "Acme" }) };
      (VendorMasterModel.create as jest.Mock).mockResolvedValue(created);

      await service.createVendor(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        {
          vendorFingerprint: "vf-1",
          name: "Acme",
          tallyLedgerName: "Acme Ledger"
        } as Parameters<VendorMasterService["createVendor"]>[1] & { tallyLedgerGuid?: string },
        ACTOR,
        auditLogService
      );

      const payload = (VendorMasterModel.create as jest.Mock).mock.calls[0][0];
      expect(payload.tallyLedgerGuid).toBeUndefined();
      expect(payload.tallyLedgerName).toBe("Acme Ledger");
      expect(payload.tenantId).toBe(TENANT_A);
    });

    it("emits a vendor_created audit log", async () => {
      const created = { _id: "v1", toObject: () => ({ _id: "v1", name: "Acme" }) };
      (VendorMasterModel.create as jest.Mock).mockResolvedValue(created);

      await service.createVendor(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        { vendorFingerprint: "vf-1", name: "Acme" },
        ACTOR,
        auditLogService
      );

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_A,
          entityType: AUDIT_ENTITY_TYPE.VENDOR,
          action: VENDOR_AUDIT_ACTION.CREATED
        })
      );
    });

    it("rejects an invalid vendorStatus", async () => {
      await expect(
        service.createVendor(
          { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
          {
            vendorFingerprint: "vf-1",
            name: "Acme",
            vendorStatus: "bogus" as never
          },
          ACTOR,
          auditLogService
        )
      ).rejects.toThrow(/Invalid vendorStatus/);
    });
  });

  describe("updateVendor", () => {
    it("returns null when vendor does not exist in tenant scope", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      const result = await service.updateVendor(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        "missing",
        { name: "New" },
        ACTOR,
        auditLogService
      );
      expect(result).toBeNull();
      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it("emits status_changed when vendorStatus changes", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: "v1", vendorStatus: VENDOR_STATUS.ACTIVE })
      });
      (VendorMasterModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
        _id: "v1",
        toObject: () => ({ _id: "v1", vendorStatus: VENDOR_STATUS.BLOCKED })
      });

      await service.updateVendor(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        "v1",
        { vendorStatus: VENDOR_STATUS.BLOCKED },
        ACTOR,
        auditLogService
      );

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: VENDOR_AUDIT_ACTION.STATUS_CHANGED })
      );
    });

    it("emits vendor_updated for non-status changes", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: "v1", vendorStatus: VENDOR_STATUS.ACTIVE })
      });
      (VendorMasterModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
        _id: "v1",
        toObject: () => ({ _id: "v1", name: "New" })
      });

      await service.updateVendor(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        "v1",
        { name: "New" },
        ACTOR,
        auditLogService
      );

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: VENDOR_AUDIT_ACTION.UPDATED })
      );
    });

    it("strips tallyLedgerGuid from $set payload (server-derived)", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: "v1", vendorStatus: VENDOR_STATUS.ACTIVE })
      });
      (VendorMasterModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
        _id: "v1",
        toObject: () => ({ _id: "v1" })
      });

      await service.updateVendor(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        "v1",
        { name: "X", tallyLedgerGuid: "evil-guid" } as Parameters<VendorMasterService["updateVendor"]>[2] & { tallyLedgerGuid?: string },
        ACTOR,
        auditLogService
      );

      const update = (VendorMasterModel.findOneAndUpdate as jest.Mock).mock.calls[0][1];
      expect(update.$set.tallyLedgerGuid).toBeUndefined();
      expect(update.$set.name).toBe("X");
    });
  });

  describe("deleteVendor", () => {
    it("returns false when vendor missing", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      const result = await service.deleteVendor(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        "missing",
        ACTOR,
        auditLogService
      );
      expect(result).toBe(false);
      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it("emits vendor_deleted audit log on success", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: "v1", name: "Acme" })
      });
      (VendorMasterModel.deleteOne as jest.Mock).mockResolvedValue({ deletedCount: 1 });

      const result = await service.deleteVendor(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        "v1",
        ACTOR,
        auditLogService
      );

      expect(result).toBe(true);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: VENDOR_AUDIT_ACTION.DELETED })
      );
    });
  });

  describe("uploadSection197Cert", () => {
    it("rejects validTo before validFrom", async () => {
      await expect(
        service.uploadSection197Cert(
          { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
          "v1",
          {
            certificateNumber: "CERT-A",
            validFrom: new Date("2026-04-01"),
            validTo: new Date("2026-03-01"),
            maxAmountMinor: 1000,
            applicableRateBps: 500
          },
          ACTOR,
          auditLogService
        )
      ).rejects.toThrow(/validTo must be on or after validFrom/);
    });

    it("rejects negative maxAmountMinor", async () => {
      await expect(
        service.uploadSection197Cert(
          { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
          "v1",
          {
            certificateNumber: "CERT-A",
            validFrom: new Date("2026-04-01"),
            validTo: new Date("2027-03-31"),
            maxAmountMinor: -500,
            applicableRateBps: 500
          },
          ACTOR,
          auditLogService
        )
      ).rejects.toThrow(/maxAmountMinor/);
    });

    it("returns null when vendor missing in tenant scope", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });

      const result = await service.uploadSection197Cert(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        "missing",
        {
          certificateNumber: "CERT-A",
          validFrom: new Date("2026-04-01"),
          validTo: new Date("2027-03-31"),
          maxAmountMinor: 1000,
          applicableRateBps: 500
        },
        ACTOR,
        auditLogService
      );
      expect(result).toBeNull();
    });

    it("emits cert_uploaded audit log on success", async () => {
      (VendorMasterModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: "v1", lowerDeductionCert: null })
      });
      (VendorMasterModel.findOneAndUpdate as jest.Mock).mockResolvedValue({
        _id: "v1",
        toObject: () => ({ _id: "v1" })
      });

      await service.uploadSection197Cert(
        { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
        "v1",
        {
          certificateNumber: "CERT-A",
          validFrom: new Date("2026-04-01"),
          validTo: new Date("2027-03-31"),
          maxAmountMinor: 1000,
          applicableRateBps: 500
        },
        ACTOR,
        auditLogService
      );

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: VENDOR_AUDIT_ACTION.CERT_UPLOADED })
      );
    });
  });

  describe("mergeVendors validation", () => {
    it("rejects merging a vendor into itself", async () => {
      await expect(
        service.mergeVendors(
          {
            scope: { tenantId: TENANT_A, clientOrgId: CLIENT_ORG_ID },
            targetVendorId: "v1",
            sourceVendorId: "v1",
            actor: ACTOR
          },
          auditLogService
        )
      ).rejects.toThrow(/itself/);
    });
  });
});
