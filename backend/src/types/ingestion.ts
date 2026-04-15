export const INGESTION_JOB_STATE = {
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  PAUSED: "paused",
} as const;

export type IngestionJobState = (typeof INGESTION_JOB_STATE)[keyof typeof INGESTION_JOB_STATE];

export const INGESTION_FILE_RESULT = {
  CREATED: "created",
  DUPLICATE: "duplicate",
  FAILED: "failed",
} as const;

export type IngestionFileResult = (typeof INGESTION_FILE_RESULT)[keyof typeof INGESTION_FILE_RESULT];
