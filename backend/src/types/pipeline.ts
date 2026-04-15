export const PIPELINE_STEP_STATUS = {
  CONTINUE: "continue",
  SKIP: "skip",
  HALT: "halt",
} as const;

export type PipelineStepStatus = (typeof PIPELINE_STEP_STATUS)[keyof typeof PIPELINE_STEP_STATUS];

export const LEARNING_MODE = {
  ACTIVE: "active",
  ASSISTIVE: "assistive",
} as const;

export type LearningMode = (typeof LEARNING_MODE)[keyof typeof LEARNING_MODE];

export const FIELD_VERIFICATION_MODE = {
  STRICT: "strict",
  RELAXED: "relaxed",
} as const;

export type FieldVerificationMode = (typeof FIELD_VERIFICATION_MODE)[keyof typeof FIELD_VERIFICATION_MODE];
