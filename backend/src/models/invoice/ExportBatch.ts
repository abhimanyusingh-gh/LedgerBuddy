import { Schema, model, type InferSchemaType } from "mongoose";
import { validateClientOrgTenantInvariant } from "@/services/auth/tenantScope.js";

export const EXPORT_BATCH_ITEM_STATUS = {
  PENDING: "pending",
  SUCCESS: "success",
  FAILURE: "failure"
} as const;

export const EXPORT_BATCH_VOUCHER_TYPE = {
  PURCHASE: "purchase",
  PAYMENT: "payment"
} as const;

const exportBatchItemTallyAttemptSchema = new Schema(
  {
    exportVersion: { type: Number, required: true },
    lineError: { type: String },
    lineErrorOrdinal: { type: Number },
    attemptedAt: { type: Date, required: true }
  },
  { _id: false }
);

const exportBatchItemTallyResponseSchema = new Schema(
  {
    lineError: { type: String },
    lineErrorOrdinal: { type: Number },
    attempts: { type: [exportBatchItemTallyAttemptSchema], default: undefined }
  },
  { _id: false }
);

const exportBatchItemSchema = new Schema(
  {
    invoiceId: { type: String, required: true },
    paymentId: { type: String },
    voucherType: {
      type: String,
      required: true,
      enum: Object.values(EXPORT_BATCH_VOUCHER_TYPE)
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(EXPORT_BATCH_ITEM_STATUS)
    },
    tallyResponse: { type: exportBatchItemTallyResponseSchema },
    exportVersion: { type: Number, required: true, default: 0 },
    guid: { type: String, required: true },
    completedAt: { type: Date }
  },
  { _id: false }
);

const exportBatchSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    clientOrgId: { type: Schema.Types.ObjectId, ref: "ClientOrganization", required: true },
    system: { type: String, required: true },
    total: { type: Number, required: true },
    successCount: { type: Number, required: true },
    failureCount: { type: Number, required: true },
    requestedBy: { type: String, required: true },
    fileKey: { type: String },
    items: { type: [exportBatchItemSchema], default: undefined }
  },
  {
    timestamps: true
  }
);

exportBatchSchema.pre("save", async function () {
  await validateClientOrgTenantInvariant(this.tenantId, this.clientOrgId);
});

exportBatchSchema.index({ clientOrgId: 1, createdAt: -1 });

type ExportBatch = InferSchemaType<typeof exportBatchSchema>;

export const ExportBatchModel = model<ExportBatch>("ExportBatch", exportBatchSchema);
