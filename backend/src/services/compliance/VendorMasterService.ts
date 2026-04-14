import { createHash } from "node:crypto";
import { VendorMasterModel, type VendorMasterDocument } from "@/models/compliance/VendorMaster.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import { logger } from "@/utils/logger.js";

interface VendorUpsertInput {
  vendorName: string;
  pan?: string | null;
  gstin?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  emailDomain?: string | null;
}

interface BankChangeResult {
  isChanged: boolean;
  accountHash: string | null;
  ifsc: string | null;
  bankName: string | null;
}

export class VendorMasterService {
  async findByFingerprint(tenantId: string, vendorFingerprint: string): Promise<VendorMasterDocument | null> {
    return VendorMasterModel.findOne({ tenantId, vendorFingerprint }).lean() as Promise<VendorMasterDocument | null>;
  }

  async upsertFromInvoice(
    tenantId: string,
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
      { tenantId, vendorFingerprint },
      updateOps,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (input.bankAccountNumber && input.bankIfsc) {
      await this.updateBankHistory(tenantId, vendorFingerprint, input.bankAccountNumber, input.bankIfsc);
    }

    logger.info("vendor.master.upsert", {
      tenantId,
      vendorFingerprint,
      vendorName: input.vendorName,
      hasPan: Boolean(input.pan),
      hasBank: Boolean(input.bankAccountNumber)
    });

    return doc as VendorMasterDocument;
  }

  async detectBankChange(
    tenantId: string,
    vendorFingerprint: string,
    bankAccountNumber: string | null | undefined,
    bankIfsc: string | null | undefined
  ): Promise<BankChangeResult> {
    if (!bankAccountNumber || !bankIfsc) {
      return { isChanged: false, accountHash: null, ifsc: null, bankName: null };
    }

    const accountHash = hashAccountNumber(bankAccountNumber);
    const vendor = await VendorMasterModel.findOne({ tenantId, vendorFingerprint }).lean();

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
    vendorFingerprint: string,
    bankAccountNumber: string,
    bankIfsc: string
  ): Promise<void> {
    const accountHash = hashAccountNumber(bankAccountNumber);
    const now = new Date();

    const updated = await VendorMasterModel.findOneAndUpdate(
      { tenantId, vendorFingerprint, "bankHistory.accountHash": accountHash },
      {
        $set: { "bankHistory.$.lastSeen": now },
        $inc: { "bankHistory.$.invoiceCount": 1 }
      }
    );

    if (!updated) {
      await VendorMasterModel.findOneAndUpdate(
        { tenantId, vendorFingerprint },
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
}

function hashAccountNumber(accountNumber: string): string {
  return createHash("sha256").update(accountNumber.trim()).digest("hex");
}

function derivePanCategory(pan: string): string | null {
  if (pan.length < 4) return null;
  const code = pan.charAt(3).toUpperCase();
  const validCategories = new Set(["C", "P", "H", "F", "T", "A", "B", "L", "J", "G"]);
  return validCategories.has(code) ? code : null;
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
