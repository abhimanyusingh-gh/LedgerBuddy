import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

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

const vendorMasterSchema = new Schema(
  {
    tenantId: { type: String, required: true },
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
    lastInvoiceDate: { type: Date, required: true }
  },
  { timestamps: true }
);

vendorMasterSchema.index({ tenantId: 1, vendorFingerprint: 1 }, { unique: true });
vendorMasterSchema.index({ tenantId: 1, pan: 1 }, { sparse: true });
vendorMasterSchema.index({ tenantId: 1, name: "text" });

type VendorMaster = InferSchemaType<typeof vendorMasterSchema>;
export type VendorMasterDocument = HydratedDocument<VendorMaster>;

export const VendorMasterModel = model<VendorMaster>("VendorMaster", vendorMasterSchema);
