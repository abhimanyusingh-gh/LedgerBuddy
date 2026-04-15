import { Schema, model, type InferSchemaType } from "mongoose";
import { BankAccountStatuses, BANK_ACCOUNT_STATUS } from "@/types/bankAccount.js";

const bankAccountSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    createdByUserId: { type: String, required: true },
    status: { type: String, enum: BankAccountStatuses, required: true, default: BANK_ACCOUNT_STATUS.PENDING_CONSENT },
    consentHandle: { type: String },
    consentId: { type: String },
    consentArtefact: { type: String },
    aaAddress: { type: String, required: true },
    displayName: { type: String },
    bankName: { type: String },
    maskedAccNumber: { type: String },
    balanceMinor: { type: Number },
    currency: { type: String, default: "INR" },
    balanceFetchedAt: { type: Date },
    lastErrorReason: { type: String },
    sessionId: { type: String },
    fiSessionId: { type: String }
  },
  {
    timestamps: true
  }
);

bankAccountSchema.index({ tenantId: 1, createdAt: -1 });
bankAccountSchema.index({ consentHandle: 1 }, { sparse: true });
bankAccountSchema.index({ sessionId: 1 }, { sparse: true });

type BankAccount = InferSchemaType<typeof bankAccountSchema>;

export const BankAccountModel = model<BankAccount>("BankAccount", bankAccountSchema);
