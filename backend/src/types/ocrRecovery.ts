export const OCR_RECOVERY_STRATEGY = {
  GENERIC: "generic",
  INVOICE_TABLE: "invoice_table",
  RECEIPT_STATEMENT: "receipt_statement",
} as const;

export type OcrRecoveryStrategy = (typeof OCR_RECOVERY_STRATEGY)[keyof typeof OCR_RECOVERY_STRATEGY];

export const BLOCK_SCALE = {
  NORMALIZED: "normalized",
  PIXEL: "pixel",
} as const;

export type BlockScale = (typeof BLOCK_SCALE)[keyof typeof BLOCK_SCALE];

export const OCR_TEXT_CANDIDATE_ID = {
  LAYOUT: "layout",
  BLOCKS: "blocks",
  RAW: "raw",
  KEY_VALUE: "keyValue",
  AUGMENTED: "augmented",
} as const;

export type OcrTextCandidateId = (typeof OCR_TEXT_CANDIDATE_ID)[keyof typeof OCR_TEXT_CANDIDATE_ID];
