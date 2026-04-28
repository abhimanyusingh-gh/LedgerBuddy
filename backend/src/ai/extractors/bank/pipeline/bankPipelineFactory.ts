import { ComposablePipeline } from "@/core/pipeline/ComposablePipeline.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import { NormalizeTransactionsStep } from "@/ai/extractors/bank/pipeline/steps/NormalizeTransactionsStep.js";
import { DeduplicateTransactionsStep } from "@/ai/extractors/bank/pipeline/steps/DeduplicateTransactionsStep.js";
import { PersistBankStatementStep } from "@/ai/extractors/bank/pipeline/steps/PersistBankStatementStep.js";
import { BANK_CTX } from "@/ai/extractors/bank/pipeline/contextKeys.js";

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
