import { Schema, model, type InferSchemaType } from "mongoose";

const vendorTemplateSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    fingerprintKey: { type: String, required: true },
    layoutSignature: { type: String, required: true },
    vendorName: { type: String, required: true },
    currency: { type: String },
    invoicePrefix: { type: String },
    confidenceScore: { type: Number, required: true, default: 0 },
    usageCount: { type: Number, required: true, default: 0 }
  },
  {
    timestamps: true
  }
);

vendorTemplateSchema.index({ tenantId: 1, fingerprintKey: 1 }, { unique: true });
vendorTemplateSchema.index({ tenantId: 1, vendorName: 1 });

type VendorTemplate = InferSchemaType<typeof vendorTemplateSchema>;
export const VendorTemplateModel = model<VendorTemplate>("VendorTemplate", vendorTemplateSchema);
