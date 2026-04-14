import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const tdsSectionMappingSchema = new Schema(
  {
    tenantId: { type: String, default: null },
    glCategory: { type: String, required: true },
    panCategory: { type: String, required: true },
    tdsSection: { type: String, required: true },
    priority: { type: Number, required: true, default: 0 }
  },
  { timestamps: true }
);

tdsSectionMappingSchema.index({ tenantId: 1, glCategory: 1, panCategory: 1 });

type TdsSectionMapping = InferSchemaType<typeof tdsSectionMappingSchema>;
type TdsSectionMappingDocument = HydratedDocument<TdsSectionMapping>;

export const TdsSectionMappingModel = model<TdsSectionMapping>("TdsSectionMapping", tdsSectionMappingSchema);
