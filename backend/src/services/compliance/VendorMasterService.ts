import { createHash } from "node:crypto";
import mongoose, { type Types } from "mongoose";
import { derivePanCategory } from "@/constants/indianCompliance.js";
import { VendorMasterModel, type VendorMasterDocument } from "@/models/compliance/VendorMaster.js";
import { TdsVendorLedgerModel } from "@/models/compliance/TdsVendorLedger.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { AUDIT_ENTITY_TYPE } from "@/models/core/AuditLog.js";
import type { AuditLogService } from "@/services/core/AuditLogService.js";
import {
  VENDOR_STATUS,
  VENDOR_AUDIT_ACTION,
  DeducteeTypes,
  VendorStatuses,
  type VendorStatus,
  type DeducteeType
} from "@/types/vendor.js";
import type { UUID } from "@/types/uuid.js";
import { logger } from "@/utils/logger.js";

interface VendorUpsertInput {
  vendorName: string;
  pan?: string | null;
  gstin?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  emailDomain?: string | null;
}

interface AuditActor {
  userId: UUID;
  userEmail?: string | null;
}

interface VendorScope {
  tenantId: UUID;
  clientOrgId: Types.ObjectId;
}

interface VendorEditableFields {
  name?: string;
  pan?: string | null;
  gstin?: string | null;
  defaultGlCode?: string | null;
  defaultCostCenter?: string | null;
  defaultTdsSection?: string | null;
  tallyLedgerName?: string | null;
  tallyLedgerGroup?: string;
  vendorStatus?: VendorStatus;
  deducteeType?: DeducteeType | null;
  stateCode?: string | null;
  stateName?: string | null;
}

interface Section197CertInput {
  certificateNumber: string;
  validFrom: Date;
  validTo: Date;
  maxAmountMinor: number;
  applicableRateBps: number;
}

interface MergeInput {
  scope: VendorScope;
  targetVendorId: string;
  sourceVendorId: string;
  actor: AuditActor;
}

interface MergeResult {
  targetVendorId: string;
  sourceVendorId: string;
  ledgersConsolidated: number;
  invoicesRepointed: number;
}

const SERVER_DERIVED_FIELDS = ["tallyLedgerGuid", "tenantId", "clientOrgId", "vendorFingerprint"] as const;

interface BankChangeResult {
  isChanged: boolean;
  accountHash: string | null;
  ifsc: string | null;
  bankName: string | null;
}

export class VendorMasterService {
  async findByFingerprint(
    tenantId: string,
    clientOrgId: Types.ObjectId,
    vendorFingerprint: string
  ): Promise<VendorMasterDocument | null> {
    return VendorMasterModel.findOne({ tenantId, clientOrgId, vendorFingerprint }).lean() as Promise<VendorMasterDocument | null>;
  }

  async upsertFromInvoice(
    tenantId: string,
    clientOrgId: Types.ObjectId,
    vendorFingerprint: string,
    input: VendorUpsertInput
  ): Promise<VendorMasterDocument> {
    const now = new Date();
    const panCategory = input.pan ? derivePanCategory(input.pan) : null;

    const updateOps: Record<string, unknown> = {
      $set: {
        lastInvoiceDate: now,
        ...(input.pan ? { pan: input.pan.toUpperCase(), panCategory } : {}),
        ...(input.gstin ? { gstin: input.gstin } : {})
      },
      $inc: { invoiceCount: 1 },
      $setOnInsert: {
        tenantId,
        clientOrgId,
        vendorFingerprint,
        name: input.vendorName,
        createdAt: now
      },
      $addToSet: {} as Record<string, unknown>
    };

    if (input.vendorName) {
      (updateOps.$addToSet as Record<string, unknown>).aliases = input.vendorName;
    }

    if (input.emailDomain) {
      (updateOps.$addToSet as Record<string, unknown>).emailDomains = input.emailDomain.toLowerCase();
    }

    if (Object.keys(updateOps.$addToSet as Record<string, unknown>).length === 0) {
      delete updateOps.$addToSet;
    }

    const doc = await VendorMasterModel.findOneAndUpdate(
      { tenantId, clientOrgId, vendorFingerprint },
      updateOps,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (input.bankAccountNumber && input.bankIfsc) {
      await this.updateBankHistory(tenantId, clientOrgId, vendorFingerprint, input.bankAccountNumber, input.bankIfsc);
    }

    logger.info("vendor.master.upsert", {
      tenantId,
      clientOrgId: String(clientOrgId),
      vendorFingerprint,
      vendorName: input.vendorName,
      hasPan: Boolean(input.pan),
      hasBank: Boolean(input.bankAccountNumber)
    });

    return doc as VendorMasterDocument;
  }

  async detectBankChange(
    tenantId: string,
    clientOrgId: Types.ObjectId,
    vendorFingerprint: string,
    bankAccountNumber: string | null | undefined,
    bankIfsc: string | null | undefined
  ): Promise<BankChangeResult> {
    if (!bankAccountNumber || !bankIfsc) {
      return { isChanged: false, accountHash: null, ifsc: null, bankName: null };
    }

    const accountHash = hashAccountNumber(bankAccountNumber);
    const vendor = await VendorMasterModel.findOne({ tenantId, clientOrgId, vendorFingerprint }).lean();

    if (!vendor || !vendor.bankHistory || vendor.bankHistory.length === 0) {
      return { isChanged: false, accountHash, ifsc: bankIfsc, bankName: null };
    }

    const matchesExisting = vendor.bankHistory.some(
      (entry: { accountHash: string }) => entry.accountHash === accountHash
    );

    return {
      isChanged: !matchesExisting,
      accountHash,
      ifsc: bankIfsc,
      bankName: vendor.bankHistory[vendor.bankHistory.length - 1]?.bankName ?? null
    };
  }

  private async updateBankHistory(
    tenantId: string,
    clientOrgId: Types.ObjectId,
    vendorFingerprint: string,
    bankAccountNumber: string,
    bankIfsc: string
  ): Promise<void> {
    const accountHash = hashAccountNumber(bankAccountNumber);
    const now = new Date();

    const updated = await VendorMasterModel.findOneAndUpdate(
      { tenantId, clientOrgId, vendorFingerprint, "bankHistory.accountHash": accountHash },
      {
        $set: { "bankHistory.$.lastSeen": now },
        $inc: { "bankHistory.$.invoiceCount": 1 }
      }
    );

    if (!updated) {
      await VendorMasterModel.findOneAndUpdate(
        { tenantId, clientOrgId, vendorFingerprint },
        {
          $push: {
            bankHistory: {
              accountHash,
              ifsc: bankIfsc,
              bankName: deriveBankName(bankIfsc),
              firstSeen: now,
              lastSeen: now,
              invoiceCount: 1
            }
          }
        }
      );
    }
  }

  async listVendors(
    scope: VendorScope,
    options: { search?: string; status?: VendorStatus; page?: number; limit?: number } = {}
  ): Promise<{ items: VendorMasterDocument[]; total: number; page: number; limit: number }> {
    const query: Record<string, unknown> = {
      tenantId: scope.tenantId,
      clientOrgId: scope.clientOrgId
    };

    if (options.search && options.search.trim()) {
      const escaped = options.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.name = { $regex: escaped, $options: "i" };
    }

    if (options.status) {
      query.vendorStatus = options.status;
    }

    const page = Math.max(options.page ?? 1, 1);
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      VendorMasterModel.find(query).sort({ lastInvoiceDate: -1 }).skip(skip).limit(limit).lean() as unknown as Promise<VendorMasterDocument[]>,
      VendorMasterModel.countDocuments(query)
    ]);

    return { items, total, page, limit };
  }

  async getVendorById(scope: VendorScope, vendorId: string): Promise<VendorMasterDocument | null> {
    return VendorMasterModel.findOne({
      _id: vendorId,
      tenantId: scope.tenantId,
      clientOrgId: scope.clientOrgId
    }).lean() as unknown as Promise<VendorMasterDocument | null>;
  }

  async createVendor(
    scope: VendorScope,
    input: VendorEditableFields & { vendorFingerprint: string; name: string },
    actor: AuditActor,
    auditLogService: AuditLogService
  ): Promise<VendorMasterDocument> {
    this.assertEditableFields(input);

    const sanitized = this.stripServerDerivedFields(input);
    const now = new Date();

    const created = await VendorMasterModel.create({
      ...sanitized,
      tenantId: scope.tenantId,
      clientOrgId: scope.clientOrgId,
      vendorFingerprint: input.vendorFingerprint,
      name: input.name,
      lastInvoiceDate: now,
      invoiceCount: 0
    });

    void auditLogService.record({
      tenantId: scope.tenantId,
      userId: actor.userId,
      userEmail: actor.userEmail ?? null,
      entityType: AUDIT_ENTITY_TYPE.VENDOR,
      entityId: String(created._id),
      action: VENDOR_AUDIT_ACTION.CREATED,
      previousValue: null,
      newValue: created.toObject()
    });

    return created;
  }

  async updateVendor(
    scope: VendorScope,
    vendorId: string,
    fields: VendorEditableFields,
    actor: AuditActor,
    auditLogService: AuditLogService
  ): Promise<VendorMasterDocument | null> {
    this.assertEditableFields(fields);

    const sanitized = this.stripServerDerivedFields(fields);
    const previous = await VendorMasterModel.findOne({
      _id: vendorId,
      tenantId: scope.tenantId,
      clientOrgId: scope.clientOrgId
    }).lean();

    if (!previous) return null;

    const previousStatus = (previous as { vendorStatus?: VendorStatus }).vendorStatus;
    const updated = await VendorMasterModel.findOneAndUpdate(
      { _id: vendorId, tenantId: scope.tenantId, clientOrgId: scope.clientOrgId },
      { $set: sanitized },
      { new: true }
    );

    if (!updated) return null;

    const statusChanged = sanitized.vendorStatus && sanitized.vendorStatus !== previousStatus;
    const action = statusChanged ? VENDOR_AUDIT_ACTION.STATUS_CHANGED : VENDOR_AUDIT_ACTION.UPDATED;

    void auditLogService.record({
      tenantId: scope.tenantId,
      userId: actor.userId,
      userEmail: actor.userEmail ?? null,
      entityType: AUDIT_ENTITY_TYPE.VENDOR,
      entityId: String(updated._id),
      action,
      previousValue: previous,
      newValue: updated.toObject()
    });

    return updated;
  }

  async deleteVendor(
    scope: VendorScope,
    vendorId: string,
    actor: AuditActor,
    auditLogService: AuditLogService
  ): Promise<boolean> {
    const previous = await VendorMasterModel.findOne({
      _id: vendorId,
      tenantId: scope.tenantId,
      clientOrgId: scope.clientOrgId
    }).lean();

    if (!previous) return false;

    await VendorMasterModel.deleteOne({ _id: vendorId, tenantId: scope.tenantId, clientOrgId: scope.clientOrgId });

    void auditLogService.record({
      tenantId: scope.tenantId,
      userId: actor.userId,
      userEmail: actor.userEmail ?? null,
      entityType: AUDIT_ENTITY_TYPE.VENDOR,
      entityId: String(vendorId),
      action: VENDOR_AUDIT_ACTION.DELETED,
      previousValue: previous,
      newValue: null
    });

    return true;
  }

  async uploadSection197Cert(
    scope: VendorScope,
    vendorId: string,
    cert: Section197CertInput,
    actor: AuditActor,
    auditLogService: AuditLogService
  ): Promise<VendorMasterDocument | null> {
    this.assertCertValid(cert);

    const previous = await VendorMasterModel.findOne({
      _id: vendorId,
      tenantId: scope.tenantId,
      clientOrgId: scope.clientOrgId
    }).lean();

    if (!previous) return null;

    const updated = await VendorMasterModel.findOneAndUpdate(
      { _id: vendorId, tenantId: scope.tenantId, clientOrgId: scope.clientOrgId },
      { $set: { lowerDeductionCert: cert } },
      { new: true, runValidators: true }
    );

    if (!updated) return null;

    void auditLogService.record({
      tenantId: scope.tenantId,
      userId: actor.userId,
      userEmail: actor.userEmail ?? null,
      entityType: AUDIT_ENTITY_TYPE.VENDOR,
      entityId: String(updated._id),
      action: VENDOR_AUDIT_ACTION.CERT_UPLOADED,
      previousValue: { lowerDeductionCert: (previous as { lowerDeductionCert?: unknown }).lowerDeductionCert ?? null },
      newValue: { lowerDeductionCert: cert }
    });

    return updated;
  }

  async mergeVendors(input: MergeInput, auditLogService: AuditLogService): Promise<MergeResult> {
    const { scope, targetVendorId, sourceVendorId, actor } = input;

    if (targetVendorId === sourceVendorId) {
      throw new Error("Cannot merge a vendor into itself.");
    }

    const session = await mongoose.startSession();
    try {
      let result: MergeResult | null = null;

      await session.withTransaction(async () => {
        const [target, source] = await Promise.all([
          VendorMasterModel.findOne({ _id: targetVendorId, tenantId: scope.tenantId, clientOrgId: scope.clientOrgId }).session(session),
          VendorMasterModel.findOne({ _id: sourceVendorId, tenantId: scope.tenantId, clientOrgId: scope.clientOrgId }).session(session)
        ]);

        if (!target) throw new Error(`Target vendor ${targetVendorId} not found in tenant scope.`);
        if (!source) throw new Error(`Source vendor ${sourceVendorId} not found in tenant scope.`);
        if (source.vendorStatus === VENDOR_STATUS.MERGED) {
          throw new Error(`Source vendor ${sourceVendorId} is already merged.`);
        }

        const sourceSnapshot = source.toObject();
        const targetSnapshot = target.toObject();

        const ledgersConsolidated = await this.consolidateTdsLedgers(scope.tenantId, source.vendorFingerprint, target.vendorFingerprint, session);
        const invoicesRepointed = await this.repointInvoices(scope.tenantId, scope.clientOrgId, source.vendorFingerprint, target.vendorFingerprint, session);

        source.vendorStatus = VENDOR_STATUS.MERGED;
        await source.save({ session });

        result = {
          targetVendorId,
          sourceVendorId,
          ledgersConsolidated,
          invoicesRepointed
        };

        void auditLogService.record({
          tenantId: scope.tenantId,
          userId: actor.userId,
          userEmail: actor.userEmail ?? null,
          entityType: AUDIT_ENTITY_TYPE.VENDOR,
          entityId: String(target._id),
          action: VENDOR_AUDIT_ACTION.MERGED,
          previousValue: { source: sourceSnapshot, target: targetSnapshot },
          newValue: { mergedInto: targetVendorId, ledgersConsolidated, invoicesRepointed }
        });
      });

      if (!result) {
        throw new Error("Merge transaction completed without result.");
      }
      return result;
    } finally {
      await session.endSession();
    }
  }

  private async consolidateTdsLedgers(
    tenantId: UUID,
    sourceFingerprint: string,
    targetFingerprint: string,
    session: mongoose.ClientSession
  ): Promise<number> {
    const sourceLedgers = await TdsVendorLedgerModel.find({ tenantId, vendorFingerprint: sourceFingerprint }).session(session);
    let consolidated = 0;

    for (const sourceLedger of sourceLedgers) {
      const existingTarget = await TdsVendorLedgerModel.findOne({
        tenantId,
        vendorFingerprint: targetFingerprint,
        financialYear: sourceLedger.financialYear,
        section: sourceLedger.section
      }).session(session);

      if (existingTarget) {
        existingTarget.cumulativeBaseMinor = (existingTarget.cumulativeBaseMinor ?? 0) + (sourceLedger.cumulativeBaseMinor ?? 0);
        existingTarget.cumulativeTdsMinor = (existingTarget.cumulativeTdsMinor ?? 0) + (sourceLedger.cumulativeTdsMinor ?? 0);
        existingTarget.invoiceCount = (existingTarget.invoiceCount ?? 0) + (sourceLedger.invoiceCount ?? 0);
        if (sourceLedger.entries && sourceLedger.entries.length > 0) {
          (existingTarget.entries as unknown as unknown[]).push(...(sourceLedger.entries as unknown as unknown[]));
        }

        if (sourceLedger.thresholdCrossedAt) {
          if (!existingTarget.thresholdCrossedAt || sourceLedger.thresholdCrossedAt < existingTarget.thresholdCrossedAt) {
            existingTarget.thresholdCrossedAt = sourceLedger.thresholdCrossedAt;
          }
        }

        await existingTarget.save({ session });
        await sourceLedger.deleteOne({ session });
      } else {
        sourceLedger.vendorFingerprint = targetFingerprint;
        await sourceLedger.save({ session });
      }
      consolidated += 1;
    }

    return consolidated;
  }

  private async repointInvoices(
    tenantId: UUID,
    clientOrgId: Types.ObjectId,
    sourceFingerprint: string,
    targetFingerprint: string,
    session: mongoose.ClientSession
  ): Promise<number> {
    const result = await InvoiceModel.updateMany(
      { tenantId, clientOrgId, "metadata.vendorFingerprint": sourceFingerprint },
      { $set: { "metadata.vendorFingerprint": targetFingerprint } },
      { session }
    );
    return result.modifiedCount ?? 0;
  }

  private assertEditableFields(fields: VendorEditableFields): void {
    if (fields.vendorStatus && !VendorStatuses.includes(fields.vendorStatus)) {
      throw new Error(`Invalid vendorStatus "${fields.vendorStatus}".`);
    }
    if (fields.deducteeType && !DeducteeTypes.includes(fields.deducteeType)) {
      throw new Error(`Invalid deducteeType "${fields.deducteeType}".`);
    }
  }

  private assertCertValid(cert: Section197CertInput): void {
    if (!cert.certificateNumber || cert.certificateNumber.trim().length === 0) {
      throw new Error("Section 197 cert: certificateNumber is required.");
    }
    if (!(cert.validFrom instanceof Date) || isNaN(cert.validFrom.getTime())) {
      throw new Error("Section 197 cert: validFrom must be a valid date.");
    }
    if (!(cert.validTo instanceof Date) || isNaN(cert.validTo.getTime())) {
      throw new Error("Section 197 cert: validTo must be a valid date.");
    }
    if (cert.validTo < cert.validFrom) {
      throw new Error("Section 197 cert: validTo must be on or after validFrom.");
    }
    if (!Number.isInteger(cert.maxAmountMinor) || cert.maxAmountMinor < 0) {
      throw new Error("Section 197 cert: maxAmountMinor must be a non-negative integer.");
    }
    if (!Number.isInteger(cert.applicableRateBps) || cert.applicableRateBps < 0 || cert.applicableRateBps > 10000) {
      throw new Error("Section 197 cert: applicableRateBps must be an integer between 0 and 10000.");
    }
  }

  private stripServerDerivedFields(input: object): Record<string, unknown> {
    const sanitized: Record<string, unknown> = { ...(input as Record<string, unknown>) };
    for (const field of SERVER_DERIVED_FIELDS) {
      delete sanitized[field];
    }
    return sanitized;
  }
}

function hashAccountNumber(accountNumber: string): string {
  return createHash("sha256").update(accountNumber.trim()).digest("hex");
}

function deriveBankName(ifsc: string): string {
  const prefix = ifsc.substring(0, 4).toUpperCase();
  const bankNames: Record<string, string> = {
    HDFC: "HDFC Bank",
    ICIC: "ICICI Bank",
    SBIN: "State Bank of India",
    UTIB: "Axis Bank",
    KKBK: "Kotak Mahindra Bank",
    PUNB: "Punjab National Bank",
    CNRB: "Canara Bank",
    BARB: "Bank of Baroda",
    IOBA: "Indian Overseas Bank",
    UBIN: "Union Bank of India"
  };
  return bankNames[prefix] ?? prefix;
}
