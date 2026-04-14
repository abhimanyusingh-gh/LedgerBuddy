import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

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
    matchStatus: { type: String, enum: ["matched", "suggested", "unmatched", "manual"], default: "unmatched" },
    source: { type: String, enum: ["parsed", "csv-import", "pdf-parsed"], required: true }
  },
  { timestamps: true }
);

bankTransactionSchema.index({ tenantId: 1, statementId: 1 });
bankTransactionSchema.index({ tenantId: 1, matchStatus: 1 });
bankTransactionSchema.index({ tenantId: 1, matchedInvoiceId: 1 }, { sparse: true });
bankTransactionSchema.index({ tenantId: 1, date: 1, description: 1, debitMinor: 1, creditMinor: 1 });

type BankTransaction = InferSchemaType<typeof bankTransactionSchema>;
type BankTransactionDocument = HydratedDocument<BankTransaction>;

export const BankTransactionModel = model<BankTransaction>("BankTransaction", bankTransactionSchema);
