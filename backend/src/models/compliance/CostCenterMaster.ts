import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const costCenterMasterSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    department: { type: String, default: null },
    linkedGlCodes: { type: [String], default: [] },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

costCenterMasterSchema.index({ tenantId: 1, code: 1 }, { unique: true });

type CostCenterMaster = InferSchemaType<typeof costCenterMasterSchema>;
type CostCenterMasterDocument = HydratedDocument<CostCenterMaster>;

export const CostCenterMasterModel = model<CostCenterMaster>("CostCenterMaster", costCenterMasterSchema);
