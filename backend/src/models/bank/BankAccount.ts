import { Schema, model, type InferSchemaType } from "mongoose";
import { BankAccountStatuses, BANK_ACCOUNT_STATUS } from "@/types/bankAccount.js";
import { validateClientOrgTenantInvariant } from "@/services/auth/tenantScope.js";

const bankAccountSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    clientOrgId: { type: Schema.Types.ObjectId, ref: "ClientOrganization", required: true },
    createdByUserId: { type: String, required: true },
    status: { type: String, enum: BankAccountStatuses, required: true, default: BANK_ACCOUNT_STATUS.PENDING_CONSENT },
    consentHandle: { type: String },
    consentId: { type: String },
    consentArtefact: { type: String },
    aaAddress: { type: String, required: true },
    displayName: { type: String },
    accountNumber: { type: String, required: true },
    bankName: { type: String, required: true },
    ifsc: {
      type: String,
      required: true,
      validate: {
        validator: (v: string) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v),
        message: "IFSC must be 11-char format (4 letters + 0 + 6 alphanumerics)"
      }
    },
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

bankAccountSchema.pre("save", async function () {
  await validateClientOrgTenantInvariant(this.tenantId, this.clientOrgId);
});

bankAccountSchema.index({ clientOrgId: 1, createdAt: -1 });
bankAccountSchema.index({ consentHandle: 1 }, { sparse: true });
bankAccountSchema.index({ sessionId: 1 }, { sparse: true });

type BankAccount = InferSchemaType<typeof bankAccountSchema>;

export const BankAccountModel = model<BankAccount>("BankAccount", bankAccountSchema);
