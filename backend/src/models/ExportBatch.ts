import { Schema, model, type InferSchemaType } from "mongoose";

const exportBatchSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    system: { type: String, required: true },
    total: { type: Number, required: true },
    successCount: { type: Number, required: true },
    failureCount: { type: Number, required: true },
    requestedBy: { type: String, required: true },
    fileKey: { type: String }
  },
  {
    timestamps: true
  }
);

exportBatchSchema.index({ tenantId: 1, createdAt: -1 });

type ExportBatch = InferSchemaType<typeof exportBatchSchema>;

export const ExportBatchModel = model<ExportBatch>("ExportBatch", exportBatchSchema);
