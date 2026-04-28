import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import { BankTransactionModel } from "@/models/bank/BankTransaction.js";
import type { ParsedTransaction } from "@/ai/extractors/bank/pipeline/steps/NormalizeTransactionsStep.js";
import { BANK_CTX } from "@/ai/extractors/bank/pipeline/contextKeys.js";

export class DeduplicateTransactionsStep implements PipelineStep {
  readonly name = "deduplicate-transactions";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const tenantId = ctx.input.tenantId;
    const parsed = ctx.store.require<ParsedTransaction[]>(BANK_CTX.PARSED_TRANSACTIONS);

    if (parsed.length === 0) {
      ctx.store.set(BANK_CTX.DEDUPLICATED_TRANSACTIONS, []);
      ctx.store.set(BANK_CTX.DUPLICATES_SKIPPED, 0);
      return {};
    }

    const timestamps = parsed.map(t => new Date(t.date).getTime());
    const minDate = parsed[timestamps.indexOf(Math.min(...timestamps))]!.date;
    const maxDate = parsed[timestamps.indexOf(Math.max(...timestamps))]!.date;

    const existing = await BankTransactionModel.find({
      tenantId,
      date: { $gte: minDate, $lte: maxDate },
    }).lean();

    const existingFingerprints = new Set(
      existing.map(e => `${e.date}|${e.description}|${e.debitMinor ?? ""}|${e.creditMinor ?? ""}|${e.reference ?? ""}`),
    );

    const deduplicated: ParsedTransaction[] = [];
    let duplicatesSkipped = 0;

    for (const txn of parsed) {
      const fp = `${txn.date}|${txn.description}|${txn.debitMinor ?? ""}|${txn.creditMinor ?? ""}|${txn.reference ?? ""}`;
      if (existingFingerprints.has(fp)) {
        duplicatesSkipped++;
      } else {
        deduplicated.push(txn);
        existingFingerprints.add(fp);
      }
    }

    ctx.store.set(BANK_CTX.DEDUPLICATED_TRANSACTIONS, deduplicated);
    ctx.store.set(BANK_CTX.DUPLICATES_SKIPPED, duplicatesSkipped);
    return {};
  }
}
