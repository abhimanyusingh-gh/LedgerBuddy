export const PARSE_EVENT_TYPE = {
  START: "start",
  PROGRESS: "progress",
  COMPLETE: "complete",
  ERROR: "error",
} as const;

export type ParseEventType = (typeof PARSE_EVENT_TYPE)[keyof typeof PARSE_EVENT_TYPE];

export const BANK_PARSE_STAGE = {
  OCR: "ocr",
  TEXT_EXTRACTION: "text-extraction",
  SLM_CHUNK: "slm-chunk",
  VALIDATION: "validation",
} as const;

export type BankParseStage = (typeof BANK_PARSE_STAGE)[keyof typeof BANK_PARSE_STAGE];
