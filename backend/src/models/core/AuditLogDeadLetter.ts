import { Schema, model, type InferSchemaType } from "mongoose";

const auditLogDeadLetterSchema = new Schema(
  {
    payload: { type: Schema.Types.Mixed, required: true },
    attempts: { type: Number, required: true, default: 0 },
    nextAttemptAt: { type: Date, required: true, default: () => new Date() },
    lastError: { type: String, default: null },
    givenUp: { type: Boolean, required: true, default: false }
  },
  {
    timestamps: true,
    minimize: false
  }
);

auditLogDeadLetterSchema.index({ givenUp: 1, nextAttemptAt: 1 });

type AuditLogDeadLetter = InferSchemaType<typeof auditLogDeadLetterSchema>;
export const AuditLogDeadLetterModel = model<AuditLogDeadLetter>(
  "AuditLogDeadLetter",
  auditLogDeadLetterSchema
);
