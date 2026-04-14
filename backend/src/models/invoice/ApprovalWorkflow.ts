import { Schema, model, type InferSchemaType } from "mongoose";

export const WORKFLOW_STATUS = {
  IN_PROGRESS: "in_progress",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUS)[keyof typeof WORKFLOW_STATUS];

export const WORKFLOW_STEP_ACTION = {
  APPROVED: "approved",
  REJECTED: "rejected",
  SKIPPED: "skipped",
} as const;

export type WorkflowStepAction = (typeof WORKFLOW_STEP_ACTION)[keyof typeof WORKFLOW_STEP_ACTION];

const ApprovalWorkflowModes = ["simple", "advanced"] as const;
const ApproverTypes = ["any_member", "role", "specific_users", "persona", "capability"] as const;
const ApprovalRules = ["any", "all"] as const;
const StepTypes = ["approval", "compliance_signoff", "escalation"] as const;
const ConditionOperators = ["gt", "gte", "lt", "lte", "eq", "in"] as const;
const ConditionFields = ["totalAmountMinor", "tdsAmountMinor", "riskSignalMaxSeverity", "glCodeSource"] as const;

const workflowStepSchema = new Schema({
  order: { type: Number, required: true },
  name: { type: String, required: true },
  type: { type: String, enum: StepTypes, default: "approval" },
  approverType: { type: String, enum: ApproverTypes, required: true },
  approverRole: { type: String },
  approverUserIds: { type: [String], default: [] },
  approverPersona: { type: String },
  approverCapability: { type: String },
  rule: { type: String, enum: ApprovalRules, required: true, default: "any" },
  condition: {
    field: { type: String, enum: [...ConditionFields, undefined] },
    operator: { type: String, enum: ConditionOperators },
    value: { type: Schema.Types.Mixed }
  },
  timeoutHours: { type: Number, default: null },
  escalateTo: { type: String, default: null }
}, { _id: false });

const approvalWorkflowSchema = new Schema({
  tenantId: { type: String, required: true },
  enabled: { type: Boolean, required: true, default: false },
  mode: { type: String, enum: ApprovalWorkflowModes, required: true, default: "simple" },
  simpleConfig: {
    requireManagerReview: { type: Boolean, default: false },
    requireFinalSignoff: { type: Boolean, default: false }
  },
  steps: { type: [workflowStepSchema], default: [] },
  updatedBy: { type: String }
}, { timestamps: true });

approvalWorkflowSchema.index({ tenantId: 1 }, { unique: true });

type ApprovalWorkflow = InferSchemaType<typeof approvalWorkflowSchema>;
export const ApprovalWorkflowModel = model<ApprovalWorkflow>("ApprovalWorkflow", approvalWorkflowSchema);
