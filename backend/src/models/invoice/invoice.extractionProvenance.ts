import { Schema } from "mongoose";

export const extractionFieldProvenanceSchema = new Schema(
  {
    source: { type: String },
    page: { type: Number, min: 1 },
    bbox: {
      type: [Number],
      validate: {
        validator: (value: number[] | undefined) =>
          value === undefined ||
          (Array.isArray(value) &&
            (value.length === 0 ||
              (value.length === 4 && value.every(Number.isFinite) && value[0] < value[2] && value[1] < value[3]))),
        message: "extraction provenance bbox must contain four ordered numeric values when provided."
      }
    },
    bboxNormalized: {
      type: [Number],
      validate: {
        validator: (value: number[] | undefined) =>
          value === undefined ||
          (Array.isArray(value) &&
            (value.length === 0 ||
              (value.length === 4 && value.every(Number.isFinite) && value[0] < value[2] && value[1] < value[3]))),
        message: "extraction provenance bboxNormalized must contain four ordered numeric values when provided."
      }
    },
    bboxModel: {
      type: [Number],
      validate: {
        validator: (value: number[] | undefined) =>
          value === undefined ||
          (Array.isArray(value) &&
            (value.length === 0 ||
              (value.length === 4 &&
                value.every((v) => Number.isFinite(v) && v >= 0 && v <= 999) &&
                value[0] < value[2] &&
                value[1] < value[3]))),
        message: "extraction provenance bboxModel must contain four ordered numeric values in 0-999 range when provided."
      }
    },
    blockIndex: { type: Number, min: 0 },
    confidence: { type: Number, min: 0, max: 1 }
  },
  { _id: false }
);

export const extractionLineItemProvenanceSchema = new Schema(
  {
    index: { type: Number, required: true, min: 0 },
    row: { type: extractionFieldProvenanceSchema, default: undefined },
    fields: { type: Map, of: extractionFieldProvenanceSchema, default: {} }
  },
  { _id: false }
);
