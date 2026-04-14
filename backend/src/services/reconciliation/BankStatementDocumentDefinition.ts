import type { ChunkableDocumentDefinition } from "../../core/engine/DocumentDefinition.js";
import { DOC_TYPE } from "../../core/engine/DocumentDefinition.js";
import type { ValidationResult } from "../../core/engine/types.js";
import { BANK_STATEMENT_EXTRACT_SCHEMA, BANK_STATEMENT_CHUNK_SCHEMA } from "./bankStatementExtractSchema.js";

export interface BankStatementTransaction {
  date?: string;
  description?: string;
  reference?: string;
  debit?: number | null;
  credit?: number | null;
  balance?: number | null;
}

export interface SlmBankStatementOutput {
  bankName?: string;
  accountNumber?: string;
  accountHolder?: string;
  periodFrom?: Date;
  periodTo?: Date;
  transactions?: BankStatementTransaction[];
}

export class BankStatementDocumentDefinition implements ChunkableDocumentDefinition<SlmBankStatementOutput> {
  readonly docType = DOC_TYPE.BANK_STATEMENT;
  readonly preferNativePdfText = true;
  readonly nativePdfTextMinLength = 100;
  readonly maxChunkChars = 8000;
  readonly chunkingStrategy = "page-based" as const;
  readonly extractionSchema = BANK_STATEMENT_EXTRACT_SCHEMA;
  readonly chunkSchema = BANK_STATEMENT_CHUNK_SCHEMA;

  parseOutput(raw: string | Record<string, unknown>): SlmBankStatementOutput {
    if (typeof raw === "object") {
      return normalizeRawOutput(raw);
    }
    return normalizeRawOutput(parseSlmJson(raw));
  }

  mergeChunkOutputs(chunks: SlmBankStatementOutput[]): SlmBankStatementOutput {
    if (chunks.length === 0) {
      return { transactions: [] };
    }

    const first = chunks[0];
    const allTransactions: BankStatementTransaction[] = [];

    for (const chunk of chunks) {
      const txns = Array.isArray(chunk.transactions) ? chunk.transactions : [];
      allTransactions.push(...txns);
    }

    return {
      bankName: first.bankName,
      accountNumber: first.accountNumber,
      accountHolder: first.accountHolder,
      periodFrom: first.periodFrom,
      periodTo: first.periodTo,
      transactions: allTransactions
    };
  }

  validateOutput(_output: SlmBankStatementOutput): ValidationResult {
    return { valid: true, issues: [] };
  }
}

function parseStatementDate(val: unknown): Date | undefined {
  if (typeof val !== "string" || !val.trim()) return undefined;
  const v = val.trim();
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(`${iso[1]}-${iso[2]}-${iso[3]}`);
  const dmy = v.match(/^(\d{1,2})[\/\-.]+(\d{1,2})[\/\-.]+(\d{4})/);
  if (dmy) return new Date(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`);
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

function normalizeRawOutput(raw: Record<string, unknown>): SlmBankStatementOutput {
  const bankName = raw["bankName"] ?? raw["bank_name"];
  const accountNumber = raw["accountNumber"] ?? raw["account_number"];
  const accountHolder = raw["accountHolder"] ?? raw["account_holder"];
  const rawTxns = raw["transactions"];

  const transactions: BankStatementTransaction[] = Array.isArray(rawTxns)
    ? (rawTxns as Record<string, unknown>[]).map(t => ({
        date: typeof t["date"] === "string" ? t["date"] : undefined,
        description: typeof t["description"] === "string" ? t["description"] : undefined,
        reference: typeof t["reference"] === "string" ? t["reference"] : undefined,
        debit: (typeof t["debit"] === "number" || t["debit"] === null) ? t["debit"] as number | null : undefined,
        credit: (typeof t["credit"] === "number" || t["credit"] === null) ? t["credit"] as number | null : undefined,
        balance: (typeof t["balance"] === "number" || t["balance"] === null) ? t["balance"] as number | null : undefined
      }))
    : [];

  return {
    bankName: typeof bankName === "string" ? bankName.trim() || undefined : undefined,
    accountNumber: typeof accountNumber === "string" ? accountNumber.trim() || undefined : undefined,
    accountHolder: typeof accountHolder === "string" ? accountHolder.trim() || undefined : undefined,
    periodFrom: parseStatementDate(raw["periodFrom"] ?? raw["period_from"]),
    periodTo: parseStatementDate(raw["periodTo"] ?? raw["period_to"]),
    transactions
  };
}

function parseSlmJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    return JSON.parse(jsonBlockMatch[1].trim()) as Record<string, unknown>;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  }

  return JSON.parse(trimmed) as Record<string, unknown>;
}
