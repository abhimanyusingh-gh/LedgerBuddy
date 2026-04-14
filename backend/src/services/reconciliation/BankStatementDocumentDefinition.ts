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
  periodFrom?: string;
  periodTo?: string;
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
        bankName: typeof raw["bank_name"] === "string" ? raw["bank_name"] : undefined,
        accountNumber: typeof raw["account_number"] === "string" ? raw["account_number"] : undefined,
        accountHolder: typeof raw["account_holder"] === "string" ? raw["account_holder"] : undefined,
        periodFrom: typeof raw["period_from"] === "string" ? raw["period_from"] : undefined,
        periodTo: typeof raw["period_to"] === "string" ? raw["period_to"] : undefined,
        transactions
      };
    }
    return parseSlmJson(raw);
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

function parseSlmJson(text: string): SlmBankStatementOutput {
  const trimmed = text.trim();

  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    return JSON.parse(jsonBlockMatch[1].trim()) as SlmBankStatementOutput;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1)) as SlmBankStatementOutput;
  }

  return JSON.parse(trimmed) as SlmBankStatementOutput;
}
