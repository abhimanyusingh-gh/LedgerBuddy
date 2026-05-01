import { Schema, model, type InferSchemaType } from "mongoose";

export const AUDIT_ENTITY_TYPE = {
  TDS_MANUAL_OVERRIDE: "tds_manual_override",
  GL_OVERRIDE: "gl_override",
  VENDOR: "vendor",
  CONFIG: "config",
  INVOICE: "invoice",
  PAYMENT: "payment",
  BANK_TRANSACTION: "bank_transaction",
  RECONCILIATION: "reconciliation",
  EXPORT: "export",
  APPROVAL: "approval"
} as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPE)[keyof typeof AUDIT_ENTITY_TYPE];

const AUDIT_ENTITY_TYPE_VALUES = Object.values(AUDIT_ENTITY_TYPE);

const auditLogSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    entityType: { type: String, required: true, enum: AUDIT_ENTITY_TYPE_VALUES },
    entityId: { type: String, required: true },
    action: { type: String, required: true },
    previousValue: { type: Schema.Types.Mixed, default: null },
    newValue: { type: Schema.Types.Mixed, default: null },
    userId: { type: String, required: true },
    userEmail: { type: String, default: null },
    timestamp: { type: Date, required: true, default: () => new Date() }
  },
  {
    timestamps: false,
    minimize: false
  }
);

auditLogSchema.index({ tenantId: 1, entityType: 1, entityId: 1, timestamp: -1 });
auditLogSchema.index({ tenantId: 1, timestamp: -1 });
auditLogSchema.index({ tenantId: 1, userId: 1, timestamp: -1 });
auditLogSchema.index({ tenantId: 1, action: 1, timestamp: -1 });

type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model<AuditLog>("AuditLog", auditLogSchema);
