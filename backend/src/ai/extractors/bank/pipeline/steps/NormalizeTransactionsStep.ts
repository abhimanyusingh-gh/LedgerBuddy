import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type {
  SlmBankStatementOutput,
  BankStatementTransaction,
} from "@/ai/extractors/bank/BankStatementDocumentDefinition.js";
import { parseAmountToken } from "@/ai/parsers/amountParser.js";
import { BANK_CTX } from "@/ai/extractors/bank/pipeline/contextKeys.js";

export interface ParsedTransaction {
  date: Date;
  description: string;
  reference?: string;
  debitMinor?: number;
  creditMinor?: number;
  balanceMinor?: number;
}

export class NormalizeTransactionsStep implements PipelineStep {
  readonly name = "normalize-transactions";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const slmOutput = ctx.store.require<SlmBankStatementOutput>(BANK_CTX.SLM_OUTPUT);
    const warnings = ctx.store.require<string[]>(BANK_CTX.WARNINGS);

    const rawTransactions = Array.isArray(slmOutput.transactions) ? slmOutput.transactions : [];
    const parsed: ParsedTransaction[] = [];

    for (let i = 0; i < rawTransactions.length; i++) {
      const raw = rawTransactions[i] as BankStatementTransaction;
      if (!raw || typeof raw !== "object") {
        warnings.push(`Transaction at index ${i}: not a valid object, skipped.`);
        continue;
      }

      const rawDate = raw.date as Date | string | undefined;
      const date = rawDate instanceof Date ? rawDate : (typeof rawDate === "string" ? parseDateString(rawDate.trim()) : undefined);
      const description = typeof raw.description === "string" ? raw.description.trim() : "";

      if (!date || !description) {
        warnings.push(`Transaction at index ${i}: missing date or description, skipped.`);
        continue;
      }

      if (isNaN(date.getTime())) {
        warnings.push(`Transaction at index ${i}: invalid date, skipped.`);
        continue;
      }

      const reference = typeof raw.reference === "string" ? raw.reference.trim() || undefined : undefined;
      const debitMinor = normalizeSlmAmount(raw.debit);
      const creditMinor = normalizeSlmAmount(raw.credit);
      const balanceMinor = normalizeSlmAmount(raw.balance);

      if (!debitMinor && !creditMinor) {
        warnings.push(`Transaction at index ${i}: no debit or credit amount, skipped.`);
        continue;
      }

      parsed.push({
        date,
        description,
        reference,
        debitMinor: debitMinor ?? undefined,
        creditMinor: creditMinor ?? undefined,
        balanceMinor: balanceMinor ?? undefined,
      });
    }

    if (parsed.length === 0 && rawTransactions.length > 0) {
      warnings.push("All transactions from SLM output were invalid.");
    }

    ctx.store.set(BANK_CTX.PARSED_TRANSACTIONS, parsed);
    return {};
  }
}

function normalizeSlmAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value === 0) return null;
    return Math.round(Math.abs(value) * 100);
  }

  if (typeof value === "string") {
    const major = parseAmountToken(value);
    if (major === null || major === 0) return null;
    return Math.round(Math.abs(major) * 100);
  }

  return null;
}

function parseDateString(value: string): Date | undefined {
  if (!value) return undefined;

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`);

  const ddmmyyyy = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (ddmmyyyy) return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`);

  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}
