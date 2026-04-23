/**
 * Bake pre-extracted fixtures for the 6 demo-tenant invoices.
 *
 * Runs `InvoiceExtractionPipeline.extract()` (LlamaParse + llama-extract) against
 * each PDF in `dev/sample-invoices/inbox/<name>.pdf`, then writes a structured
 * fixture directory to `dev/sample-invoices/baked/<name-without-ext>/` containing:
 *
 *   - `extraction.json` — the parsed result, OCR blocks, field provenance, line
 *     item provenance, extraction metadata, confidence score/tone, and a map of
 *     per-page preview PNGs (e.g. `{ "1": "preview-page-1.png" }`).
 *   - `preview-page-<N>.png` — the LlamaParse screenshot for each page.
 *
 * Tenant-specific overlay fields (tenantId, status, workflowState, approval,
 * compliance.riskSignals, export, receivedAt) are intentionally stripped — the
 * demo invoice seed applies a scenario overlay on top of the fixture.
 *
 * A quality gate runs after every PDF BEFORE any fixture bytes land on disk. If
 * any one PDF fails any check, the script exits non-zero with a per-PDF failure
 * table and leaves the repo untouched. This catches llama-extract prompt drift
 * loudly (e.g. the `'s Organization` customerName bug surfaced on a live upload).
 *
 * Usage:
 *   LLAMA_PARSE_EXTRACT_ENABLED=true \
 *   LLAMA_CLOUD_API_KEY=... \
 *   ENV=local \
 *   MONGO_URI=mongodb://... \
 *   yarn bake:demo-fixtures
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { InvoiceExtractionPipeline } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";
import { InMemoryExtractionLearningStore } from "@/ai/extractors/invoice/learning/extractionLearningStore.js";
import { InMemoryVendorTemplateStore } from "@/ai/extractors/invoice/learning/vendorTemplateStore.js";
import { LlamaParseOcrProvider } from "@/ai/ocr/LlamaParseOcrProvider.js";
import { NoopFieldVerifier } from "@/ai/verifiers/NoopFieldVerifier.js";
import type { LlamaParseTier } from "@/core/runtimeManifest.js";
import { DOCUMENT_MIME_TYPE } from "@/types/mime.js";
import { toUUID } from "@/types/uuid.js";

/* ----------------------------------------------------------- target PDFs */

/** Ordered list of PDFs to bake. */
const TARGET_PDFS = [
  "INV-FY2526-939.pdf",
  "FC-Airtel.pdf",
  "FC-Vector_.pdf",
  "FC-Focus_Bills.pdf",
  "DV-Robu IN.pdf",
  "FC-G4S Facility_.pdf"
] as const;

/* ----------------------------------------------------------- types */

interface QualityFailure {
  file: string;
  field: string;
  actual: unknown;
  reason: string;
}

interface BakedFixture {
  sourceFilename: string;
  mimeType: "application/pdf";
  parsed: Record<string, unknown>;
  ocrBlocks: unknown[];
  fieldProvenance: Record<string, unknown>;
  lineItemProvenance: unknown[];
  extraction: Record<string, unknown>;
  confidenceScore: number;
  confidenceTone: string;
  previewPageImages: Record<string, string>;
}

interface StagedFixture {
  file: string;
  dirName: string;
  fixture: BakedFixture;
  /** Decoded preview PNG bytes, keyed by page number as a string. */
  previewBytes: Record<string, Buffer>;
  /**
   * True when LlamaParse returned only whole-document OCR blocks (no
   * token-level layer). Passing demo PDFs emit 67–366 blocks; native-text
   * PDFs (e.g. FC-Vector_.pdf) emit 2. A heuristic threshold of 5 blocks
   * distinguishes the two populations with a wide margin. When true, the
   * bbox-required gate is exempted because per-field bbox emission is
   * fundamentally impossible for the PDF, not an extraction quality issue.
   */
  isNativeTextPdf: boolean;
}

/* ----------------------------------------------------------- quality gate */

function isNonEmptyString(value: unknown, minLength = 1): value is string {
  return typeof value === "string" && value.trim().length >= minLength;
}

function isValidIsoDate(value: unknown): boolean {
  if (value instanceof Date) {
    return !isNaN(value.getTime());
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  return !isNaN(new Date(value).getTime());
}

function validateFixture(staged: StagedFixture): QualityFailure[] {
  const failures: QualityFailure[] = [];
  const parsed = staged.fixture.parsed;
  const fp = staged.fixture.fieldProvenance;

  const check = (field: string, actual: unknown, reason: string, ok: boolean): void => {
    if (!ok) {
      failures.push({ file: staged.file, field, actual, reason });
    }
  };

  check(
    "parsed.invoiceNumber",
    parsed.invoiceNumber,
    "non-empty string, length >= 3",
    isNonEmptyString(parsed.invoiceNumber, 3)
  );
  check(
    "parsed.vendorName",
    parsed.vendorName,
    "non-empty string, length >= 3",
    isNonEmptyString(parsed.vendorName, 3)
  );
  check("parsed.invoiceDate", parsed.invoiceDate, "valid ISO date", isValidIsoDate(parsed.invoiceDate));
  check(
    "parsed.totalAmountMinor",
    parsed.totalAmountMinor,
    "integer > 0",
    Number.isInteger(parsed.totalAmountMinor) && (parsed.totalAmountMinor as number) > 0
  );
  check("parsed.currency", parsed.currency, "non-empty string", isNonEmptyString(parsed.currency));

  const customerName = parsed.customerName;
  check(
    "parsed.customerName",
    customerName,
    'non-empty string, length >= 3, must NOT start with "\'s "',
    isNonEmptyString(customerName, 3) && !(customerName as string).trim().startsWith("'s ")
  );
  check(
    "parsed.customerAddress",
    parsed.customerAddress,
    "non-empty string, length >= 10",
    isNonEmptyString(parsed.customerAddress, 10)
  );

  // `currency` is a document-level inference — llama-extract consistently does
  // not emit a per-field bbox for it because the glyph ("INR", "₹", "$") tends
  // to appear in many places per document with no single canonical source
  // token.
  //
  // `totalAmountMinor` is an aggregated computed value on itemized invoices
  // (line items summed + GST added + discount applied). It typically doesn't
  // anchor to a single source token the way `invoiceNumber` or `vendorName`
  // do — per-invoice bbox emission by llama-extract / text-pattern is
  // inconsistent for aggregates.
  //
  // We still require `source` (and therefore presence) for both currency and
  // totalAmountMinor, but allow their bbox/bboxNormalized to be undefined.
  // All other key fields must carry a bbox.
  const bboxRequiredFields = ["invoiceNumber", "vendorName", "invoiceDate"] as const;
  const sourceRequiredFields = [...bboxRequiredFields, "currency", "totalAmountMinor"] as const;

  for (const field of sourceRequiredFields) {
    const entry = fp[field];
    if (!entry || typeof entry !== "object") {
      failures.push({
        file: staged.file,
        field: `fieldProvenance.${field}`,
        actual: entry,
        reason: "present with non-empty source"
      });
      continue;
    }
    const e = entry as { source?: unknown };
    if (!isNonEmptyString(e.source)) {
      failures.push({
        file: staged.file,
        field: `fieldProvenance.${field}.source`,
        actual: e.source,
        reason: "non-empty string"
      });
    }
  }

  // Native-text PDFs — those where LlamaParse emits only document-level OCR blocks
  // (typically < 5 blocks total) — cannot anchor fields to bboxes regardless of which
  // extractor runs (llama-extract or text-pattern fallback), because there's no
  // token-level OCR layer. This is a fundamental property of the PDF, not an extraction
  // quality issue. Real-world invoice corpora include native-text PDFs (especially
  // SaaS/international vendors — Vector, Zoom, etc.), so the demo should handle them
  // rather than exclude them. The gate still fires if a "normal" scanned PDF drops to
  // text-pattern without bboxes — that would be a real extraction regression.
  if (!staged.isNativeTextPdf) {
    for (const field of bboxRequiredFields) {
      const entry = fp[field];
      if (!entry || typeof entry !== "object") continue; // already reported by source loop
      const e = entry as { bbox?: unknown; bboxNormalized?: unknown };
      if (e.bbox === undefined && e.bboxNormalized === undefined) {
        failures.push({
          file: staged.file,
          field: `fieldProvenance.${field}.bbox`,
          actual: undefined,
          reason: "bbox or bboxNormalized must be defined"
        });
      }
    }
  }

  const previewEntries = Object.entries(staged.previewBytes);
  if (previewEntries.length === 0) {
    failures.push({
      file: staged.file,
      field: "previewPageImages",
      actual: 0,
      reason: "at least one preview PNG"
    });
  }
  for (const [page, buffer] of previewEntries) {
    if (buffer.byteLength <= 10 * 1024) {
      failures.push({
        file: staged.file,
        field: `preview-page-${page}.png`,
        actual: `${buffer.byteLength} bytes`,
        reason: "> 10 KB"
      });
    }
  }

  return failures;
}

/* ----------------------------------------------------------- runner */

function truncate(value: unknown, limit = 60): string {
  if (value === undefined || value === null) return "<undefined>";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function decodeDataUrl(value: string): Buffer | undefined {
  const separatorIndex = value.indexOf(",");
  if (separatorIndex < 0) return undefined;
  const header = value.slice(0, separatorIndex).trim();
  const payload = value.slice(separatorIndex + 1);
  if (!/^data:image\/(png|jpeg|jpg|webp);base64$/i.test(header)) {
    return undefined;
  }
  try {
    return Buffer.from(payload, "base64");
  } catch {
    return undefined;
  }
}

async function bake(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const backendRoot = resolve(scriptDir, "../..");
  const projectRoot = resolve(backendRoot, "..");
  const inboxDir = join(projectRoot, "dev/sample-invoices/inbox");
  const bakedDir = join(projectRoot, "dev/sample-invoices/baked");
  // Raw-extraction cache so a gate failure doesn't waste the API call. The
  // file is always written BEFORE the gate runs so the expensive extraction
  // is preserved even if the gate rejects the batch. `.local-run/` is
  // gitignored. A future `--from-cache` replay path is a follow-up.
  const cacheDir = join(backendRoot, ".local-run/bake-cache");
  mkdirSync(cacheDir, { recursive: true });

  const fromCache = process.argv.includes("--from-cache");
  if (fromCache) {
    process.stdout.write(
      "--from-cache: replaying raw extractions from backend/.local-run/bake-cache/ (no LlamaParse API calls)\n"
    );
  }

  // Operator override: record gate failures but still write fixtures. Use when
  // LlamaExtract cannot emit a bbox for a genuinely uncitable field (e.g. a
  // vendor name that only appears inside a logo/letterhead raster block).
  const skipGate = process.argv.includes("--skip-gate");

  // Operator override: re-bake only a subset of files. Pass `--file X.pdf`
  // one or more times. Useful after a transient LlamaParse failure on a single
  // PDF so you don't burn credits re-extracting the rest. Matching files are
  // still run through the full extract → stage → gate → write pipeline; other
  // TARGET_PDFS are skipped entirely (no cache replay, no fixture rewrite).
  const fileFilter = new Set<string>();
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === "--file") {
      fileFilter.add(process.argv[i + 1] as string);
    }
  }
  const filteredTargets = fileFilter.size === 0
    ? TARGET_PDFS
    : TARGET_PDFS.filter((name) => fileFilter.has(name));
  if (fileFilter.size > 0) {
    process.stdout.write(`--file filter: ${filteredTargets.join(", ")}\n`);
  }

  if (process.env.LLAMA_PARSE_EXTRACT_ENABLED !== "true") {
    process.stderr.write(
      "LLAMA_PARSE_EXTRACT_ENABLED must be 'true' to bake fixtures (llama-extract is the extraction strategy we're capturing).\n"
    );
    process.exit(1);
  }
  if (!fromCache && !process.env.LLAMA_CLOUD_API_KEY) {
    process.stderr.write("LLAMA_CLOUD_API_KEY must be set (or pass --from-cache to replay without API calls).\n");
    process.exit(1);
  }

  const tier = (process.env.LLAMA_PARSE_TIER ?? "agentic") as LlamaParseTier;
  // Pipeline is only constructed when running live (not in --from-cache replay).
  const pipeline = fromCache
    ? null
    : new InvoiceExtractionPipeline({
        ocrProvider: new LlamaParseOcrProvider({ tier }),
        fieldVerifier: new NoopFieldVerifier(),
        templateStore: new InMemoryVendorTemplateStore(),
        learningStore: new InMemoryExtractionLearningStore()
      });

  const staged: StagedFixture[] = [];
  const allFailures: QualityFailure[] = [];
  const perFileReport: Array<{
    file: string;
    status: "PASS" | "FAIL";
    statusDetail: string;
    vendorName: string;
    customerName: string;
    invoiceNumber: string;
    totalAmountMinor: number | null;
    ocrBlocks: number;
    failureCount: number;
  }> = [];

  for (const file of filteredTargets) {
    const fullPath = join(inboxDir, file);
    process.stdout.write(`\n=== ${file}\n`);

    const dirName = file.replace(/\.pdf$/i, "").trim();

    let fixture: BakedFixture;
    const previewBytes: Record<string, Buffer> = {};

    if (fromCache) {
      // --from-cache replay: load the previously-captured extraction JSON and
      // sibling preview PNG(s) from backend/.local-run/bake-cache/. No API
      // calls are made. If either is missing, the baker fails loudly so the
      // operator knows to run once without --from-cache first.
      const cachedJsonPath = join(cacheDir, `${dirName}.json`);
      const cachedFixture = JSON.parse(readFileSync(cachedJsonPath, "utf-8")) as BakedFixture;
      fixture = cachedFixture;
      for (const pageKey of Object.keys(cachedFixture.previewPageImages)) {
        const pngPath = join(cacheDir, `${dirName}__preview-page-${pageKey}.png`);
        previewBytes[pageKey] = readFileSync(pngPath);
      }
    } else {
      const fileBuffer = readFileSync(fullPath);

      const extraction = await pipeline!.extract({
        tenantId: toUUID("demo-bake"),
        sourceKey: "demo-bake",
        attachmentName: file,
        fileBuffer,
        mimeType: DOCUMENT_MIME_TYPE.PDF
      });

      const parsedRaw = extraction.parseResult.parsed;
      const parsed: Record<string, unknown> = { ...parsedRaw };
      // Serialize Date -> ISO string so the fixture JSON round-trips cleanly;
      // the seed converts back to Date when building invoice docs.
      for (const key of ["invoiceDate", "dueDate"] as const) {
        const value = parsed[key];
        if (value instanceof Date) {
          parsed[key] = value.toISOString();
        }
      }

      const fieldProvenance = (extraction.extraction?.fieldProvenance ?? {}) as Record<string, unknown>;
      const lineItemProvenance = (extraction.extraction?.lineItemProvenance ?? []) as unknown[];

      // Decode and stage preview bytes per page from the pipeline's data URLs.
      const previewPageImages: Record<string, string> = {};
      for (const image of extraction.ocrPageImages ?? []) {
        const bytes = decodeDataUrl(image.dataUrl);
        if (!bytes) continue;
        const pageKey = String(image.page);
        previewBytes[pageKey] = bytes;
        previewPageImages[pageKey] = `preview-page-${pageKey}.png`;
      }

      const extractionMeta: Record<string, unknown> = {
        source: extraction.source,
        strategy: extraction.strategy,
        provider: extraction.provider,
        invoiceType: extraction.extraction?.invoiceType,
        classification: extraction.extraction?.classification,
        parsingConfidence: extraction.confidence,
        extractionConfidence: extraction.confidenceAssessment?.score,
        fieldConfidence: extraction.extraction?.fieldConfidence
      };
      for (const key of Object.keys(extractionMeta)) {
        if (extractionMeta[key] === undefined) delete extractionMeta[key];
      }

      fixture = {
        sourceFilename: file,
        mimeType: "application/pdf",
        parsed,
        ocrBlocks: extraction.ocrBlocks ?? [],
        fieldProvenance,
        lineItemProvenance,
        extraction: extractionMeta,
        confidenceScore: Number.isFinite(extraction.confidenceAssessment?.score)
          ? extraction.confidenceAssessment.score
          : 0,
        confidenceTone: extraction.confidenceAssessment?.tone ?? "red",
        previewPageImages
      };

      // Cache the raw extraction (parsed + provenance + meta + preview bytes)
      // before the gate runs. If the gate fails we still preserve the
      // API-call output for debugging and for future --from-cache replays.
      try {
        const cachePath = join(cacheDir, `${dirName}.json`);
        writeFileSync(cachePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf-8");
        for (const [pageKey, buffer] of Object.entries(previewBytes)) {
          writeFileSync(join(cacheDir, `${dirName}__preview-page-${pageKey}.png`), buffer);
        }
      } catch (error) {
        process.stderr.write(
          `warning: failed to cache raw extraction for ${file}: ${error instanceof Error ? error.message : String(error)}\n`
        );
      }
    }

    const parsed = fixture.parsed;
    const isNativeTextPdf = (fixture.ocrBlocks?.length ?? 0) < 5;
    if (isNativeTextPdf) {
      process.stdout.write(
        `note(${file}): native-text PDF detected (${fixture.ocrBlocks.length} blocks); bbox requirement exempted — fields will render without highlight rectangles in source viewer, which is the correct behavior for native-text documents\n`
      );
    }

    const stagedEntry: StagedFixture = { file, dirName, fixture, previewBytes, isNativeTextPdf };

    const failures = validateFixture(stagedEntry);
    allFailures.push(...failures);
    staged.push(stagedEntry);

    const statusDetail = failures.length === 0 ? (isNativeTextPdf ? "PASS (native-text exempt)" : "PASS") : "FAIL";
    perFileReport.push({
      file,
      status: failures.length === 0 ? "PASS" : "FAIL",
      statusDetail,
      vendorName: truncate(parsed.vendorName, 40),
      customerName: truncate(parsed.customerName, 40),
      invoiceNumber: truncate(parsed.invoiceNumber, 24),
      totalAmountMinor: Number.isInteger(parsed.totalAmountMinor)
        ? (parsed.totalAmountMinor as number)
        : null,
      ocrBlocks: fixture.ocrBlocks?.length ?? 0,
      failureCount: failures.length
    });

    process.stdout.write(
      `${file} | invoice=${String(parsed.invoiceNumber)} | vendor=${truncate(parsed.vendorName, 30)} | customer=${truncate(parsed.customerName, 30)} | blocks=${fixture.ocrBlocks?.length ?? 0} | failures=${failures.length}\n`
    );
  }

  process.stdout.write("\n=== Per-PDF quality report\n");
  for (const row of perFileReport) {
    process.stdout.write(
      `${row.statusDetail} | ${row.file} | invoice=${row.invoiceNumber} | vendor=${row.vendorName} | customer=${row.customerName} | totalMinor=${String(row.totalAmountMinor)} | blocks=${row.ocrBlocks} | failures=${row.failureCount}\n`
    );
  }

  if (allFailures.length > 0) {
    const header = skipGate
      ? "\n=== QUALITY GATE FAILURES (--skip-gate set; writing fixtures anyway)\n"
      : "\n=== QUALITY GATE FAILED — no fixtures written\n";
    const stream = skipGate ? process.stdout : process.stderr;
    stream.write(header);
    stream.write("STATUS | FILE | FIELD | ACTUAL | REQUIREMENT\n");
    for (const failure of allFailures) {
      stream.write(
        `FAIL | ${failure.file} | ${failure.field} | ${truncate(failure.actual, 40)} | ${failure.reason}\n`
      );
    }
    if (!skipGate) {
      process.exit(1);
    }
  }

  // All passed (or --skip-gate set) — write fixtures.
  process.stdout.write(
    allFailures.length === 0
      ? "\n=== Quality gate PASSED for all 6 PDFs — writing fixtures\n"
      : "\n=== Writing fixtures despite gate failures (--skip-gate set)\n"
  );
  for (const entry of staged) {
    const outDir = join(bakedDir, entry.dirName);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "extraction.json"), `${JSON.stringify(entry.fixture, null, 2)}\n`, "utf-8");
    for (const [page, buffer] of Object.entries(entry.previewBytes)) {
      writeFileSync(join(outDir, `preview-page-${page}.png`), buffer as Buffer);
    }
    process.stdout.write(`wrote ${outDir} (${Object.keys(entry.previewBytes).length} preview page(s))\n`);
  }

  process.stdout.write("\nDone.\n");
}

bake().catch((error) => {
  process.stderr.write(
    `bakeDemoFixtures crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exit(1);
});
