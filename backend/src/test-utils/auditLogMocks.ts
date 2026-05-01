export const AUDIT_ENTITY_TYPE_MOCK = {
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

export function makeAuditLogServiceMock() {
  return { record: jest.fn() };
}
