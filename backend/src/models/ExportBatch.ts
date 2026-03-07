import { Schema, model, type InferSchemaType } from "mongoose";

const exportBatchSchema = new Schema(
  {
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

type ExportBatch = InferSchemaType<typeof exportBatchSchema>;

export const ExportBatchModel = model<ExportBatch>("ExportBatch", exportBatchSchema);
