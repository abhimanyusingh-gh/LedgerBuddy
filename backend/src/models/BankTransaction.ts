import { Schema, model, type InferSchemaType } from "mongoose";

export const BANK_TRANSACTION_MATCH_STATUSES = ["matched", "suggested", "unmatched", "manual"] as const;
export type BankTransactionMatchStatus = (typeof BANK_TRANSACTION_MATCH_STATUSES)[number];

export const BANK_TRANSACTION_SOURCES = ["parsed", "csv-import", "pdf-parsed"] as const;

const bankTransactionSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    statementId: { type: String, required: true },
    date: { type: String, required: true },
    description: { type: String, required: true },
    reference: { type: String, default: null },
    debitMinor: { type: Number, default: null },
    creditMinor: { type: Number, default: null },
    balanceMinor: { type: Number, default: null },
    matchedInvoiceId: { type: String, default: null },
    matchConfidence: { type: Number, default: null },
    matchStatus: { type: String, enum: BANK_TRANSACTION_MATCH_STATUSES, default: "unmatched" },
    source: { type: String, enum: BANK_TRANSACTION_SOURCES, required: true }
  },
  { timestamps: true }
);

bankTransactionSchema.index({ tenantId: 1, statementId: 1 });
bankTransactionSchema.index({ tenantId: 1, matchStatus: 1 });
bankTransactionSchema.index({ tenantId: 1, matchedInvoiceId: 1 }, { sparse: true });
bankTransactionSchema.index({ tenantId: 1, date: 1, description: 1, debitMinor: 1, creditMinor: 1 });

export type BankTransaction = InferSchemaType<typeof bankTransactionSchema>;

export const BankTransactionModel = model<BankTransaction>("BankTransaction", bankTransactionSchema);
