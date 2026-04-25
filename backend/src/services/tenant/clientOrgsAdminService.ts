import { Types } from "mongoose";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { TenantMailboxAssignmentModel } from "@/models/integration/TenantMailboxAssignment.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { BankAccountModel } from "@/models/bank/BankAccount.js";
import { HttpError } from "@/errors/HttpError.js";
import { GSTIN_FORMAT } from "@/constants/indianCompliance.js";

/**
 * Admin CRUD service for `ClientOrganization` (#174). Tenant-scoped:
 * every method is owned by `tenantId` and never crosses tenant
 * boundaries. The natural key `{tenantId, gstin}` is enforced by the
 * model's unique index — we surface duplicate-key failures as 409s.
 */
export class ClientOrgsAdminService {
  /**
   * List the tenant's client-orgs in `companyName` ascending order.
   * Returns the picker shape consumed by FE issues #150 / #152 / #167.
   */
  async list(tenantId: string) {
    const docs = await ClientOrganizationModel.find({ tenantId })
      .sort({ companyName: 1 })
      .lean();
    return docs.map((doc) => ({
      _id: String(doc._id),
      companyName: doc.companyName ?? null,
      gstin: doc.gstin,
      stateName: doc.stateName ?? null,
      f12OverwriteByGuidVerified: Boolean(doc.f12OverwriteByGuidVerified),
      detectedVersion: doc.detectedVersion ?? null,
      archivedAt: doc.archivedAt ?? null
    }));
  }

  async create(input: {
    tenantId: string;
    gstin: string;
    companyName: string;
    stateName?: string;
    companyGuid?: string;
  }) {
    const gstin = input.gstin.trim().toUpperCase();
    if (!GSTIN_FORMAT.test(gstin)) {
      throw new HttpError("gstin must match the 15-character GSTIN format.", 400, "client_org_invalid_gstin");
    }
    const companyName = input.companyName.trim();
    if (companyName.length === 0) {
      throw new HttpError("companyName is required.", 400, "client_org_company_name_required");
    }

    try {
      const created = await ClientOrganizationModel.create({
        tenantId: input.tenantId,
        gstin,
        companyName,
        stateName: input.stateName?.trim() || undefined,
        companyGuid: input.companyGuid?.trim() || undefined,
        f12OverwriteByGuidVerified: false,
        detectedVersion: null,
        archivedAt: null
      });
      return this.serialize(created.toObject());
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new HttpError(
          "A client organization with this GSTIN already exists for this tenant.",
          409,
          "client_org_duplicate_gstin"
        );
      }
      throw error;
    }
  }

  async update(input: {
    tenantId: string;
    clientOrgId: string;
    companyName?: string;
    stateName?: string;
    companyGuid?: string;
    f12OverwriteByGuidVerified?: boolean;
  }) {
    const oid = this.toOid(input.clientOrgId);
    const update: Record<string, unknown> = {};
    if (input.companyName !== undefined) {
      const trimmed = input.companyName.trim();
      if (trimmed.length === 0) {
        throw new HttpError("companyName cannot be empty.", 400, "client_org_company_name_required");
      }
      update.companyName = trimmed;
    }
    if (input.stateName !== undefined) update.stateName = input.stateName.trim() || null;
    if (input.companyGuid !== undefined) update.companyGuid = input.companyGuid.trim() || null;
    if (input.f12OverwriteByGuidVerified !== undefined) {
      update.f12OverwriteByGuidVerified = input.f12OverwriteByGuidVerified;
    }

    const updated = await ClientOrganizationModel.findOneAndUpdate(
      { _id: oid, tenantId: input.tenantId },
      { $set: update },
      { new: true, runValidators: true }
    ).lean();
    if (!updated) {
      throw new HttpError("Client organization not found.", 404, "client_org_not_found");
    }
    return this.serialize(updated);
  }

  /**
   * Hard-delete when the org has no dependent accounting-leaf rows
   * (Invoice, VendorMaster, BankAccount). When dependents exist we
   * soft-archive (`archivedAt = now`) and return the linked-counts
   * breakdown so the FE can show the "soft-archive only" UX promised
   * in #174.
   */
  async deleteOrArchive(input: { tenantId: string; clientOrgId: string }) {
    const oid = this.toOid(input.clientOrgId);
    const existing = await ClientOrganizationModel.findOne({
      _id: oid,
      tenantId: input.tenantId
    }).lean();
    if (!existing) {
      throw new HttpError("Client organization not found.", 404, "client_org_not_found");
    }

    const [invoices, vendors, bankAccounts, mailboxAssignments] = await Promise.all([
      InvoiceModel.countDocuments({ clientOrgId: oid }),
      VendorMasterModel.countDocuments({ clientOrgId: oid }),
      BankAccountModel.countDocuments({ clientOrgId: oid }),
      TenantMailboxAssignmentModel.countDocuments({ tenantId: input.tenantId, clientOrgIds: oid })
    ]);
    const totalLinked = invoices + vendors + bankAccounts + mailboxAssignments;

    if (totalLinked > 0) {
      await ClientOrganizationModel.updateOne(
        { _id: oid, tenantId: input.tenantId },
        { $set: { archivedAt: new Date() } }
      );
      return {
        status: "archived" as const,
        linkedCounts: { invoices, vendors, bankAccounts, mailboxAssignments }
      };
    }

    await ClientOrganizationModel.deleteOne({ _id: oid, tenantId: input.tenantId });
    return { status: "deleted" as const, linkedCounts: { invoices: 0, vendors: 0, bankAccounts: 0, mailboxAssignments: 0 } };
  }

  private serialize(doc: {
    _id: Types.ObjectId | string;
    companyName?: string | null;
    gstin: string;
    stateName?: string | null;
    f12OverwriteByGuidVerified?: boolean;
    detectedVersion?: string | null;
    archivedAt?: Date | null;
  }) {
    return {
      _id: String(doc._id),
      companyName: doc.companyName ?? null,
      gstin: doc.gstin,
      stateName: doc.stateName ?? null,
      f12OverwriteByGuidVerified: Boolean(doc.f12OverwriteByGuidVerified),
      detectedVersion: doc.detectedVersion ?? null,
      archivedAt: doc.archivedAt ?? null
    };
  }

  private toOid(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(value)) {
      throw new HttpError("Invalid client organization id.", 400, "client_org_invalid_id");
    }
    return new Types.ObjectId(value);
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === 11000
    );
  }
}
