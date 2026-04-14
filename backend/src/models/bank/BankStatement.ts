import { Schema, model, type InferSchemaType } from "mongoose";

export const BANK_STATEMENT_SOURCE = {
  PDF: "pdf-parsed",
  CSV: "csv-import",
} as const;
export type BankStatementSource = (typeof BANK_STATEMENT_SOURCE)[keyof typeof BANK_STATEMENT_SOURCE];

export const BANK_STATEMENT_PROCESSING_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETE: "complete",
  FAILED: "failed",
} as const;
export type BankStatementProcessingStatus = (typeof BANK_STATEMENT_PROCESSING_STATUS)[keyof typeof BANK_STATEMENT_PROCESSING_STATUS];

const bankStatementSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    fileName: { type: String, required: true },
    bankName: { type: String, default: null },
    accountNumberMasked: { type: String, default: null },
    accountHolder: { type: String, default: null },
    currency: { type: String, default: null },
    periodFrom: { type: Date, default: null },
    periodTo: { type: Date, default: null },
    transactionCount: { type: Number, default: 0 },
    matchedCount: { type: Number, default: 0 },
    suggestedCount: { type: Number, default: 0 },
    unmatchedCount: { type: Number, default: 0 },
    processingStatus: { type: String, enum: Object.values(BANK_STATEMENT_PROCESSING_STATUS), default: BANK_STATEMENT_PROCESSING_STATUS.COMPLETE },
    source: { type: String, enum: Object.values(BANK_STATEMENT_SOURCE), required: true },
    uploadedBy: { type: String },
    s3Key: { type: String, default: null },
    gstin: { type: String, default: null },
    gstinLabel: { type: String, default: null }
  },
  { timestamps: true }
);

bankStatementSchema.index({ tenantId: 1, createdAt: -1 });
bankStatementSchema.index({ tenantId: 1, bankName: 1, accountNumberMasked: 1 });

export type BankStatement = InferSchemaType<typeof bankStatementSchema>;

export const BankStatementModel = model<BankStatement>("BankStatement", bankStatementSchema);
