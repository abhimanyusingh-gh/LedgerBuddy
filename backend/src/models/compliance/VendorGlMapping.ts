import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const vendorGlMappingSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    vendorFingerprint: { type: String, required: true },
    glCode: { type: String, required: true },
    glCodeName: { type: String, required: true },
    usageCount: { type: Number, required: true, default: 0 },
    recentUsages: { type: [Date], default: [] },
    lastUsedAt: { type: Date, required: true }
  },
  { timestamps: true }
);

vendorGlMappingSchema.index({ tenantId: 1, vendorFingerprint: 1, glCode: 1 }, { unique: true });

type VendorGlMapping = InferSchemaType<typeof vendorGlMappingSchema>;
type VendorGlMappingDocument = HydratedDocument<VendorGlMapping>;

export const VendorGlMappingModel = model<VendorGlMapping>("VendorGlMapping", vendorGlMappingSchema);
