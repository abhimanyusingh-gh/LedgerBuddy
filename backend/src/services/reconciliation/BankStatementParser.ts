import { BankStatementModel } from "../../models/BankStatement.js";
import { BankTransactionModel, BANK_TRANSACTION_SOURCES } from "../../models/BankTransaction.js";
import { BANK_STATEMENT_SOURCES } from "../../models/BankStatement.js";
import { logger } from "../../utils/logger.js";
import type { OcrProvider } from "../../core/interfaces/OcrProvider.js";
import type { FieldVerifier } from "../../core/interfaces/FieldVerifier.js";
import type { BankParseProgressEvent } from "./BankStatementParseProgress.js";
import { DocumentProcessingEngine } from "../../core/engine/DocumentProcessingEngine.js";
import {
  BankStatementDocumentDefinition,
  type SlmBankStatementOutput,
  type BankStatementTransaction
} from "./BankStatementDocumentDefinition.js";

type OnParseProgress = (event: BankParseProgressEvent) => void;

interface ParsedTransaction {
  date: string;
  description: string;
  reference?: string;
  debitMinor?: number;
  creditMinor?: number;
  balanceMinor?: number;
}


interface PdfParseResult {
  statementId: string;
  transactionCount: number;
  duplicatesSkipped: number;
  warnings: string[];
  bankName?: string;
  accountNumber?: string;
  periodFrom?: string;
  periodTo?: string;
}

export class BankStatementParser {
  private readonly ocrProvider: OcrProvider | null;
  private readonly fieldVerifier: FieldVerifier | null;

  constructor(options?: { ocrProvider?: OcrProvider; fieldVerifier?: FieldVerifier }) {
    this.ocrProvider = options?.ocrProvider ?? null;
    this.fieldVerifier = options?.fieldVerifier ?? null;
  }

  async parseCsv(
    tenantId: string,
    fileName: string,
    csvContent: string,
    columnMapping: { date: number; description: number; debit: number; credit: number; reference?: number; balance?: number },
    uploadedBy: string
  ): Promise<{ statementId: string; transactionCount: number; duplicatesSkipped: number }> {
    const lines = csvContent.split("\n").filter(l => l.trim());
    if (lines.length < 2) throw new Error("CSV must have at least a header row and one data row.");

    const parsed: ParsedTransaction[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const date = cols[columnMapping.date]?.trim();
      const description = cols[columnMapping.description]?.trim();
      if (!date || !description) continue;

      const debitRaw = cols[columnMapping.debit]?.trim();
      const creditRaw = cols[columnMapping.credit]?.trim();
      const debitMinor = parseAmountToMinor(debitRaw);
      const creditMinor = parseAmountToMinor(creditRaw);

      if (!debitMinor && !creditMinor) continue;

      const reference = columnMapping.reference !== undefined ? cols[columnMapping.reference]?.trim() : undefined;

      parsed.push({
        date: normalizeDate(date),
        description,
        reference,
        debitMinor: debitMinor ?? undefined,
        creditMinor: creditMinor ?? undefined,
        balanceMinor: columnMapping.balance !== undefined ? parseAmountToMinor(cols[columnMapping.balance]?.trim()) ?? undefined : undefined
      });
    }

    if (parsed.length === 0) {
      const statement = await BankStatementModel.create({
        tenantId,
        fileName,
        transactionCount: 0,
        matchedCount: 0,
        unmatchedCount: 0,
        source: BANK_STATEMENT_SOURCES[1],
        uploadedBy
      });
      const statementId = String(statement._id);
      logger.info("bank.statement.csv.parsed", { tenantId, statementId, transactionCount: 0, duplicatesSkipped: 0 });
      return { statementId, transactionCount: 0, duplicatesSkipped: 0 };
    }

    const dates = parsed.map(t => t.date);
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));

    const existing = await BankTransactionModel.find({
      tenantId,
      date: { $gte: minDate, $lte: maxDate }
    }).lean();

    const existingFingerprints = new Set(
      existing.map(e => `${e.date}|${e.description}|${e.debitMinor ?? ""}|${e.creditMinor ?? ""}|${e.reference ?? ""}`)
    );

    const transactions: ParsedTransaction[] = [];
    let duplicatesSkipped = 0;
    for (const txn of parsed) {
      const fp = `${txn.date}|${txn.description}|${txn.debitMinor ?? ""}|${txn.creditMinor ?? ""}|${txn.reference ?? ""}`;
      if (existingFingerprints.has(fp)) {
        duplicatesSkipped++;
      } else {
        transactions.push(txn);
        existingFingerprints.add(fp);
      }
    }

    const statement = await BankStatementModel.create({
      tenantId,
      fileName,
      transactionCount: transactions.length,
      matchedCount: 0,
      unmatchedCount: transactions.length,
      source: "csv-import",
      uploadedBy
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
          source: BANK_TRANSACTION_SOURCES[1]
        }))
      );
    }

    logger.info("bank.statement.csv.parsed", { tenantId, statementId, transactionCount: transactions.length, duplicatesSkipped });
    return { statementId, transactionCount: transactions.length, duplicatesSkipped };
  }

  async parsePdf(
    tenantId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
    uploadedBy: string,
    onProgress?: OnParseProgress
  ): Promise<PdfParseResult> {
    if (!this.fieldVerifier) {
      throw new Error("SLM field verifier is not available. Cannot parse PDF bank statements.");
    }

    onProgress?.({ type: "start", fileName });
    onProgress?.({ type: "progress", stage: "text-extraction", transactionsSoFar: 0 });

    const definition = new BankStatementDocumentDefinition();
    const engine = new DocumentProcessingEngine<SlmBankStatementOutput>(
      definition,
      this.fieldVerifier,
      this.ocrProvider ?? undefined
    );

    const engineResult = await engine.process(
      { tenantId, fileName, mimeType, fileBuffer: buffer },
      (event) => {
        const e = event as Record<string, unknown>;
        if (e.stage === "slm-chunk") {
          onProgress?.({
            type: "progress",
            stage: "slm-chunk",
            chunk: e.chunk as number,
            totalChunks: e.totalChunks as number,
            transactionsSoFar: 0
          });
        }
      }
    );

    const slmOutput = engineResult.output;
    const warnings: string[] = [...engineResult.processingIssues];

    const bankName = typeof slmOutput.bankName === "string" ? slmOutput.bankName.trim() || undefined : undefined;
    const accountNumber = typeof slmOutput.accountNumber === "string" ? slmOutput.accountNumber.trim() || undefined : undefined;
    const accountHolder = typeof slmOutput.accountHolder === "string" ? slmOutput.accountHolder.trim() || undefined : undefined;
    const periodFrom = typeof slmOutput.periodFrom === "string" ? normalizeDate(slmOutput.periodFrom.trim()) : undefined;
    const periodTo = typeof slmOutput.periodTo === "string" ? normalizeDate(slmOutput.periodTo.trim()) : undefined;

    onProgress?.({ type: "progress", stage: "validation", transactionsSoFar: 0 });

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
        balanceMinor: balanceMinor ?? undefined
      });
    }

    if (parsed.length === 0 && rawTransactions.length > 0) {
      warnings.push("All transactions from SLM output were invalid.");
    }

    let duplicatesSkipped = 0;
    let transactions = parsed;

    if (parsed.length > 0) {
      const dates = parsed.map(t => t.date);
      const minDate = dates.reduce((a, b) => (a < b ? a : b));
      const maxDate = dates.reduce((a, b) => (a > b ? a : b));

      const existing = await BankTransactionModel.find({
        tenantId,
        date: { $gte: minDate, $lte: maxDate }
      }).lean();

      const existingFingerprints = new Set(
        existing.map(e => `${e.date}|${e.description}|${e.debitMinor ?? ""}|${e.creditMinor ?? ""}|${e.reference ?? ""}`)
      );

      const deduplicated: ParsedTransaction[] = [];
      for (const txn of parsed) {
        const fp = `${txn.date}|${txn.description}|${txn.debitMinor ?? ""}|${txn.creditMinor ?? ""}|${txn.reference ?? ""}`;
        if (existingFingerprints.has(fp)) {
          duplicatesSkipped++;
        } else {
          deduplicated.push(txn);
          existingFingerprints.add(fp);
        }
      }
      transactions = deduplicated;
    }

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
      source: BANK_STATEMENT_SOURCES[0],
      uploadedBy
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
          source: BANK_TRANSACTION_SOURCES[2]
        }))
      );
    }

    logger.info("bank.statement.pdf.parsed", {
      tenantId,
      statementId,
      transactionCount: transactions.length,
      duplicatesSkipped,
      warningCount: warnings.length,
      bankName,
      accountNumber
    });

    onProgress?.({
      type: "complete",
      statementId,
      transactionCount: transactions.length,
      warnings
    });

    return {
      statementId,
      transactionCount: transactions.length,
      duplicatesSkipped,
      warnings,
      bankName,
      accountNumber,
      periodFrom,
      periodTo
    };
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

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (char === "," && !inQuotes) { result.push(current); current = ""; continue; }
    current += char;
  }
  result.push(current);
  return result;
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
