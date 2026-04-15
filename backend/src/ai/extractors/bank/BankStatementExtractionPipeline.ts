import type { UUID } from "@/types/uuid.js";
import type { DocumentMimeType } from "@/types/mime.js";
import { BankStatementModel, BANK_STATEMENT_SOURCE, type BankStatementSource } from "@/models/bank/BankStatement.js";
import { BankTransactionModel, BANK_TRANSACTION_SOURCE, type BankTransactionSource } from "@/models/bank/BankTransaction.js";
import { logger } from "@/utils/logger.js";
import { parseAmountToken } from "@/ai/parsers/amountParser.js";
import type { OcrProvider } from "@/core/interfaces/OcrProvider.js";
import type { FieldVerifier } from "@/core/interfaces/FieldVerifier.js";
import type { BankParseProgressEvent } from "@/ai/extractors/bank/BankStatementParseProgress.js";
import { DocumentProcessingEngine, type DocumentProcessingProgressEvent } from "@/core/engine/DocumentProcessingEngine.js";
import {
  BankStatementDocumentDefinition,
  type SlmBankStatementOutput,
} from "@/ai/extractors/bank/BankStatementDocumentDefinition.js";
import { ContextStore } from "@/core/pipeline/PipelineContext.js";
import { buildBankPostEnginePipeline, type BankPdfParseResult } from "@/ai/extractors/bank/pipeline/bankPipelineFactory.js";
import { BANK_CTX } from "@/ai/extractors/bank/pipeline/contextKeys.js";

type OnParseProgress = (event: BankParseProgressEvent) => void;

interface ParsedTransaction {
  date: Date;
  description: string;
  reference?: string;
  debitMinor?: number;
  creditMinor?: number;
  balanceMinor?: number;
}

export class BankStatementExtractionPipeline {
  private readonly ocrProvider: OcrProvider | null;
  private readonly fieldVerifier: FieldVerifier | null;

  constructor(options?: { ocrProvider?: OcrProvider; fieldVerifier?: FieldVerifier }) {
    this.ocrProvider = options?.ocrProvider ?? null;
    this.fieldVerifier = options?.fieldVerifier ?? null;
  }

  async parseCsv(
    tenantId: UUID,
    fileName: string,
    csvContent: string,
    columnMapping: { date: number; description: number; debit: number; credit: number; reference?: number; balance?: number },
    uploadedBy: string
  ): Promise<{ statementId: string; transactionCount: number; duplicatesSkipped: number }> {
    const statementSource: BankStatementSource = BANK_STATEMENT_SOURCE.CSV;
    const txnSource: BankTransactionSource = BANK_TRANSACTION_SOURCE.CSV;
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

      const parsedDate = parseDateString(date);
      if (!parsedDate || isNaN(parsedDate.getTime())) continue;

      parsed.push({
        date: parsedDate,
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
        source: statementSource,
        uploadedBy
      });
      const statementId = String(statement._id);
      logger.info("bank.statement.csv.parsed", { tenantId, statementId, transactionCount: 0, duplicatesSkipped: 0 });
      return { statementId, transactionCount: 0, duplicatesSkipped: 0 };
    }

    const timestamps = parsed.map(t => t.date.getTime());
    const minDate = parsed[timestamps.indexOf(Math.min(...timestamps))]!.date;
    const maxDate = parsed[timestamps.indexOf(Math.max(...timestamps))]!.date;

    const existing = await BankTransactionModel.find({
      tenantId,
      date: { $gte: minDate, $lte: maxDate }
    }).lean();

    const existingFingerprints = new Set(
      existing.map(e => `${e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date)}|${e.description}|${e.debitMinor ?? ""}|${e.creditMinor ?? ""}|${e.reference ?? ""}`)
    );

    const transactions: ParsedTransaction[] = [];
    let duplicatesSkipped = 0;
    for (const txn of parsed) {
      const fp = `${txn.date.toISOString().slice(0, 10)}|${txn.description}|${txn.debitMinor ?? ""}|${txn.creditMinor ?? ""}|${txn.reference ?? ""}`;
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
      source: statementSource,
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
          source: txnSource
        }))
      );
    }

    logger.info("bank.statement.csv.parsed", { tenantId, statementId, transactionCount: transactions.length, duplicatesSkipped });
    return { statementId, transactionCount: transactions.length, duplicatesSkipped };
  }

  async parsePdf(
    tenantId: UUID,
    fileName: string,
    buffer: Buffer,
    mimeType: DocumentMimeType,
    uploadedBy: string,
    onProgress?: OnParseProgress
  ): Promise<BankPdfParseResult> {
    if (!this.fieldVerifier) {
      throw new Error("SLM field verifier is not available. Cannot parse PDF bank statements.");
    }

    onProgress?.({ type: "start", fileName });
    onProgress?.({ type: "progress", stage: "text-extraction", transactionsSoFar: 0 });

    // Stage 1: Run DocumentProcessingEngine (handles OCR/native text + SLM)
    const definition = new BankStatementDocumentDefinition();
    const engine = new DocumentProcessingEngine<SlmBankStatementOutput>(
      definition,
      this.fieldVerifier,
      this.ocrProvider ?? undefined
    );

    const engineResult = await engine.process(
      { tenantId, fileName, mimeType, fileBuffer: buffer },
      (event: DocumentProcessingProgressEvent) => {
        if (event.stage === "slm-chunk") {
          onProgress?.({
            type: "progress",
            stage: "slm-chunk",
            chunk: event.chunk,
            totalChunks: event.totalChunks,
            transactionsSoFar: 0
          });
        }
      }
    );

    onProgress?.({ type: "progress", stage: "validation", transactionsSoFar: 0 });

    // Stage 2: Run composed post-engine pipeline (normalize, dedup, persist)
    const slmOutput = engineResult.output;
    const warnings: string[] = [...engineResult.processingIssues];

    const bankName = typeof slmOutput.bankName === "string" ? slmOutput.bankName.trim() || undefined : undefined;
    const accountNumber = typeof slmOutput.accountNumber === "string" ? slmOutput.accountNumber.trim() || undefined : undefined;
    const accountHolder = typeof slmOutput.accountHolder === "string" ? slmOutput.accountHolder.trim() || undefined : undefined;
    const periodFrom = slmOutput.periodFrom ?? undefined;
    const periodTo = slmOutput.periodTo ?? undefined;

    const pipelineInput = { tenantId, fileName, mimeType, fileBuffer: buffer };

    const store = new ContextStore();
    store.set(BANK_CTX.SLM_OUTPUT, slmOutput);
    store.set(BANK_CTX.WARNINGS, warnings);
    store.set(BANK_CTX.BANK_NAME, bankName);
    store.set(BANK_CTX.ACCOUNT_NUMBER, accountNumber);
    store.set(BANK_CTX.ACCOUNT_HOLDER, accountHolder);
    store.set(BANK_CTX.PERIOD_FROM, periodFrom);
    store.set(BANK_CTX.PERIOD_TO, periodTo);

    const pipeline = buildBankPostEnginePipeline({ uploadedBy });
    const ctx = {
      input: pipelineInput,
      store,
      metadata: {} as Record<string, string>,
      issues: [] as string[],
    };

    const result = await pipeline.executeWithContext(ctx);

    onProgress?.({
      type: "complete",
      statementId: result.output.statementId,
      transactionCount: result.output.transactionCount,
      warnings: result.output.warnings
    });

    return result.output;
  }
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
  const major = parseAmountToken(value);
  if (major === null || major === 0) return null;
  return Math.round(Math.abs(major) * 100);
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
