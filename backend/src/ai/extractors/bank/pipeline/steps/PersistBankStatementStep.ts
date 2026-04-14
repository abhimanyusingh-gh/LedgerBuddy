import type { PipelineStage, StageResult } from "@/core/pipeline/PipelineStage.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import { BankStatementModel, BANK_STATEMENT_SOURCE, BANK_STATEMENT_PROCESSING_STATUS } from "@/models/bank/BankStatement.js";
import { BankTransactionModel, BANK_TRANSACTION_SOURCE } from "@/models/bank/BankTransaction.js";
import { logger } from "@/utils/logger.js";
import type { ParsedTransaction } from "./NormalizeTransactionsStep.js";
import { BANK_CTX } from "../contextKeys.js";

/**
 * Persists the bank statement and its transactions to MongoDB.
 * Creates a BankStatement document and bulk-inserts BankTransaction documents.
 */
export class PersistBankStatementStep implements PipelineStage {
  readonly name = "persist-bank-statement";

  constructor(private readonly uploadedBy: string) {}

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const tenantId = ctx.input.tenantId;
    const fileName = ctx.input.fileName;
    const transactions = ctx.store.require<ParsedTransaction[]>(BANK_CTX.DEDUPLICATED_TRANSACTIONS);
    const duplicatesSkipped = ctx.store.require<number>(BANK_CTX.DUPLICATES_SKIPPED);
    const warnings = ctx.store.require<string[]>(BANK_CTX.WARNINGS);
    const bankName = ctx.store.get<string | undefined>(BANK_CTX.BANK_NAME);
    const accountNumber = ctx.store.get<string | undefined>(BANK_CTX.ACCOUNT_NUMBER);
    const accountHolder = ctx.store.get<string | undefined>(BANK_CTX.ACCOUNT_HOLDER);
    const periodFrom = ctx.store.get<Date | undefined>(BANK_CTX.PERIOD_FROM);
    const periodTo = ctx.store.get<Date | undefined>(BANK_CTX.PERIOD_TO);

    const statement = await BankStatementModel.create({
      tenantId,
      fileName,
      bankName: bankName ?? null,
      accountNumberMasked: accountNumber ?? null,
      accountHolder: accountHolder ?? null,
      periodFrom: periodFrom ?? null,
      periodTo: periodTo ?? null,
      transactionCount: transactions.length,
      matchedCount: 0,
      unmatchedCount: transactions.length,
      processingStatus: BANK_STATEMENT_PROCESSING_STATUS.COMPLETE,
      source: BANK_STATEMENT_SOURCE.PDF,
      uploadedBy: this.uploadedBy,
    });

    const statementId = String(statement._id);

    if (transactions.length > 0) {
      await BankTransactionModel.insertMany(
        transactions.map(txn => ({
          tenantId,
          statementId,
          date: txn.date,
          description: txn.description,
          reference: txn.reference ?? null,
          debitMinor: txn.debitMinor ?? null,
          creditMinor: txn.creditMinor ?? null,
          balanceMinor: txn.balanceMinor ?? null,
          matchStatus: "unmatched",
          source: BANK_TRANSACTION_SOURCE.PDF,
        })),
      );
    }

    logger.info("bank.statement.pdf.parsed", {
      tenantId,
      statementId,
      transactionCount: transactions.length,
      duplicatesSkipped,
      warningCount: warnings.length,
      bankName,
      accountNumber,
    });

    ctx.store.set(BANK_CTX.STATEMENT_ID, statementId);
    ctx.store.set(BANK_CTX.TRANSACTION_COUNT, transactions.length);
    return {};
  }
}
