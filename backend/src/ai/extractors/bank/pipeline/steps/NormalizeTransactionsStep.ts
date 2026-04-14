import type { PipelineStage, StageResult } from "@/core/pipeline/PipelineStage.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type {
  SlmBankStatementOutput,
  BankStatementTransaction,
} from "../../BankStatementDocumentDefinition.js";
import { BANK_CTX } from "../contextKeys.js";

export interface ParsedTransaction {
  date: string;
  description: string;
  reference?: string;
  debitMinor?: number;
  creditMinor?: number;
  balanceMinor?: number;
}

/**
 * Validates and normalizes raw SLM transaction output:
 * - Validates each transaction has date, description, and at least one amount
 * - Normalizes dates to ISO 8601 (YYYY-MM-DD)
 * - Converts amounts from major units to minor units (paise/cents)
 * - Collects warnings for skipped transactions
 */
export class NormalizeTransactionsStep implements PipelineStage {
  readonly name = "normalize-transactions";

  async execute(ctx: PipelineContext): Promise<StageResult> {
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

      const date = typeof raw.date === "string" ? raw.date.trim() : "";
      const description = typeof raw.description === "string" ? raw.description.trim() : "";

      if (!date || !description) {
        warnings.push(`Transaction at index ${i}: missing date or description, skipped.`);
        continue;
      }

      const normalizedDate = normalizeDate(date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
        warnings.push(`Transaction at index ${i}: invalid date format "${date}", skipped.`);
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
        date: normalizedDate,
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
    return parseAmountToMinor(value);
  }

  return null;
}

function parseAmountToMinor(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.,\-]/g, "").trim();
  if (!cleaned) return null;

  let normalized = cleaned;
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    const parts = normalized.split(",");
    const lastPart = parts[parts.length - 1];
    normalized = lastPart.length <= 2 ? normalized.replace(",", ".") : normalized.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return Math.round(Math.abs(parsed) * 100);
}

function normalizeDate(value: string): string {
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return value.substring(0, 10);

  const ddmmyyyy = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;

  return value;
}
