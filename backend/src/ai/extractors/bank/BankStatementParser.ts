import { BankStatementModel } from "../../../models/bank/BankStatement.js";
import { BankTransactionModel } from "../../../models/bank/BankTransaction.js";
import { logger } from "../../../utils/logger.js";
import { extractNativePdfText } from "../invoice/stages/nativePdfText.js";
import type { OcrProvider } from "../../../core/interfaces/OcrProvider.js";
import type { FieldVerifier } from "../../../core/interfaces/FieldVerifier.js";
import type { BankParseProgressEvent } from "./BankStatementParseProgress.js";

type OnParseProgress = (event: BankParseProgressEvent) => void;

interface ParsedTransaction {
  date: string;
  description: string;
  reference?: string;
  debitMinor?: number;
  creditMinor?: number;
  balanceMinor?: number;
}

interface SlmBankTransaction {
  date?: unknown;
  description?: unknown;
  reference?: unknown;
  debit?: unknown;
  credit?: unknown;
  balance?: unknown;
}

interface SlmBankStatementOutput {
  bankName?: unknown;
  accountNumber?: unknown;
  accountHolder?: unknown;
  periodFrom?: unknown;
  periodTo?: unknown;
  transactions?: unknown;
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

const NATIVE_TEXT_MIN_LENGTH = 100;
const CHUNK_THRESHOLD = 8000;
const CHUNK_TARGET_SIZE = 6000;

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
        source: "csv-import",
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
          source: "csv-import"
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

    const warnings: string[] = [];
    let extractedText = "";
    let textSource: "native" | "ocr" = "native";

    logger.info("bank.statement.pdf.native.start", { tenantId, fileName, mimeType });
    onProgress?.({ type: "progress", stage: "text-extraction", transactionsSoFar: 0 });
    const nativeText = extractNativePdfText(buffer, mimeType);

    if (nativeText.length >= NATIVE_TEXT_MIN_LENGTH) {
      extractedText = nativeText;
      textSource = "native";
      logger.info("bank.statement.pdf.native.success", {
        tenantId,
        fileName,
        textLength: nativeText.length
      });
    } else {
      if (!this.ocrProvider) {
        throw new Error("Native PDF text extraction yielded insufficient text and OCR provider is not available.");
      }

      logger.info("bank.statement.pdf.native.insufficient", {
        tenantId,
        fileName,
        nativeTextLength: nativeText.length,
        threshold: NATIVE_TEXT_MIN_LENGTH
      });

      logger.info("bank.statement.pdf.ocr.start", { tenantId, fileName, mimeType });
      onProgress?.({ type: "progress", stage: "ocr", transactionsSoFar: 0 });
      let ocrResult;
      try {
        ocrResult = await this.ocrProvider.extractText(buffer, mimeType);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`OCR extraction failed for bank statement: ${msg}`);
      }

      if (!ocrResult.text || ocrResult.text.trim().length === 0) {
        throw new Error("No text could be extracted from the uploaded file. The file may be empty or unreadable.");
      }

      extractedText = ocrResult.text;
      textSource = "ocr";
      logger.info("bank.statement.pdf.ocr.end", {
        tenantId,
        fileName,
        textLength: ocrResult.text.length,
        blockCount: ocrResult.blocks?.length ?? 0
      });
    }

    let slmOutput: SlmBankStatementOutput;

    if (extractedText.length > CHUNK_THRESHOLD) {
      logger.info("bank.statement.pdf.chunked.start", {
        tenantId,
        fileName,
        textLength: extractedText.length,
        textSource
      });
      slmOutput = await this.processChunked(extractedText, mimeType, warnings, onProgress);
    } else {
      onProgress?.({ type: "progress", stage: "slm-chunk", chunk: 1, totalChunks: 1, transactionsSoFar: 0 });
      const prompt = buildBankStatementExtractionPrompt(extractedText);
      const slmResponseText = await this.callSlm(prompt, mimeType);

      try {
        slmOutput = parseSlmJson(slmResponseText);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse SLM response as JSON: ${msg}`);
      }
    }

    const bankName = typeof slmOutput.bankName === "string" ? slmOutput.bankName.trim() || undefined : undefined;
    const accountNumber = typeof slmOutput.accountNumber === "string" ? slmOutput.accountNumber.trim() || undefined : undefined;
    const periodFrom = typeof slmOutput.periodFrom === "string" ? normalizeDate(slmOutput.periodFrom.trim()) : undefined;
    const periodTo = typeof slmOutput.periodTo === "string" ? normalizeDate(slmOutput.periodTo.trim()) : undefined;

    onProgress?.({ type: "progress", stage: "validation", transactionsSoFar: 0 });

    const rawTransactions = Array.isArray(slmOutput.transactions) ? slmOutput.transactions : [];
    const parsed: ParsedTransaction[] = [];

    for (let i = 0; i < rawTransactions.length; i++) {
      const raw = rawTransactions[i] as SlmBankTransaction;
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
      periodFrom: periodFrom ?? null,
      periodTo: periodTo ?? null,
      transactionCount: transactions.length,
      matchedCount: 0,
      unmatchedCount: transactions.length,
      source: "pdf-parsed",
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
          source: "pdf-parsed"
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
      accountNumber,
      textSource
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

  private async processChunked(
    fullText: string,
    mimeType: string,
    warnings: string[],
    onProgress?: OnParseProgress
  ): Promise<SlmBankStatementOutput> {
    const chunks = splitTextIntoChunks(fullText);

    logger.info("bank.statement.pdf.chunked.split", { chunkCount: chunks.length });

    let headerOutput: SlmBankStatementOutput | null = null;
    const allTransactions: unknown[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const isFirst = i === 0;

      onProgress?.({
        type: "progress",
        stage: "slm-chunk",
        chunk: i + 1,
        totalChunks: chunks.length,
        transactionsSoFar: allTransactions.length
      });

      const prompt = isFirst
        ? buildBankStatementExtractionPrompt(chunks[i])
        : buildChunkExtractionPrompt(chunks[i]);

      let responseText: string;
      try {
        responseText = await this.callSlm(prompt, mimeType);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        warnings.push(`Chunk ${i + 1}/${chunks.length} SLM call failed: ${msg}`);
        continue;
      }

      let chunkOutput: SlmBankStatementOutput;
      try {
        chunkOutput = parseSlmJson(responseText);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        warnings.push(`Chunk ${i + 1}/${chunks.length} JSON parse failed: ${msg}`);
        continue;
      }

      if (isFirst) {
        headerOutput = chunkOutput;
      }

      const chunkTxns = Array.isArray(chunkOutput.transactions) ? chunkOutput.transactions : [];
      allTransactions.push(...chunkTxns);
    }

    return {
      bankName: headerOutput?.bankName,
      accountNumber: headerOutput?.accountNumber,
      accountHolder: headerOutput?.accountHolder,
      periodFrom: headerOutput?.periodFrom,
      periodTo: headerOutput?.periodTo,
      transactions: allTransactions
    };
  }

  private async callSlm(prompt: string, mimeType: string): Promise<string> {
    if (!this.fieldVerifier) {
      throw new Error("SLM field verifier is not available.");
    }

    const verifierResult = await this.fieldVerifier.verify({
      parsed: { invoiceNumber: "__bank_statement_extraction__" } as never,
      ocrText: prompt,
      ocrBlocks: [],
      mode: "relaxed",
      hints: {
        mimeType,
        vendorTemplateMatched: false,
        fieldCandidates: {},
        llmAssist: true
      }
    });

    const contract = verifierResult.contract;
    const rawParsed = verifierResult.parsed as unknown as Record<string, unknown>;
    const rawJson =
      (contract as unknown as Record<string, unknown>)?.rawJson ??
      rawParsed?.rawJson ??
      rawParsed?.bankStatementData;

    if (typeof rawJson === "string") {
      return rawJson;
    } else if (rawJson && typeof rawJson === "object") {
      return JSON.stringify(rawJson);
    }
    return JSON.stringify(rawParsed);
  }
}

function buildBankStatementExtractionPrompt(text: string): string {
  return [
    "You are extracting transactions from an Indian bank statement.",
    "",
    "INPUT TEXT:",
    text,
    "",
    "Extract ALL transactions into JSON:",
    "{",
    '  "bankName": "string",',
    '  "accountNumber": "string (full or last 4 digits)",',
    '  "accountHolder": "string",',
    '  "periodFrom": "YYYY-MM-DD",',
    '  "periodTo": "YYYY-MM-DD",',
    '  "transactions": [',
    "    {",
    '      "date": "YYYY-MM-DD",',
    '      "description": "string (full transaction remarks)",',
    '      "debit": number or null (in rupees, e.g., 1001.00),',
    '      "credit": number or null (in rupees),',
    '      "balance": number or null (in rupees)',
    "    }",
    "  ]",
    "}",
    "",
    "RULES:",
    "- Extract EVERY transaction, do not skip any",
    "- Dates: convert DD.MM.YYYY to YYYY-MM-DD",
    "- Amounts: decimal numbers in rupees (NOT paise)",
    "- Include the full transaction description/remarks",
    "- JSON only, no explanation"
  ].join("\n");
}

function buildChunkExtractionPrompt(text: string): string {
  return [
    "You are extracting transactions from a portion of an Indian bank statement.",
    "This is a continuation — extract only the transactions visible in this text.",
    "",
    "INPUT TEXT:",
    text,
    "",
    "Extract ALL transactions into JSON:",
    "{",
    '  "transactions": [',
    "    {",
    '      "date": "YYYY-MM-DD",',
    '      "description": "string (full transaction remarks)",',
    '      "debit": number or null (in rupees, e.g., 1001.00),',
    '      "credit": number or null (in rupees),',
    '      "balance": number or null (in rupees)',
    "    }",
    "  ]",
    "}",
    "",
    "RULES:",
    "- Extract EVERY transaction, do not skip any",
    "- Dates: convert DD.MM.YYYY to YYYY-MM-DD",
    "- Amounts: decimal numbers in rupees (NOT paise)",
    "- Include the full transaction description/remarks",
    "- JSON only, no explanation"
  ].join("\n");
}

function splitTextIntoChunks(text: string): string[] {
  const pageBreaks = text.split(/\n(?=\f)|(?<=\f)\n|\f/);
  const pages = pageBreaks.length > 1
    ? pageBreaks.filter(p => p.trim().length > 0)
    : [text];

  if (pages.length > 1) {
    const chunks: string[] = [];
    let current = "";

    for (const page of pages) {
      if (current.length + page.length > CHUNK_TARGET_SIZE && current.length > 0) {
        chunks.push(current);
        current = page;
      } else {
        current += (current ? "\n" : "") + page;
      }
    }
    if (current.trim()) {
      chunks.push(current);
    }
    return chunks.length > 0 ? chunks : [text];
  }

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > CHUNK_TARGET_SIZE && current.length > 0) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current.trim()) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [text];
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

function parseSlmJson(text: string): SlmBankStatementOutput {
  const trimmed = text.trim();

  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    return JSON.parse(jsonBlockMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
  }

  return JSON.parse(trimmed);
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
