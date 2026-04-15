import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { InvoiceStatuses } from "@/types/invoice.js";
import { ConfidenceTones, RiskFlags } from "@/types/confidence.js";
import { WorkloadTiers } from "@/types/tenant.js";

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

const extractionFieldProvenanceSchema = new Schema(
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

const extractionLineItemProvenanceSchema = new Schema(
  {
    index: { type: Number, required: true, min: 0 },
    row: { type: extractionFieldProvenanceSchema, default: undefined },
    fields: { type: Map, of: extractionFieldProvenanceSchema, default: {} }
  },
  { _id: false }
);

const workflowStepResultSchema = new Schema(
  {
    step: { type: Number, required: true },
    name: { type: String, required: true },
    action: { type: String, enum: ["approved", "rejected", "skipped"], required: true },
    userId: { type: String },
    email: { type: String },
    role: { type: String },
    timestamp: { type: Date, required: true },
    note: { type: String }
  },
  { _id: false }
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
      invoiceDate: { type: Date },
      dueDate: { type: Date },
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
      },
      pan: { type: String },
      bankAccountNumber: { type: String },
      bankIfsc: { type: String },
      lineItems: {
        type: [new Schema({
          description: { type: String, required: true },
          hsnSac: { type: String },
          quantity: { type: Number },
          rate: { type: Number },
          amountMinor: { type: Number, required: true },
          taxRate: { type: Number },
          cgstMinor: { type: Number },
          sgstMinor: { type: Number },
          igstMinor: { type: Number }
        }, { _id: false })],
        default: undefined
      }
    },

    extraction: {
      type: new Schema({
        source: { type: String },
        strategy: { type: String },
        invoiceType: { type: String },
        classification: {
          type: new Schema({
            invoiceType: { type: String },
            category: { type: String },
            tdsSection: { type: String }
          }, { _id: false }),
          default: undefined
        },
        fieldConfidence: { type: Map, of: Number, default: {} },
        fieldProvenance: { type: Map, of: extractionFieldProvenanceSchema, default: {} },
        lineItemProvenance: { type: [extractionLineItemProvenanceSchema], default: [] },
        fieldOverlayPaths: { type: Map, of: String, default: {} }
      }, { _id: false }),
      default: undefined
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

    workflowState: {
      type: new Schema({
        workflowId: { type: String },
        currentStep: { type: Number },
        status: { type: String, enum: ["in_progress", "approved", "rejected"] },
        stepResults: { type: [workflowStepResultSchema], default: [] }
      }, { _id: false }),
      default: undefined
    },

    export: {
      system: { type: String },
      batchId: { type: String },
      exportedAt: { type: Date },
      externalReference: { type: String },
      error: { type: String }
    },

    compliance: {
      type: new Schema({
        pan: {
          type: new Schema({
            value: { type: String, default: null },
            source: { type: String, enum: ["extracted", "vendor-master", "manual"] },
            validationLevel: { type: String, enum: ["L1", "L2", "L3", null], default: null },
            validationResult: { type: String, enum: ["valid", "format-invalid", "gstin-mismatch", "struck-off", null], default: null },
            gstinCrossRef: { type: Boolean, default: false }
          }, { _id: false }),
          default: undefined
        },
        tds: {
          type: new Schema({
            section: { type: String, default: null },
            rate: { type: Number, default: null },
            amountMinor: { type: Number, default: null },
            netPayableMinor: { type: Number, default: null },
            source: { type: String, enum: ["auto", "manual"], default: "auto" },
            confidence: { type: String, enum: ["high", "medium", "low"], default: "low" }
          }, { _id: false }),
          default: undefined
        },
        glCode: {
          type: new Schema({
            code: { type: String, default: null },
            name: { type: String, default: null },
            source: { type: String, enum: ["vendor-default", "description-match", "category-default", "manual"] },
            confidence: { type: Number, default: null },
            suggestedAlternatives: {
              type: [new Schema({ code: String, name: String, score: Number }, { _id: false })],
              default: []
            }
          }, { _id: false }),
          default: undefined
        },
        costCenter: {
          type: new Schema({
            code: { type: String, default: null },
            name: { type: String, default: null },
            source: { type: String, enum: ["vendor-default", "gl-linked", "manual"] },
            confidence: { type: Number, default: null }
          }, { _id: false }),
          default: undefined
        },
        irn: {
          type: new Schema({
            value: { type: String, default: null },
            valid: { type: Boolean, default: null }
          }, { _id: false }),
          default: undefined
        },
        msme: {
          type: new Schema({
            udyamNumber: { type: String, default: null },
            classification: { type: String, enum: ["micro", "small", "medium", null], default: null },
            paymentDeadline: { type: Date, default: null }
          }, { _id: false }),
          default: undefined
        },
        tcs: {
          type: new Schema({
            rate: { type: Number, default: null },
            amountMinor: { type: Number, default: null },
            source: { type: String, enum: ["extracted", "configured", "manual"], default: "configured" }
          }, { _id: false }),
          default: undefined
        },
        vendorBank: {
          type: new Schema({
            accountHash: { type: String, default: null },
            ifsc: { type: String, default: null },
            bankName: { type: String, default: null },
            isChanged: { type: Boolean, default: false },
            verifiedChange: { type: Boolean, default: false }
          }, { _id: false }),
          default: undefined
        },
        reconciliation: {
          type: new Schema({
            bankTransactionId: { type: String, default: null },
            verifiedByStatement: { type: Boolean, default: false },
            matchedAt: { type: Date, default: null }
          }, { _id: false }),
          default: undefined
        },
        riskSignals: {
          type: [new Schema({
            code: { type: String, required: true },
            category: { type: String, enum: ["financial", "compliance", "fraud", "data-quality"], required: true },
            severity: { type: String, enum: ["info", "warning", "critical"], required: true },
            message: { type: String, required: true },
            confidencePenalty: { type: Number, required: true, default: 0 },
            status: { type: String, enum: ["open", "dismissed", "acted-on"], default: "open" },
            resolvedBy: { type: String, default: null },
            resolvedAt: { type: Date, default: null }
          }, { _id: false })],
          default: []
        }
      }, { _id: false }),
      default: undefined
    },

    gmailMessageId: { type: String, default: undefined },
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

invoiceSchema.index(
  { tenantId: 1, gmailMessageId: 1 },
  { unique: true, partialFilterExpression: { gmailMessageId: { $type: "string" } } }
);
invoiceSchema.index({ tenantId: 1, "approval.userId": 1 });
invoiceSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ tenantId: 1, createdAt: 1 });
invoiceSchema.index({ tenantId: 1, "approval.approvedAt": 1 });
invoiceSchema.index({ tenantId: 1, "export.exportedAt": 1 });
invoiceSchema.index({ tenantId: 1, "parsed.vendorName": 1, status: 1 });
// Compound index for reconciliation candidate fetch: filter by tenant, status, and amount range
invoiceSchema.index({ tenantId: 1, status: 1, "parsed.totalAmountMinor": 1 });
// Sparse index for reconciliation GSTIN-filtered candidate fetch
invoiceSchema.index({ tenantId: 1, "parsed.gst.gstin": 1 }, { sparse: true });

type Invoice = InferSchemaType<typeof invoiceSchema>;
export type InvoiceDocument = HydratedDocument<Invoice>;

export const InvoiceModel = model<Invoice>("Invoice", invoiceSchema);
