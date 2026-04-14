import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const fieldOverridesSchema = new Schema(
  {
    currency: { type: String }
  },
  { _id: false }
);

const extractionMappingSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    matchType: { type: String, required: true, enum: ["gstin", "vendorNameFuzzy"] },
    matchKey: { type: String, required: true },
    canonicalVendorName: { type: String },
    fieldOverrides: { type: fieldOverridesSchema },
    createdBy: { type: String, required: true },
    source: { type: String, required: true, enum: ["manual", "user-correction"], default: "manual" },
    appliedCount: { type: Number, default: 0 },
    lastAppliedAt: { type: Date }
  },
  { timestamps: true }
);

extractionMappingSchema.index({ tenantId: 1, matchType: 1, matchKey: 1 }, { unique: true });
extractionMappingSchema.index({ tenantId: 1, updatedAt: -1 });

type ExtractionMapping = InferSchemaType<typeof extractionMappingSchema>;

export const ExtractionMappingModel = model<HydratedDocument<ExtractionMapping>>("ExtractionMapping", extractionMappingSchema, "extractionmappings");
