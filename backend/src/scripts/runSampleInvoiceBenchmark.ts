import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { DOCUMENT_MIME_TYPE, type DocumentMimeType } from "@/types/mime.js";
import { toUUID } from "@/types/uuid.js";
import { DeepSeekOcrProvider } from "@/ai/ocr/DeepSeekOcrProvider.js";
import { LlamaParseOcrProvider } from "@/ai/ocr/LlamaParseOcrProvider.js";
import { HttpFieldVerifier } from "@/ai/verifiers/HttpFieldVerifier.js";
import { NoopFieldVerifier } from "@/ai/verifiers/NoopFieldVerifier.js";
import type { FieldVerifier } from "@/core/interfaces/FieldVerifier.js";
import { InvoiceExtractionPipeline } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";
import { InMemoryVendorTemplateStore } from "@/ai/extractors/invoice/learning/vendorTemplateStore.js";
import { InMemoryExtractionLearningStore } from "@/ai/extractors/invoice/learning/extractionLearningStore.js";
import type {
  InvoiceFieldProvenance,
  InvoiceLineItemProvenance,
  ParsedInvoiceData
} from "@/types/invoice.js";
import type { OcrBlock, OcrProvider } from "@/core/interfaces/OcrProvider.js";
import type { LlamaParseTier } from "@/core/runtimeManifest.js";

type ExpectedFieldProvenance = {
  page?: number;
  blockIndex?: number;
};

// Documents with fewer than this many OCR blocks are treated as native-text
// (no raster/vision coordinates). For those, bbox presence is not asserted
// because LlamaParse does not emit coordinates on native-text paths. Mirrors
// the heuristic used by the demo-fixture baker gate.
const NATIVE_TEXT_OCR_BLOCK_THRESHOLD = 5;

type ExpectedLineItemProvenance = {
  index: number;
  row?: ExpectedFieldProvenance;
  fields?: Record<string, ExpectedFieldProvenance>;
};

type BenchmarkExpected = {
  file: string;
  invoiceNumber?: string;
  vendorNameContains?: string;
  vendorAddressContains?: string;
  vendorGstin?: string;
  vendorPan?: string;
  customerNameContains?: string;
  customerAddressContains?: string;
  customerGstin?: string | null;
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
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return undefined;
    return value.toISOString().slice(0, 10);
  }
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
  // Presence-only: if the ground-truth mentions a field here at all, we still
  // want to check the corresponding actual provenance exists (even when neither
  // `page` nor `blockIndex` is asserted). Returning an empty object lets the
  // caller express "expected to be present".
  return result;
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

function compareFieldProvenance(
  mismatches: Mismatch[],
  file: string,
  fieldPath: string,
  expected: ExpectedFieldProvenance,
  actual: InvoiceFieldProvenance | undefined,
  options: { checkBboxPresence: boolean } = { checkBboxPresence: true }
): void {
  if (!actual) {
    mismatches.push({
      file,
      field: fieldPath,
      expected: "present",
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

  // Presence-only bbox assertion: the ground-truth declaring a field under
  // `fieldProvenance` means we expect the extractor to emit *some* coordinate
  // data. We intentionally do NOT compare coordinate values here — LlamaParse
  // shows run-to-run variance that exceeded our previous tolerance. Rendering
  // correctness is now covered by baked demo fixtures and visual QA.
  if (options.checkBboxPresence && !actual.bbox && !actual.bboxNormalized) {
    mismatches.push({
      file,
      field: `${fieldPath}.bboxPresent`,
      expected: "bbox or bboxNormalized populated",
      actual: null
    });
  }
}

function buildSpecFromResults(results: BenchmarkResult[]): BenchmarkSpec {
  const files: BenchmarkExpected[] = [];
  for (const result of results) {
    if (result.error) {
      continue;
    }
    const parsed = result.parsed;
    const entry: BenchmarkExpected = { file: result.file };

    if (parsed.invoiceNumber) {
      entry.invoiceNumber = parsed.invoiceNumber;
    }
    if (parsed.vendorName) {
      entry.vendorNameContains = parsed.vendorName;
    }
    const invoiceDate = normalizeDate(parsed.invoiceDate);
    if (invoiceDate) {
      entry.invoiceDate = invoiceDate;
    }
    const dueDate = normalizeDate(parsed.dueDate);
    if (dueDate) {
      entry.dueDate = dueDate;
    }
    if (parsed.currency) {
      entry.currency = parsed.currency;
    }
    if (Number.isInteger(parsed.totalAmountMinor)) {
      entry.totalAmountMinor = parsed.totalAmountMinor as number;
    }

    if (parsed.gst && typeof parsed.gst === "object") {
      const gst: NonNullable<BenchmarkExpected["gst"]> = {};
      if (Number.isInteger(parsed.gst.subtotalMinor)) { gst.subtotalMinor = parsed.gst.subtotalMinor; }
      if (Number.isInteger(parsed.gst.cgstMinor)) { gst.cgstMinor = parsed.gst.cgstMinor; }
      if (Number.isInteger(parsed.gst.sgstMinor)) { gst.sgstMinor = parsed.gst.sgstMinor; }
      if (Number.isInteger(parsed.gst.igstMinor)) { gst.igstMinor = parsed.gst.igstMinor; }
      if (Number.isInteger(parsed.gst.totalTaxMinor)) { gst.totalTaxMinor = parsed.gst.totalTaxMinor; }
      if (Object.keys(gst).length > 0) {
        entry.gst = gst;
      }
    }

    const lineItems = normalizeLineItemAmounts(parsed);
    if (lineItems.length > 0) {
      entry.lineItemAmountsMinor = lineItems;
    }

    if (result.fieldProvenance) {
      const fp: NonNullable<BenchmarkExpected["fieldProvenance"]> = {};
      for (const field of ["invoiceNumber", "vendorName", "invoiceDate", "dueDate", "totalAmountMinor"]) {
        const prov = result.fieldProvenance[field];
        if (!prov) {
          continue;
        }
        const p: ExpectedFieldProvenance = {};
        if (typeof prov.page === "number") { p.page = prov.page; }
        if (typeof prov.blockIndex === "number") { p.blockIndex = prov.blockIndex; }
        // Always record the field so presence (and bbox-presence) can be
        // asserted, even when no page/blockIndex is stored.
        fp[field] = p;
      }
      if (Object.keys(fp).length > 0) {
        entry.fieldProvenance = fp;
      }
    }

    files.push(entry);
  }
  return { files };
}

async function run(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const backendRoot = resolve(scriptDir, "../..");
  const projectRoot = resolve(backendRoot, "..");
  const samplesDir = argValue("--samples-dir", join(projectRoot, "dev/sample-invoices/inbox"));
  const specPath = argValue("--spec", join(projectRoot, "dev/sample-invoices/ground-truth.json"));
  const outputPath = argValue("--output", join(projectRoot, ".local-run/benchmark/latest-results.json"));

  const ocrChoice = argValue("--ocr", "deepseek");
  const ocrBaseUrl = process.env.BENCHMARK_OCR_BASE_URL ?? "http://127.0.0.1:8200/v1";
  const slmBaseUrl = process.env.BENCHMARK_SLM_BASE_URL ?? "http://127.0.0.1:8300/v1";

  let ocrProvider: OcrProvider;
  if (ocrChoice === "llamaparse") {
    ocrProvider = new LlamaParseOcrProvider({ tier: (process.env.LLAMA_PARSE_TIER ?? "agentic") as LlamaParseTier });
  } else {
    ocrProvider = new DeepSeekOcrProvider({ baseUrl: ocrBaseUrl, timeoutMs: 240_000 });
  }
  // LlamaParse emits field-level provenance directly; skip the SLM verifier on
  // that path so the benchmark doesn't require `yarn slm` running on the host.
  // Deepseek/auto still route through HttpFieldVerifier.
  const fieldVerifier: FieldVerifier = ocrChoice === "llamaparse"
    ? new NoopFieldVerifier()
    : new HttpFieldVerifier({
        baseUrl: slmBaseUrl,
        timeoutMs: 240_000
      });
  const pipeline = new InvoiceExtractionPipeline(
    {
      ocrProvider,
      fieldVerifier,
      templateStore: new InMemoryVendorTemplateStore(),
      learningStore: new InMemoryExtractionLearningStore()
    },
  );

  const fileFilters = new Set(argValues("--file"));
  const filePrefixes = argValues("--file-prefix");
  const files = readdirSync(samplesDir)
    .filter((name) => [".pdf", ".png", ".jpg", ".jpeg", ".webp"].includes(extname(name).toLowerCase()))
    .filter((name) => fileFilters.size === 0 || fileFilters.has(name))
    .filter((name) => filePrefixes.length === 0 || filePrefixes.some((p) => name.startsWith(p)))
    .sort((left, right) => left.localeCompare(right));

  const mimeTypeMap: Record<string, DocumentMimeType> = {
    ".pdf": DOCUMENT_MIME_TYPE.PDF,
    ".png": DOCUMENT_MIME_TYPE.PNG,
    ".jpg": DOCUMENT_MIME_TYPE.JPEG,
    ".jpeg": DOCUMENT_MIME_TYPE.JPEG,
    ".webp": DOCUMENT_MIME_TYPE.WEBP
  };

  async function processFile(file: string): Promise<BenchmarkResult> {
    const fullPath = join(samplesDir, file);
    const fileBuffer = readFileSync(fullPath);
    const mimeType = mimeTypeMap[extname(file).toLowerCase()] ?? DOCUMENT_MIME_TYPE.PDF;
    const extraction = await pipeline.extract({
      tenantId: toUUID("benchmark"),
      sourceKey: file,
      attachmentName: file,
      fileBuffer,
      mimeType,
    });
    const parsed = extraction.parseResult.parsed;
    const total = parsed.totalAmountMinor ?? null;
    const number = parsed.invoiceNumber ?? null;
    process.stdout.write(`${file} | invoice=${String(number)} | totalMinor=${String(total)}\n`);
    return {
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
    };
  }

  const CONCURRENCY = process.env.BENCHMARK_CONCURRENCY ? Math.max(1, parseInt(process.env.BENCHMARK_CONCURRENCY, 10)) : 5;
  const results: BenchmarkResult[] = [];
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((file) => processFile(file)));
    for (let j = 0; j < settled.length; j++) {
      const outcome = settled[j];
      const file = batch[j] as string;
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        results.push({ file, error: message, parsed: {}, issues: [message], source: "error", strategy: "error" });
        process.stdout.write(`${file} | ERROR=${message}\n`);
      }
    }
  }

  writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  process.stdout.write(`Wrote raw results to ${outputPath}\n`);

  if (hasArg("--generate-spec")) {
    const specOutputPath = argValue("--output-spec", join(projectRoot, ".local-run/benchmark/generated-spec.json"));
    writeFileSync(specOutputPath, JSON.stringify(buildSpecFromResults(results), null, 2));
    process.stdout.write(`Wrote generated spec to ${specOutputPath}\n`);
  }

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

    const substringChecks: Array<[string, string | undefined, string | undefined]> = [
      ["vendorAddressContains", expected.vendorAddressContains, parsed.vendorAddress],
      ["customerNameContains", expected.customerNameContains, parsed.customerName],
      ["customerAddressContains", expected.customerAddressContains, parsed.customerAddress]
    ];
    for (const [field, exp, act] of substringChecks) {
      if (!exp) continue;
      if (!(act ?? "").toLowerCase().includes(exp.toLowerCase())) {
        mismatches.push({ file: expected.file, field, expected: exp, actual: act ?? null });
      }
    }

    const exactStringChecks: Array<[string, string | null | undefined, string | undefined]> = [
      ["vendorGstin", expected.vendorGstin, parsed.vendorGstin],
      ["vendorPan", expected.vendorPan, parsed.vendorPan],
      ["customerGstin", expected.customerGstin, parsed.customerGstin]
    ];
    for (const [field, exp, act] of exactStringChecks) {
      if (exp === undefined) continue;
      const expectedValue = exp === null ? undefined : exp;
      if (expectedValue !== act) {
        mismatches.push({ file: expected.file, field, expected: exp, actual: act ?? null });
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

    // Native-text documents (e.g. PDFs that came through as plain text, not
    // rasterized) do not carry bbox coordinates. Skip the bbox-presence check
    // for those — mirrors the heuristic used by the demo-fixture baker gate.
    const isNativeTextDoc = (actual.ocrBlocks?.length ?? 0) < NATIVE_TEXT_OCR_BLOCK_THRESHOLD;
    const checkBboxPresence = !isNativeTextDoc;

    if (expected.fieldProvenance && typeof expected.fieldProvenance === "object") {
      for (const [field, rawExpected] of Object.entries(expected.fieldProvenance)) {
        const normalizedExpected = normalizeExpectedFieldProvenance(rawExpected);
        if (!normalizedExpected) {
          continue;
        }
        compareFieldProvenance(
          mismatches,
          expected.file,
          `fieldProvenance.${field}`,
          normalizedExpected,
          actual.fieldProvenance?.[field],
          { checkBboxPresence }
        );
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
            actualLineItem?.row,
            { checkBboxPresence }
          );
        }
        if (normalizedExpected.fields) {
          for (const [field, expectedField] of Object.entries(normalizedExpected.fields)) {
            compareFieldProvenance(
              mismatches,
              expected.file,
              `lineItemProvenance[${normalizedExpected.index}].fields.${field}`,
              expectedField,
              actualLineItem?.fields?.[field],
              { checkBboxPresence }
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
