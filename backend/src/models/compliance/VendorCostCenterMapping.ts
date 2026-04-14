import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const vendorCostCenterMappingSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    vendorFingerprint: { type: String, required: true },
    costCenterCode: { type: String, required: true },
    costCenterName: { type: String, required: true },
    usageCount: { type: Number, required: true, default: 0 },
    lastUsedAt: { type: Date, required: true }
  },
  { timestamps: true }
);

vendorCostCenterMappingSchema.index({ tenantId: 1, vendorFingerprint: 1, costCenterCode: 1 }, { unique: true });

type VendorCostCenterMapping = InferSchemaType<typeof vendorCostCenterMappingSchema>;
type VendorCostCenterMappingDocument = HydratedDocument<VendorCostCenterMapping>;

export const VendorCostCenterMappingModel = model<VendorCostCenterMapping>("VendorCostCenterMapping", vendorCostCenterMappingSchema);
