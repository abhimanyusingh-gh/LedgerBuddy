import { Schema, model, type InferSchemaType } from "mongoose";

const auditLogSchema = new Schema({
  tenantId: { type: String, required: true },
  userId: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: String },
  action: { type: String, required: true },
  previousValue: { type: Schema.Types.Mixed },
  newValue: { type: Schema.Types.Mixed },
}, { timestamps: true });

auditLogSchema.index({ tenantId: 1, entityType: 1, createdAt: -1 });

type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model<AuditLog>("AuditLog", auditLogSchema);
