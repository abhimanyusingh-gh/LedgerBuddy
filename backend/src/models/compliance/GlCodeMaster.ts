import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const glCodeMasterSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    code: { type: String, required: true },
    name: { type: String, required: true },
    category: { type: String, required: true },
    linkedTdsSection: { type: String, default: null },
    parentCode: { type: String, default: null },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

glCodeMasterSchema.index({ tenantId: 1, code: 1 }, { unique: true });
glCodeMasterSchema.index({ tenantId: 1, category: 1 });

type GlCodeMaster = InferSchemaType<typeof glCodeMasterSchema>;
type GlCodeMasterDocument = HydratedDocument<GlCodeMaster>;

export const GlCodeMasterModel = model<GlCodeMaster>("GlCodeMaster", glCodeMasterSchema);
