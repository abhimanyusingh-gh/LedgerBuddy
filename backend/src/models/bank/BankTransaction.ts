import { Schema, model, type InferSchemaType } from "mongoose";
import { validateClientOrgTenantInvariant } from "@/services/auth/tenantScope.js";

export const BANK_TRANSACTION_MATCH_STATUS = {
  MATCHED: "matched",
  SUGGESTED: "suggested",
  UNMATCHED: "unmatched",
  MANUAL: "manual",
} as const;
export type BankTransactionMatchStatus = (typeof BANK_TRANSACTION_MATCH_STATUS)[keyof typeof BANK_TRANSACTION_MATCH_STATUS];

export const BANK_TRANSACTION_SOURCE = {
  PARSED: "parsed",
  CSV: "csv-import",
  PDF: "pdf-parsed",
} as const;
export type BankTransactionSource = (typeof BANK_TRANSACTION_SOURCE)[keyof typeof BANK_TRANSACTION_SOURCE];

const bankTransactionSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    clientOrgId: { type: Schema.Types.ObjectId, ref: "ClientOrganization", required: true },
    statementId: { type: String, required: true },
    date: { type: Date, required: true },
    description: { type: String, required: true },
    reference: { type: String, default: null },
    debitMinor: { type: Number, default: null },
    creditMinor: { type: Number, default: null },
    balanceMinor: { type: Number, default: null },
    matchedInvoiceId: { type: String, default: null },
    matchConfidence: { type: Number, default: null },
    matchStatus: { type: String, enum: Object.values(BANK_TRANSACTION_MATCH_STATUS), default: BANK_TRANSACTION_MATCH_STATUS.UNMATCHED },
    source: { type: String, enum: Object.values(BANK_TRANSACTION_SOURCE), required: true }
  },
  { timestamps: true }
);

bankTransactionSchema.pre("save", async function () {
  await validateClientOrgTenantInvariant(this.tenantId, this.clientOrgId);
});

bankTransactionSchema.index({ clientOrgId: 1, statementId: 1 });
bankTransactionSchema.index({ clientOrgId: 1, matchStatus: 1 });
bankTransactionSchema.index({ clientOrgId: 1, matchedInvoiceId: 1 }, { sparse: true });
bankTransactionSchema.index({ clientOrgId: 1, date: 1, description: 1, debitMinor: 1, creditMinor: 1 });
bankTransactionSchema.index({ clientOrgId: 1, statementId: 1, matchStatus: 1, debitMinor: 1 });

export type BankTransaction = InferSchemaType<typeof bankTransactionSchema>;

export const BankTransactionModel = model<BankTransaction>("BankTransaction", bankTransactionSchema);
