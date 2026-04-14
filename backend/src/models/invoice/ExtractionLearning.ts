import { Schema, model, type InferSchemaType } from "mongoose";

const correctionEntrySchema = new Schema(
  {
    field: { type: String, required: true },
    hint: { type: String, required: true, maxlength: 80 },
    count: { type: Number, default: 1 },
    lastSeen: { type: Date, default: Date.now }
  },
  { _id: false }
);

const extractionLearningSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    groupKey: { type: String, required: true },
    groupType: { type: String, required: true, enum: ["invoice-type", "vendor"] },
    corrections: { type: [correctionEntrySchema], default: [] }
  },
  { timestamps: true }
);

extractionLearningSchema.index({ tenantId: 1, groupKey: 1, groupType: 1 }, { unique: true });
extractionLearningSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

type ExtractionLearning = InferSchemaType<typeof extractionLearningSchema>;
export const ExtractionLearningModel = model<ExtractionLearning>("ExtractionLearning", extractionLearningSchema);
