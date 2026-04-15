import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

export const EXTRACTION_MAPPING_SOURCE = {
  MANUAL: "manual",
  USER_CORRECTION: "user-correction",
} as const;

type ExtractionMappingSource = (typeof EXTRACTION_MAPPING_SOURCE)[keyof typeof EXTRACTION_MAPPING_SOURCE];

export const EXTRACTION_MAPPING_MATCH_TYPE = {
  GSTIN: "gstin",
  VENDOR_NAME_FUZZY: "vendorNameFuzzy",
} as const;

export type ExtractionMappingMatchType = (typeof EXTRACTION_MAPPING_MATCH_TYPE)[keyof typeof EXTRACTION_MAPPING_MATCH_TYPE];

const ExtractionMappingSources = Object.values(EXTRACTION_MAPPING_SOURCE);
const ExtractionMappingMatchTypes = Object.values(EXTRACTION_MAPPING_MATCH_TYPE);

const fieldOverridesSchema = new Schema(
  {
    currency: { type: String }
  },
  { _id: false }
);

const extractionMappingSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    matchType: { type: String, required: true, enum: ExtractionMappingMatchTypes },
    matchKey: { type: String, required: true },
    canonicalVendorName: { type: String },
    fieldOverrides: { type: fieldOverridesSchema },
    createdBy: { type: String, required: true },
    source: { type: String, required: true, enum: ExtractionMappingSources, default: EXTRACTION_MAPPING_SOURCE.MANUAL },
    appliedCount: { type: Number, default: 0 },
    lastAppliedAt: { type: Date }
  },
  { timestamps: true }
);

extractionMappingSchema.index({ tenantId: 1, matchType: 1, matchKey: 1 }, { unique: true });
extractionMappingSchema.index({ tenantId: 1, updatedAt: -1 });

type ExtractionMapping = InferSchemaType<typeof extractionMappingSchema>;

export const ExtractionMappingModel = model<HydratedDocument<ExtractionMapping>>("ExtractionMapping", extractionMappingSchema, "extractionmappings");
