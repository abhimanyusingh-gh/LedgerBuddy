export const APPROVAL_WORKFLOW_MODE = {
  SIMPLE: "simple",
  ADVANCED: "advanced",
} as const;

export type ApprovalWorkflowMode = (typeof APPROVAL_WORKFLOW_MODE)[keyof typeof APPROVAL_WORKFLOW_MODE];

export const APPROVAL_STEP_TYPE = {
  APPROVAL: "approval",
  COMPLIANCE_SIGNOFF: "compliance_signoff",
  ESCALATION: "escalation",
} as const;

export type ApprovalStepType = (typeof APPROVAL_STEP_TYPE)[keyof typeof APPROVAL_STEP_TYPE];

export const APPROVER_TYPE = {
  ANY_MEMBER: "any_member",
  ROLE: "role",
  SPECIFIC_USERS: "specific_users",
  PERSONA: "persona",
  CAPABILITY: "capability",
} as const;

export type ApproverType = (typeof APPROVER_TYPE)[keyof typeof APPROVER_TYPE];

export const APPROVAL_RULE = {
  ANY: "any",
  ALL: "all",
} as const;

export type ApprovalRule = (typeof APPROVAL_RULE)[keyof typeof APPROVAL_RULE];

export const AMOUNT_SEARCH_PREFERENCE = {
  FIRST: "first",
  LAST: "last",
} as const;

export type AmountSearchPreference = (typeof AMOUNT_SEARCH_PREFERENCE)[keyof typeof AMOUNT_SEARCH_PREFERENCE];
