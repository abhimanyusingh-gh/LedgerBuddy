import { Schema } from "mongoose";

export const ocrBlockSchema = new Schema(
  {
    text: { type: String, required: true },
    page: { type: Number, required: true },
    bbox: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: number[]) => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite),
        message: "ocrBlocks.bbox must contain exactly four numeric values."
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
        message: "ocrBlocks.bboxNormalized must contain exactly four ordered numeric values when provided."
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
        message: "ocrBlocks.bboxModel must contain exactly four ordered numeric values in 0-999 range when provided."
      }
    },
    cropPath: { type: String },
    blockType: { type: String }
  },
  {
    _id: false
  }
);
