import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { DeepSeekOcrProvider } from "../ocr/DeepSeekOcrProvider.js";
import { HttpFieldVerifier } from "../verifier/HttpFieldVerifier.js";
import { InvoiceExtractionPipeline } from "../services/extraction/InvoiceExtractionPipeline.js";
import { InMemoryVendorTemplateStore } from "../services/extraction/vendorTemplateStore.js";
import { InMemoryExtractionLearningStore } from "../services/extraction/extractionLearningStore.js";
import type {
  BoundingBox,
  InvoiceFieldProvenance,
  InvoiceLineItemProvenance,
  ParsedInvoiceData
} from "../types/invoice.js";
import type { OcrBlock } from "../core/interfaces/OcrProvider.js";

type ExpectedFieldProvenance = {
  page?: number;
  blockIndex?: number;
  bboxNormalized?: BoundingBox;
};

type ExpectedLineItemProvenance = {
  index: number;
  row?: ExpectedFieldProvenance;
  fields?: Record<string, ExpectedFieldProvenance>;
};

type BenchmarkExpected = {
  file: string;
  invoiceNumber?: string;
  vendorNameContains?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  totalAmountMinor?: number;
  gst?: {
    subtotalMinor?: number;
    cgstMinor?: number;
    sgstMinor?: number;
    igstMinor?: number;
    totalTaxMinor?: number;
  };
  lineItemAmountsMinor?: number[];
  fieldProvenance?: Record<string, ExpectedFieldProvenance>;
  lineItemProvenance?: ExpectedLineItemProvenance[];
};

type BenchmarkSpec = {
  files: BenchmarkExpected[];
};

type BenchmarkResult = {
  file: string;
  error?: string;
  parsed: ParsedInvoiceData;
  issues: string[];
  source: string;
  strategy: string;
  invoiceType?: string;
  classification?: {
    invoiceType?: string;
    category?: string;
    tdsSection?: string;
  };
  fieldProvenance?: Record<string, InvoiceFieldProvenance>;
  lineItemProvenance?: InvoiceLineItemProvenance[];
  ocrBlocks?: OcrBlock[];
};

type Mismatch = {
  file: string;
  field: string;
  expected: unknown;
  actual: unknown;
};

const argv = process.argv.slice(2);

function argValue(name: string, fallback: string): string {
  const index = argv.indexOf(name);
  if (index === -1 || index === argv.length - 1) {
    return fallback;
  }
  return argv[index + 1];
}

function hasArg(name: string): boolean {
  return argv.includes(name);
}

function argValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && index + 1 < argv.length) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function normalizeDate(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeLineItemAmounts(parsed: ParsedInvoiceData): number[] {
  const values = (parsed.lineItems ?? [])
    .map((item) => item.amountMinor)
    .filter((value): value is number => Number.isInteger(value))
    .sort((a, b) => a - b);
  return values;
}

function normalizeBoundingBox(value: unknown): BoundingBox | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const numbers = value.map((entry) => Number(entry));
  return numbers.every((entry) => Number.isFinite(entry)) ? (numbers as BoundingBox) : undefined;
}

function normalizeExpectedFieldProvenance(value: unknown): ExpectedFieldProvenance | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const result: ExpectedFieldProvenance = {};
  if (Number.isInteger(source.page) && Number(source.page) > 0) {
    result.page = Number(source.page);
  }
  if (Number.isInteger(source.blockIndex) && Number(source.blockIndex) >= 0) {
    result.blockIndex = Number(source.blockIndex);
  }
  const bboxNormalized = normalizeBoundingBox(source.bboxNormalized);
  if (bboxNormalized) {
    result.bboxNormalized = bboxNormalized;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeExpectedLineItemProvenance(value: unknown): ExpectedLineItemProvenance | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  if (!Number.isInteger(source.index) || Number(source.index) < 0) {
    return undefined;
  }
  const result: ExpectedLineItemProvenance = { index: Number(source.index) };
  const row = normalizeExpectedFieldProvenance(source.row);
  if (row) {
    result.row = row;
  }
  if (source.fields && typeof source.fields === "object") {
    const fields = Object.fromEntries(
      Object.entries(source.fields as Record<string, unknown>)
        .map(([key, candidate]) => [key, normalizeExpectedFieldProvenance(candidate)])
        .filter(([, candidate]) => candidate)
    ) as Record<string, ExpectedFieldProvenance>;
    if (Object.keys(fields).length > 0) {
      result.fields = fields;
    }
  }
  return result;
}

function compareBoundingBoxes(expected: BoundingBox, actual: BoundingBox | undefined, tolerance = 0.02): boolean {
  if (!actual) {
    return false;
  }
  return expected.every((entry, index) => Math.abs(entry - actual[index]) <= tolerance);
}

function compareFieldProvenance(
  mismatches: Mismatch[],
  file: string,
  fieldPath: string,
  expected: ExpectedFieldProvenance,
  actual: InvoiceFieldProvenance | undefined
): void {
  if (!actual) {
    mismatches.push({
      file,
      field: fieldPath,
      expected,
      actual: undefined
    });
    return;
  }

  if (expected.page !== undefined && expected.page !== actual.page) {
    mismatches.push({
      file,
      field: `${fieldPath}.page`,
      expected: expected.page,
      actual: actual.page
    });
  }

  if (expected.blockIndex !== undefined && expected.blockIndex !== actual.blockIndex) {
    mismatches.push({
      file,
      field: `${fieldPath}.blockIndex`,
      expected: expected.blockIndex,
      actual: actual.blockIndex
    });
  }

  if (expected.bboxNormalized && !compareBoundingBoxes(expected.bboxNormalized, actual.bboxNormalized)) {
    mismatches.push({
      file,
      field: `${fieldPath}.bboxNormalized`,
      expected: expected.bboxNormalized,
      actual: actual.bboxNormalized
    });
  }
}

async function run(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const backendRoot = resolve(scriptDir, "../..");
  const projectRoot = resolve(backendRoot, "..");
  const samplesDir = argValue("--samples-dir", join(projectRoot, "sample-invoices/inbox"));
  const specPath = argValue("--spec", join(projectRoot, "sample-invoices/ground-truth.json"));
  const outputPath = argValue("--output", join(projectRoot, ".local-run/benchmark/latest-results.json"));

  const ocrBaseUrl = process.env.BENCHMARK_OCR_BASE_URL ?? "http://127.0.0.1:8200/v1";
  const slmBaseUrl = process.env.BENCHMARK_SLM_BASE_URL ?? "http://127.0.0.1:8300/v1";

  const ocrProvider = new DeepSeekOcrProvider({
    baseUrl: ocrBaseUrl,
    timeoutMs: 240_000
  });
  const fieldVerifier = new HttpFieldVerifier({
    baseUrl: slmBaseUrl,
    timeoutMs: 240_000
  });
  const pipeline = new InvoiceExtractionPipeline(
    ocrProvider,
    fieldVerifier,
    new InMemoryVendorTemplateStore(),
    new InMemoryExtractionLearningStore(),
    {
      ocrHighConfidenceThreshold: 0.88,
      llmAssistConfidenceThreshold: 85
    }
  );

  const fileFilters = new Set(argValues("--file"));
  const files = readdirSync(samplesDir)
    .filter((name) => [".pdf", ".png", ".jpg", ".jpeg", ".webp"].includes(extname(name).toLowerCase()))
    .filter((name) => fileFilters.size === 0 || fileFilters.has(name))
    .sort((left, right) => left.localeCompare(right));

  const mimeTypeMap: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp"
  };

  const results: BenchmarkResult[] = [];
  for (const file of files) {
    const fullPath = join(samplesDir, file);
    try {
      const fileBuffer = readFileSync(fullPath);
      const mimeType = mimeTypeMap[extname(file).toLowerCase()] ?? "application/octet-stream";
      const extraction = await pipeline.extract({
        tenantId: "benchmark",
        sourceKey: file,
        attachmentName: file,
        fileBuffer,
        mimeType,
        expectedMaxTotal: 1_000_000_000,
        expectedMaxDueDays: 180,
        autoSelectMin: 0.5,
        referenceDate: new Date("2026-03-31T00:00:00Z")
      });
      const parsed = extraction.parseResult.parsed;
      results.push({
        file,
        parsed,
        issues: extraction.parseResult.warnings,
        source: extraction.source,
        strategy: extraction.strategy,
        invoiceType: extraction.extraction?.invoiceType,
        classification: extraction.extraction?.classification,
        fieldProvenance: extraction.extraction?.fieldProvenance,
        lineItemProvenance: extraction.extraction?.lineItemProvenance,
        ocrBlocks: extraction.ocrBlocks
      });
      const total = parsed.totalAmountMinor ?? null;
      const number = parsed.invoiceNumber ?? null;
      process.stdout.write(`${file} | invoice=${String(number)} | totalMinor=${String(total)}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        file,
        error: message,
        parsed: {},
        issues: [message],
        source: "error",
        strategy: "error"
      });
      process.stdout.write(`${file} | ERROR=${message}\n`);
    }
  }

  writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  process.stdout.write(`Wrote raw results to ${outputPath}\n`);

  if (hasArg("--dump-only")) {
    return;
  }

  const rawSpec = JSON.parse(readFileSync(specPath, "utf-8")) as BenchmarkSpec;
  const spec: BenchmarkSpec = {
    files:
      fileFilters.size === 0
        ? rawSpec.files
        : rawSpec.files.filter((entry) => fileFilters.has(entry.file))
  };
  const mismatches: Mismatch[] = [];
  for (const expected of spec.files) {
    const actual = results.find((entry) => entry.file === expected.file);
    if (!actual) {
      mismatches.push({
        file: expected.file,
        field: "file",
        expected: "present",
        actual: "missing"
      });
      continue;
    }

    const parsed = actual.parsed;
    if (actual.error) {
      mismatches.push({
        file: expected.file,
        field: "pipelineError",
        expected: "none",
        actual: actual.error
      });
      continue;
    }
    const checks: Array<[string, unknown, unknown]> = [
      ["invoiceNumber", expected.invoiceNumber, parsed.invoiceNumber],
      ["invoiceDate", expected.invoiceDate, normalizeDate(parsed.invoiceDate)],
      ["dueDate", expected.dueDate, normalizeDate(parsed.dueDate)],
      ["currency", expected.currency, parsed.currency],
      ["totalAmountMinor", expected.totalAmountMinor, parsed.totalAmountMinor]
    ];
    for (const [field, exp, act] of checks) {
      if (exp === undefined) {
        continue;
      }
      if (exp !== act) {
        mismatches.push({ file: expected.file, field, expected: exp, actual: act });
      }
    }

    if (expected.vendorNameContains) {
      const actualVendor = (parsed.vendorName ?? "").toLowerCase();
      if (!actualVendor.includes(expected.vendorNameContains.toLowerCase())) {
        mismatches.push({
          file: expected.file,
          field: "vendorNameContains",
          expected: expected.vendorNameContains,
          actual: parsed.vendorName ?? null
        });
      }
    }

    if (expected.gst) {
      const gstChecks: Array<[string, unknown, unknown]> = [
        ["gst.subtotalMinor", expected.gst.subtotalMinor, parsed.gst?.subtotalMinor],
        ["gst.cgstMinor", expected.gst.cgstMinor, parsed.gst?.cgstMinor],
        ["gst.sgstMinor", expected.gst.sgstMinor, parsed.gst?.sgstMinor],
        ["gst.igstMinor", expected.gst.igstMinor, parsed.gst?.igstMinor],
        ["gst.totalTaxMinor", expected.gst.totalTaxMinor, parsed.gst?.totalTaxMinor]
      ];
      for (const [field, exp, act] of gstChecks) {
        if (exp === undefined) {
          continue;
        }
        if (exp !== act) {
          mismatches.push({ file: expected.file, field, expected: exp, actual: act });
        }
      }
    }

    if (expected.lineItemAmountsMinor) {
      const expectedLineItems = [...expected.lineItemAmountsMinor].sort((a, b) => a - b);
      const actualLineItems = normalizeLineItemAmounts(parsed);
      if (JSON.stringify(expectedLineItems) !== JSON.stringify(actualLineItems)) {
        mismatches.push({
          file: expected.file,
          field: "lineItemAmountsMinor",
          expected: expectedLineItems,
          actual: actualLineItems
        });
      }
    }

    if (expected.fieldProvenance && typeof expected.fieldProvenance === "object") {
      for (const [field, rawExpected] of Object.entries(expected.fieldProvenance)) {
        const normalizedExpected = normalizeExpectedFieldProvenance(rawExpected);
        if (!normalizedExpected) {
          continue;
        }
        compareFieldProvenance(mismatches, expected.file, `fieldProvenance.${field}`, normalizedExpected, actual.fieldProvenance?.[field]);
      }
    }

    if (Array.isArray(expected.lineItemProvenance)) {
      for (const rawExpected of expected.lineItemProvenance) {
        const normalizedExpected = normalizeExpectedLineItemProvenance(rawExpected);
        if (!normalizedExpected) {
          continue;
        }
        const actualLineItem = actual.lineItemProvenance?.find((entry) => entry.index === normalizedExpected.index);
        if (normalizedExpected.row) {
          compareFieldProvenance(
            mismatches,
            expected.file,
            `lineItemProvenance[${normalizedExpected.index}].row`,
            normalizedExpected.row,
            actualLineItem?.row
          );
        }
        if (normalizedExpected.fields) {
          for (const [field, expectedField] of Object.entries(normalizedExpected.fields)) {
            compareFieldProvenance(
              mismatches,
              expected.file,
              `lineItemProvenance[${normalizedExpected.index}].fields.${field}`,
              expectedField,
              actualLineItem?.fields?.[field]
            );
          }
        }
      }
    }
  }

  if (mismatches.length === 0) {
    process.stdout.write("Benchmark PASS: all expected fields matched.\n");
    return;
  }

  process.stdout.write(`Benchmark FAIL: ${mismatches.length} mismatches\n`);
  for (const mismatch of mismatches) {
    process.stdout.write(
      `${mismatch.file} | ${mismatch.field} | expected=${JSON.stringify(mismatch.expected)} | actual=${JSON.stringify(mismatch.actual)}\n`
    );
  }
  process.exitCode = 1;
}

run().catch((error) => {
  process.stderr.write(`Benchmark crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
