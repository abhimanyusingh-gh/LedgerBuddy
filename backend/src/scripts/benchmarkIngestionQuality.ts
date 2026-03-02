import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeepSeekOcrProvider } from "../ocr/DeepSeekOcrProvider.js";
import { InvoiceExtractionPipeline } from "../services/extraction/InvoiceExtractionPipeline.js";
import { InMemoryVendorTemplateStore } from "../services/extraction/vendorTemplateStore.js";
import { NoopFieldVerifier } from "../verifier/NoopFieldVerifier.js";
import type { ParsedInvoiceData } from "../types/invoice.js";

interface Invoice2DataGroundTruth {
  invoice_number?: unknown;
  amount?: unknown;
  currency?: unknown;
  date?: unknown;
}

interface BenchmarkCase {
  filePath: string;
  fileName: string;
  mimeType: string;
  truth: Invoice2DataGroundTruth;
}

interface FieldScores {
  invoiceNumber: { matched: number; total: number };
  currency: { matched: number; total: number };
  totalAmountMinor: { matched: number; total: number };
  invoiceDate: { matched: number; total: number };
}

interface VariantSummary {
  name: string;
  comparedFields: number;
  matchedFields: number;
  accuracy: number;
  perfectInvoices: number;
  totalInvoices: number;
  fieldScores: FieldScores;
  files: Array<{
    file: string;
    matched: number;
    total: number;
    accuracy: number;
    parsed: ParsedInvoiceData;
  }>;
}

interface VariantConfig {
  name: string;
  enforceKeyValuePairs: boolean;
  enableOcrKeyValueGrounding: boolean;
}

const LEGACY_PROMPT = "<|grounding|>Convert page to markdown.";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const BENCHMARK_ROOT = path.join(REPO_ROOT, "sample-invoices", "benchmark");
const BENCHMARK_INBOX = path.join(BENCHMARK_ROOT, "inbox");
const BENCHMARK_GROUND_TRUTH = path.join(BENCHMARK_ROOT, "ground-truth", "invoice2data");

async function main(): Promise<void> {
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "http://127.0.0.1:8000/v1").trim();
  const benchmarkCases = await loadInvoice2DataCases();
  if (benchmarkCases.length === 0) {
    throw new Error("No invoice2data benchmark files found.");
  }

  const variants: VariantConfig[] = [
    {
      name: "baseline",
      enforceKeyValuePairs: false,
      enableOcrKeyValueGrounding: false
    },
    {
      name: "enhanced",
      enforceKeyValuePairs: true,
      enableOcrKeyValueGrounding: true
    }
  ];

  const summaries: VariantSummary[] = [];
  for (const variant of variants) {
    summaries.push(await runVariantBenchmark(variant, benchmarkCases, baseUrl));
  }

  const baseline = summaries.find((entry) => entry.name === "baseline");
  const enhanced = summaries.find((entry) => entry.name === "enhanced");
  const delta =
    baseline && enhanced
      ? {
          accuracy: round4(enhanced.accuracy - baseline.accuracy),
          matchedFields: enhanced.matchedFields - baseline.matchedFields,
          comparedFields: enhanced.comparedFields
        }
      : null;

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        kind: "ingestion-quality-benchmark",
        timestamp: new Date().toISOString(),
        sampleCount: benchmarkCases.length,
        baseUrl,
        summaries,
        delta
      },
      null,
      2
    )
  );
}

async function loadInvoice2DataCases(): Promise<BenchmarkCase[]> {
  const files = await fs.readdir(BENCHMARK_GROUND_TRUTH);
  const cases: BenchmarkCase[] = [];

  for (const truthFile of files) {
    if (!truthFile.endsWith(".json")) {
      continue;
    }

    const truthPath = path.join(BENCHMARK_GROUND_TRUTH, truthFile);
    const rawTruth = await fs.readFile(truthPath, "utf8");
    const parsedTruth = JSON.parse(rawTruth);
    const first = Array.isArray(parsedTruth) && parsedTruth.length > 0 ? parsedTruth[0] : {};
    if (!isRecord(first)) {
      continue;
    }

    const baseName = truthFile.replace(/\.json$/i, "");
    const candidateFiles = await findBenchmarkInputVariants(baseName);
    for (const candidate of candidateFiles) {
      cases.push({
        filePath: candidate.filePath,
        fileName: candidate.fileName,
        mimeType: candidate.mimeType,
        truth: first
      });
    }
  }

  return cases.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

async function findBenchmarkInputVariants(
  baseName: string
): Promise<Array<{ filePath: string; fileName: string; mimeType: string }>> {
  const results: Array<{ filePath: string; fileName: string; mimeType: string }> = [];
  const variants = await fs.readdir(BENCHMARK_INBOX);
  for (const fileName of variants) {
    if (!fileName.startsWith(baseName)) {
      continue;
    }
    const mimeType = inferMimeType(fileName);
    if (!mimeType) {
      continue;
    }
    results.push({
      filePath: path.join(BENCHMARK_INBOX, fileName),
      fileName,
      mimeType
    });
  }
  return results;
}

function inferMimeType(fileName: string): string | undefined {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") {
    return "application/pdf";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  return undefined;
}

async function runVariantBenchmark(
  variant: VariantConfig,
  benchmarkCases: BenchmarkCase[],
  baseUrl: string
): Promise<VariantSummary> {
  const scores: FieldScores = {
    invoiceNumber: { matched: 0, total: 0 },
    currency: { matched: 0, total: 0 },
    totalAmountMinor: { matched: 0, total: 0 },
    invoiceDate: { matched: 0, total: 0 }
  };
  const files: VariantSummary["files"] = [];

  for (const benchmarkCase of benchmarkCases) {
    const fileBuffer = await fs.readFile(benchmarkCase.filePath);
    const ocrProvider = new DeepSeekOcrProvider({
      baseUrl,
      prompt: LEGACY_PROMPT,
      enforceKeyValuePairs: variant.enforceKeyValuePairs
    });
    const pipeline = new InvoiceExtractionPipeline(
      ocrProvider,
      new NoopFieldVerifier(),
      new InMemoryVendorTemplateStore(),
      {
        enableOcrKeyValueGrounding: variant.enableOcrKeyValueGrounding
      }
    );

    const extraction = await pipeline.extract({
      tenantId: `benchmark-${variant.name}`,
      sourceKey: "benchmark-inbox",
      attachmentName: benchmarkCase.fileName,
      fileBuffer,
      mimeType: benchmarkCase.mimeType,
      expectedMaxTotal: 1_000_000,
      expectedMaxDueDays: 365,
      autoSelectMin: 91
    });

    const evaluation = scoreParsedInvoice(extraction.parseResult.parsed, benchmarkCase.truth);
    scores.invoiceNumber.matched += evaluation.invoiceNumber.matched;
    scores.invoiceNumber.total += evaluation.invoiceNumber.total;
    scores.currency.matched += evaluation.currency.matched;
    scores.currency.total += evaluation.currency.total;
    scores.totalAmountMinor.matched += evaluation.totalAmountMinor.matched;
    scores.totalAmountMinor.total += evaluation.totalAmountMinor.total;
    scores.invoiceDate.matched += evaluation.invoiceDate.matched;
    scores.invoiceDate.total += evaluation.invoiceDate.total;
    files.push({
      file: benchmarkCase.fileName,
      matched: evaluation.totalMatched,
      total: evaluation.totalCompared,
      accuracy: evaluation.totalCompared > 0 ? round4(evaluation.totalMatched / evaluation.totalCompared) : 0,
      parsed: extraction.parseResult.parsed
    });
  }

  const matchedFields =
    scores.invoiceNumber.matched + scores.currency.matched + scores.totalAmountMinor.matched + scores.invoiceDate.matched;
  const comparedFields =
    scores.invoiceNumber.total + scores.currency.total + scores.totalAmountMinor.total + scores.invoiceDate.total;
  const perfectInvoices = files.filter((entry) => entry.total > 0 && entry.matched === entry.total).length;

  return {
    name: variant.name,
    comparedFields,
    matchedFields,
    accuracy: comparedFields > 0 ? round4(matchedFields / comparedFields) : 0,
    perfectInvoices,
    totalInvoices: files.length,
    fieldScores: scores,
    files
  };
}

function scoreParsedInvoice(
  parsed: ParsedInvoiceData,
  truth: Invoice2DataGroundTruth
): {
  invoiceNumber: { matched: number; total: number };
  currency: { matched: number; total: number };
  totalAmountMinor: { matched: number; total: number };
  invoiceDate: { matched: number; total: number };
  totalMatched: number;
  totalCompared: number;
} {
  const truthInvoiceNumber = normalizeInvoiceNumber(asString(truth.invoice_number));
  const parsedInvoiceNumber = normalizeInvoiceNumber(parsed.invoiceNumber);

  const truthCurrency = normalizeCurrency(asString(truth.currency));
  const parsedCurrency = normalizeCurrency(parsed.currency);

  const truthAmountMinor = normalizeAmountMinor(truth.amount);
  const parsedAmountMinor = typeof parsed.totalAmountMinor === "number" ? Math.round(parsed.totalAmountMinor) : undefined;

  const truthDate = normalizeIsoDate(asString(truth.date));
  const parsedDate = normalizeIsoDate(parsed.invoiceDate);

  const invoiceNumber = {
    matched: truthInvoiceNumber && parsedInvoiceNumber === truthInvoiceNumber ? 1 : 0,
    total: truthInvoiceNumber ? 1 : 0
  };
  const currency = {
    matched: truthCurrency && parsedCurrency === truthCurrency ? 1 : 0,
    total: truthCurrency ? 1 : 0
  };
  const totalAmountMinor = {
    matched: truthAmountMinor !== undefined && parsedAmountMinor === truthAmountMinor ? 1 : 0,
    total: truthAmountMinor !== undefined ? 1 : 0
  };
  const invoiceDate = {
    matched: truthDate && parsedDate === truthDate ? 1 : 0,
    total: truthDate ? 1 : 0
  };

  const totalMatched = invoiceNumber.matched + currency.matched + totalAmountMinor.matched + invoiceDate.matched;
  const totalCompared = invoiceNumber.total + currency.total + totalAmountMinor.total + invoiceDate.total;

  return {
    invoiceNumber,
    currency,
    totalAmountMinor,
    invoiceDate,
    totalMatched,
    totalCompared
  };
}

function normalizeInvoiceNumber(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeCurrency(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAmountMinor(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100);
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.round(parsed * 100);
    }
  }
  return undefined;
}

function normalizeIsoDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
