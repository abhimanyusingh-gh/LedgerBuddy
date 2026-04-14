import { Schema, model, type InferSchemaType } from "mongoose";

export const BANK_STATEMENT_SOURCES = ["pdf-parsed", "csv-import"] as const;

const BANK_STATEMENT_PROCESSING_STATUSES = ["pending", "processing", "complete", "failed"] as const;

const bankStatementSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    fileName: { type: String, required: true },
    bankName: { type: String, default: null },
    accountNumberMasked: { type: String, default: null },
    accountHolder: { type: String, default: null },
    currency: { type: String, default: null },
    periodFrom: { type: String, default: null },
    periodTo: { type: String, default: null },
    transactionCount: { type: Number, default: 0 },
    matchedCount: { type: Number, default: 0 },
    suggestedCount: { type: Number, default: 0 },
    unmatchedCount: { type: Number, default: 0 },
    processingStatus: { type: String, enum: BANK_STATEMENT_PROCESSING_STATUSES, default: "complete" },
    source: { type: String, enum: BANK_STATEMENT_SOURCES, required: true },
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
