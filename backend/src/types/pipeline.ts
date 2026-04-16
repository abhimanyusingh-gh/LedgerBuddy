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

export type FieldVerificationMode = "strict" | "relaxed";
