import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { InvoiceStatuses } from "../types/invoice.js";
import { ConfidenceTones, RiskFlags } from "../types/confidence.js";
import { WorkloadTiers } from "../types/tenant.js";

const ocrBlockSchema = new Schema(
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

const invoiceSchema = new Schema(
  {
    tenantId: { type: String, required: true, default: "default" },
    workloadTier: { type: String, enum: WorkloadTiers, required: true, default: "standard" },
    sourceType: { type: String, required: true },
    sourceKey: { type: String, required: true },
    sourceDocumentId: { type: String, required: true },
    attachmentName: { type: String, required: true },
    contentHash: { type: String },
    mimeType: { type: String, required: true },
    receivedAt: { type: Date, required: true },

    ocrProvider: { type: String },
    ocrText: { type: String },
    ocrConfidence: { type: Number },
    ocrBlocks: { type: [ocrBlockSchema], default: [] },
    ocrTokens: { type: Number },
    slmTokens: { type: Number },
    confidenceScore: { type: Number, default: 0 },
    confidenceTone: { type: String, enum: ConfidenceTones, default: "red" },
    autoSelectForApproval: { type: Boolean, default: false },
    riskFlags: { type: [String], enum: RiskFlags, default: [] },
    riskMessages: { type: [String], default: [] },

    parsed: {
      invoiceNumber: { type: String },
      vendorName: { type: String },
      invoiceDate: { type: String },
      dueDate: { type: String },
      totalAmountMinor: {
        type: Number,
        validate: {
          validator: Number.isInteger,
          message: "parsed.totalAmountMinor must be an integer."
        }
      },
      currency: { type: String },
      notes: { type: [String], default: [] },
      gst: {
        gstin: { type: String },
        subtotalMinor: { type: Number },
        cgstMinor: { type: Number },
        sgstMinor: { type: Number },
        igstMinor: { type: Number },
        cessMinor: { type: Number },
        totalTaxMinor: { type: Number }
      }
    },

    status: { type: String, enum: InvoiceStatuses, required: true },
    processingIssues: { type: [String], default: [] },

    approval: {
      approvedBy: { type: String },
      approvedAt: { type: Date },
      userId: { type: String },
      email: { type: String },
      role: { type: String }
    },

    export: {
      system: { type: String },
      batchId: { type: String },
      exportedAt: { type: Date },
      externalReference: { type: String },
      error: { type: String }
    },

    metadata: { type: Map, of: String, default: {} }
  },
  {
    timestamps: true
  }
);

invoiceSchema.index(
  {
    tenantId: 1,
    sourceType: 1,
    sourceKey: 1,
    sourceDocumentId: 1,
    attachmentName: 1
  },
  { unique: true }
);

invoiceSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ tenantId: 1, createdAt: 1 });
invoiceSchema.index({ tenantId: 1, "approval.approvedAt": 1 });
invoiceSchema.index({ tenantId: 1, "export.exportedAt": 1 });
invoiceSchema.index({ tenantId: 1, "parsed.vendorName": 1, status: 1 });

type Invoice = InferSchemaType<typeof invoiceSchema>;
export type InvoiceDocument = HydratedDocument<Invoice>;

export const InvoiceModel = model<Invoice>("Invoice", invoiceSchema);
