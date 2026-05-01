import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { validateClientOrgTenantInvariant } from "@/services/auth/tenantScope.js";
import {
  VendorStatuses,
  DeducteeTypes,
  MsmeClassifications,
  MsmeClassificationSources,
  VENDOR_STATUS,
  type VendorStatus,
  type DeducteeType,
  type MsmeClassification,
  type MsmeClassificationSource
} from "@/types/vendor.js";
import type { TallyGuid } from "@/types/tally.js";

const TALLY_LEDGER_GROUP_DEFAULT = "Sundry Creditors";

const bankHistoryEntrySchema = new Schema(
  {
    accountHash: { type: String, required: true },
    ifsc: { type: String, required: true },
    bankName: { type: String, required: true },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    invoiceCount: { type: Number, required: true, default: 1 }
  },
  { _id: false }
);

const lowerDeductionCertSchema = new Schema(
  {
    certificateNumber: { type: String, required: true },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    maxAmountMinor: { type: Number, required: true },
    applicableRateBps: { type: Number, required: true }
  },
  { _id: false }
);

lowerDeductionCertSchema.pre("validate", function () {
  if (this.validTo && this.validFrom && this.validTo < this.validFrom) {
    this.invalidate("validTo", "lowerDeductionCert.validTo must be on or after validFrom");
  }
});

const msmeClassificationHistoryEntrySchema = new Schema(
  {
    classification: { type: String, enum: MsmeClassifications, required: true },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, default: null },
    source: { type: String, enum: MsmeClassificationSources, required: true }
  },
  { _id: false }
);

const vendorMasterSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    clientOrgId: { type: Schema.Types.ObjectId, ref: "ClientOrganization", required: true },
    vendorFingerprint: { type: String, required: true },
    name: { type: String, required: true },
    aliases: { type: [String], default: [] },
    pan: { type: String, default: null },
    gstin: { type: String, default: null },
    panCategory: {
      type: String,
      enum: ["C", "P", "H", "F", "T", "A", "B", "L", "J", "G", null],
      default: null
    },
    defaultGlCode: { type: String, default: null },
    defaultCostCenter: { type: String, default: null },
    defaultTdsSection: { type: String, default: null },
    bankHistory: { type: [bankHistoryEntrySchema], default: [] },
    msme: {
      udyamNumber: { type: String, default: null },
      classification: {
        type: String,
        enum: ["micro", "small", "medium", null],
        default: null
      },
      verifiedAt: { type: Date, default: null },
      agreedPaymentDays: { type: Number, default: null }
    },
    emailDomains: { type: [String], default: [] },
    invoiceCount: { type: Number, required: true, default: 0 },
    lastInvoiceDate: { type: Date, required: true },
    tallyLedgerName: { type: String, default: null },
    tallyLedgerGroup: { type: String, required: true, default: TALLY_LEDGER_GROUP_DEFAULT },
    tallyLedgerGuid: { type: String, default: null },
    vendorStatus: {
      type: String,
      enum: VendorStatuses,
      required: true,
      default: VENDOR_STATUS.ACTIVE
    },
    stateCode: { type: String, default: null },
    stateName: { type: String, default: null },
    lowerDeductionCert: { type: lowerDeductionCertSchema, default: null },
    deducteeType: { type: String, enum: [...DeducteeTypes, null], default: null },
    msmeClassificationHistory: { type: [msmeClassificationHistoryEntrySchema], default: [] }
  },
  { timestamps: true }
);

vendorMasterSchema.pre("save", async function () {
  await validateClientOrgTenantInvariant(this.tenantId, this.clientOrgId);
});

vendorMasterSchema.index({ clientOrgId: 1, vendorFingerprint: 1 }, { unique: true });
vendorMasterSchema.index({ clientOrgId: 1, pan: 1 }, { sparse: true });
vendorMasterSchema.index({ clientOrgId: 1, name: "text" });

type RawVendorMaster = InferSchemaType<typeof vendorMasterSchema>;

type VendorMaster = Omit<RawVendorMaster, "vendorStatus" | "deducteeType" | "tallyLedgerGuid" | "msmeClassificationHistory"> & {
  vendorStatus: VendorStatus;
  deducteeType: DeducteeType | null;
  tallyLedgerGuid: TallyGuid | null;
  msmeClassificationHistory: Array<{
    classification: MsmeClassification;
    validFrom: Date;
    validTo: Date | null;
    source: MsmeClassificationSource;
  }>;
};

export type VendorMasterDocument = HydratedDocument<VendorMaster>;

export const VendorMasterModel = model<VendorMaster>("VendorMaster", vendorMasterSchema);
