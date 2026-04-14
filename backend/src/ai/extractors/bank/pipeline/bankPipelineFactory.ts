import { ComposablePipeline } from "@/core/pipeline/ComposablePipeline.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import { NormalizeTransactionsStep } from "./steps/NormalizeTransactionsStep.js";
import { DeduplicateTransactionsStep } from "./steps/DeduplicateTransactionsStep.js";
import { PersistBankStatementStep } from "./steps/PersistBankStatementStep.js";
import { BANK_CTX } from "./contextKeys.js";

export interface BankPdfParseResult {
  statementId: string;
  transactionCount: number;
  duplicatesSkipped: number;
  warnings: string[];
  bankName?: string;
  accountNumber?: string;
  periodFrom?: Date;
  periodTo?: Date;
}

interface BankPipelineParams {
  uploadedBy: string;
}

/**
 * Builds the composable pipeline for post-engine bank statement processing.
 *
 * Prerequisites in the context store (set by the caller after running
 * DocumentProcessingEngine):
 * - BANK_CTX.SLM_OUTPUT: SlmBankStatementOutput
 * - BANK_CTX.WARNINGS: string[]
 * - BANK_CTX.BANK_NAME, ACCOUNT_NUMBER, ACCOUNT_HOLDER, PERIOD_FROM, PERIOD_TO
 *
 * The bank pipeline is intentionally simpler than the invoice pipeline. It does
 * NOT use common OCR post-processing steps (CaptureOcrMetadata, PostProcessOcr,
 * BuildTextCandidates, CalibrateConfidence, DetectLanguage) because the bank
 * statement flow delegates OCR + SLM extraction to DocumentProcessingEngine
 * directly.
 *
 * Pipeline stages:
 * 1. NormalizeTransactionsStep  - validate & normalize SLM transaction output
 * 2. DeduplicateTransactionsStep - fingerprint-based dedup against DB
 * 3. PersistBankStatementStep    - save statement & transactions to MongoDB
 */
export function buildBankPostEnginePipeline(
  params: BankPipelineParams,
): ComposablePipeline<BankPdfParseResult> {
  return new ComposablePipeline<BankPdfParseResult>(extractResult)
    .add(new NormalizeTransactionsStep())
    .add(new DeduplicateTransactionsStep())
    .add(new PersistBankStatementStep(params.uploadedBy));
}

function extractResult(ctx: PipelineContext): BankPdfParseResult {
  return {
    statementId: ctx.store.require<string>(BANK_CTX.STATEMENT_ID),
    transactionCount: ctx.store.require<number>(BANK_CTX.TRANSACTION_COUNT),
    duplicatesSkipped: ctx.store.require<number>(BANK_CTX.DUPLICATES_SKIPPED),
    warnings: ctx.store.require<string[]>(BANK_CTX.WARNINGS),
    bankName: ctx.store.get<string | undefined>(BANK_CTX.BANK_NAME),
    accountNumber: ctx.store.get<string | undefined>(BANK_CTX.ACCOUNT_NUMBER),
    periodFrom: ctx.store.get<Date | undefined>(BANK_CTX.PERIOD_FROM),
    periodTo: ctx.store.get<Date | undefined>(BANK_CTX.PERIOD_TO),
  };
}
