import type { IngestionSource, IngestedFile } from "../core/interfaces/IngestionSource.js";
import type { FileStore } from "../core/interfaces/FileStore.js";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { OcrBlock, OcrPageImage, OcrProvider } from "../core/interfaces/OcrProvider.js";
import sharp from "sharp";
import { CheckpointModel } from "../models/Checkpoint.js";
import { InvoiceModel } from "../models/Invoice.js";
import { logger } from "../utils/logger.js";
import type { InvoiceStatus } from "../types/invoice.js";
import { env } from "../config/env.js";
import { normalizeInvoiceMimeType } from "../utils/mime.js";
import type { WorkloadTier } from "../types/tenant.js";
import { TenantModel } from "../models/Tenant.js";
import { S3UploadIngestionSource } from "../sources/S3UploadIngestionSource.js";
import { InvoiceExtractionPipeline, ExtractionPipelineError } from "./extraction/InvoiceExtractionPipeline.js";
import { NoopFieldVerifier } from "../verifier/NoopFieldVerifier.js";
import { MongoVendorTemplateStore } from "./extraction/vendorTemplateStore.js";
import { getPreviewStorageRoot, isPathInsideRoot } from "../utils/previewStorage.js";

interface IngestionRunSummary {
  totalFiles: number;
  newInvoices: number;
  duplicates: number;
  failures: number;
}

interface FieldProvenanceEntry {
  source?: string;
  page?: number;
  bbox?: [number, number, number, number];
  bboxNormalized?: [number, number, number, number];
  bboxModel?: [number, number, number, number];
  blockIndex?: number;
}

interface IngestionRunProgress extends IngestionRunSummary {
  processedFiles: number;
  running: boolean;
  lastUpdatedAt: string;
}

interface IngestionServiceOptions {
  afterFileProcessed?: (params: {
    tenantId: string;
    workloadTier: WorkloadTier;
    sourceKey: string;
    checkpointValue: string;
    result: "created" | "duplicate" | "failed";
  }) => Promise<void> | void;
  pipeline?: InvoiceExtractionPipeline;
  fileStore?: FileStore;
}

interface RunOnceRuntimeOptions {
  onProgress?: (progress: IngestionRunProgress) => Promise<void> | void;
  tenantId?: string;
}

export class IngestionService {
  private readonly afterFileProcessed?: IngestionServiceOptions["afterFileProcessed"];
  private readonly pipeline: InvoiceExtractionPipeline;
  private readonly fileStore?: FileStore;
  private pauseRequested = false;

  constructor(
    private readonly sources: IngestionSource[],
    private readonly ocrProvider: OcrProvider,
    options?: IngestionServiceOptions
  ) {
    this.afterFileProcessed = options?.afterFileProcessed;
    this.fileStore = options?.fileStore;
    this.pipeline =
      options?.pipeline ??
      new InvoiceExtractionPipeline(this.ocrProvider, new NoopFieldVerifier(), new MongoVendorTemplateStore(), undefined);
  }

  requestPause(): void {
    this.pauseRequested = true;
  }

  async runOnce(runtimeOptions?: RunOnceRuntimeOptions): Promise<IngestionRunSummary & { paused?: boolean }> {
    this.pauseRequested = false;
    const summary: IngestionRunSummary = {
      totalFiles: 0,
      newInvoices: 0,
      duplicates: 0,
      failures: 0
    };
    let processedFiles = 0;
    let paused = false;
    logger.info("ingestion.run.start", { sourceCount: this.sources.length });

    const emitProgress = async (running = true) => {
      if (!runtimeOptions?.onProgress) {
        return;
      }

      await runtimeOptions.onProgress({
        ...summary,
        processedFiles,
        running,
        lastUpdatedAt: new Date().toISOString()
      });
    };

    await emitProgress(true);

    const runtimeTenantId =
      runtimeOptions?.tenantId && runtimeOptions.tenantId.trim().length > 0 ? runtimeOptions.tenantId.trim() : "";
    const prioritizedSources = [...this.sources].sort(compareSourcePriority);
    const tenantMatchedSources =
      runtimeTenantId.length > 0
        ? prioritizedSources.filter((source) => source.tenantId === runtimeTenantId)
        : prioritizedSources;
    let tenantScopedSources =
      runtimeTenantId.length > 0 && tenantMatchedSources.length > 0 ? tenantMatchedSources : prioritizedSources;

    if (runtimeTenantId.length > 0) {
      const tenantDoc = await TenantModel.findById(runtimeTenantId).select({ mode: 1 }).lean();
      if (tenantDoc?.mode === "live") {
        tenantScopedSources = tenantScopedSources.filter((s) => s.type !== "folder");
      }
    }

    if (runtimeTenantId.length > 0 && this.fileStore?.listObjects) {
      const uploadSource = new S3UploadIngestionSource(runtimeTenantId, this.fileStore);
      tenantScopedSources = [...tenantScopedSources, uploadSource];
    }

    if (runtimeTenantId.length > 0 && tenantMatchedSources.length === 0) {
      logger.warn("ingestion.run.tenant_source_fallback", {
        tenantId: runtimeTenantId,
        sourceCount: prioritizedSources.length
      });
    }

    for (const source of tenantScopedSources) {
      const effectiveTenantId = runtimeTenantId || source.tenantId;
      const checkpoint = await CheckpointModel.findOne({ sourceKey: source.key, tenantId: effectiveTenantId }).lean();
      const sourceFiles = await source.fetchNewFiles(checkpoint?.marker ?? null);
      const files = await this.filterAlreadyProcessedFiles(source, sourceFiles, effectiveTenantId);
      logger.info("ingestion.source.scan", {
        tenantId: effectiveTenantId,
        workloadTier: source.workloadTier,
        sourceType: source.type,
        sourceKey: source.key,
        fetchedFiles: sourceFiles.length,
        queuedFiles: files.length,
        checkpoint: checkpoint?.marker ?? null
      });

      summary.totalFiles += files.length;
      await emitProgress(true);

      let nextMarker = checkpoint?.marker ?? null;
      for (const file of files) {
        const scopedFile = file.tenantId === effectiveTenantId ? file : { ...file, tenantId: effectiveTenantId };
        const processed = await this.processFile(scopedFile);
        logger.info("ingestion.file.result", {
          sourceKey: scopedFile.sourceKey,
          sourceDocumentId: scopedFile.sourceDocumentId,
          attachmentName: scopedFile.attachmentName,
          result: processed
        });
        if (processed === "created") {
          summary.newInvoices += 1;
        }

        if (processed === "duplicate") {
          summary.duplicates += 1;
        }

        if (processed === "failed") {
          summary.failures += 1;
        }
        processedFiles += 1;
        await emitProgress(true);

        if (scopedFile.checkpointValue !== nextMarker) {
          await CheckpointModel.findOneAndUpdate(
            { sourceKey: source.key, tenantId: effectiveTenantId },
            { sourceKey: source.key, tenantId: effectiveTenantId, marker: scopedFile.checkpointValue },
            { upsert: true, new: true }
          );
          nextMarker = scopedFile.checkpointValue;
        }

        if (this.afterFileProcessed) {
          await this.afterFileProcessed({
            tenantId: effectiveTenantId,
            workloadTier: scopedFile.workloadTier,
            sourceKey: source.key,
            checkpointValue: scopedFile.checkpointValue,
            result: processed
          });
        }

        if (this.pauseRequested) {
          paused = true;
          logger.info("ingestion.run.paused", { ...summary, processedFiles });
          await emitProgress(false);
          return { ...summary, paused };
        }
      }
    }

    logger.info("ingestion.run.complete", { ...summary, processedFiles });
    await emitProgress(false);
    return { ...summary, paused };
  }

  private async filterAlreadyProcessedFiles(
    source: IngestionSource,
    files: IngestedFile[],
    effectiveTenantId: string
  ): Promise<IngestedFile[]> {
    if (files.length === 0 || (source.type !== "folder" && source.type !== "s3-upload")) {
      return files;
    }

    const existingDocs = await InvoiceModel.find({
      sourceType: source.type,
      tenantId: effectiveTenantId,
      sourceKey: source.key,
      sourceDocumentId: { $in: files.map((file) => file.sourceDocumentId) },
      status: { $ne: "PENDING" }
    })
      .select({ sourceDocumentId: 1, _id: 0 })
      .lean();

    const existingDocumentIds = new Set(
      existingDocs
        .map((doc) => doc.sourceDocumentId)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    );

    return files.filter((file) => !existingDocumentIds.has(file.sourceDocumentId));
  }

  private async processFile(file: IngestedFile): Promise<"created" | "duplicate" | "failed"> {
    const duplicate = await InvoiceModel.findOne({
      tenantId: file.tenantId,
      sourceType: file.sourceType,
      sourceKey: file.sourceKey,
      sourceDocumentId: file.sourceDocumentId,
      attachmentName: file.attachmentName,
      status: { $ne: "PENDING" }
    }).lean();

    if (duplicate) {
      return "duplicate";
    }

    const normalizedMimeType = normalizeInvoiceMimeType(file.mimeType);
    let ocrProvider = this.ocrProvider.name;
    let ocrText = "";
    let ocrConfidence: number | undefined;
    let ocrBlocks: OcrBlock[] = [];
    let status: InvoiceStatus;

    try {
      const extraction = await this.pipeline.extract({
        tenantId: file.tenantId,
        sourceKey: file.sourceKey,
        attachmentName: file.attachmentName,
        fileBuffer: file.buffer,
        mimeType: normalizedMimeType,
        expectedMaxTotal: env.CONFIDENCE_EXPECTED_MAX_TOTAL,
        expectedMaxDueDays: env.CONFIDENCE_EXPECTED_MAX_DUE_DAYS,
        autoSelectMin: env.CONFIDENCE_AUTO_SELECT_MIN
      });
      ocrProvider = extraction.provider;
      ocrText = extraction.text;
      ocrConfidence = extraction.confidence;
      ocrBlocks = extraction.ocrBlocks;

      const parsedResult = extraction.parseResult;
      const confidence = extraction.confidenceAssessment;
      const processingIssues = [...extraction.processingIssues];

      if (extraction.attempts.length > 1) {
        processingIssues.push(
          `Extraction agent selected ${extraction.source}/${extraction.strategy} from ${extraction.attempts.length} candidates.`
        );
      }

      status =
        parsedResult.warnings.length > 0 || confidence.riskFlags.length > 0 ? "NEEDS_REVIEW" : "PARSED";

      const metadata: Record<string, string> = {
        ...file.metadata,
        extractionSource: extraction.source,
        extractionStrategy: extraction.strategy,
        extractionCandidates: String(extraction.attempts.length),
        ocrBlocksCount: String(ocrBlocks.length),
        ...extraction.metadata
      };
      const artifactPrefix = buildArtifactPrefix(file);
      const pageSources = await buildPageSourcesForCropping(file, normalizedMimeType, extraction.ocrPageImages);
      const fieldProvenance = parseFieldProvenance(metadata.fieldProvenance);
      const [previewImagePaths, cropPathsByIndex] = await Promise.all([
        persistPreviewImages(file, normalizedMimeType, extraction.ocrPageImages, getPreviewStorageRoot(), artifactPrefix),
        this.fileStore
          ? persistOcrBlockCrops({
              file,
              mimeType: normalizedMimeType,
              blocks: ocrBlocks,
              pageSources,
              keyPrefix: `${artifactPrefix}/ocr-blocks`,
              fileStore: this.fileStore
            })
          : Promise.resolve(new Map<number, string>())
      ]);
      const fieldOverlayPaths =
        this.fileStore && Object.keys(fieldProvenance).length > 0
          ? await persistFieldOverlayImages({
              file,
              fieldProvenance,
              pageSources,
              keyPrefix: `${artifactPrefix}/source-overlays`,
              fileStore: this.fileStore
            })
          : new Map<string, string>();
      if (Object.keys(previewImagePaths).length > 0) {
        metadata.previewPageImages = JSON.stringify(previewImagePaths);
      }
      if (cropPathsByIndex.size > 0) {
        metadata.ocrBlockCropCount = String(cropPathsByIndex.size);
        metadata.ocrBlockCropProvider = this.fileStore?.name ?? "";
        metadata.ocrBlockCropPaths = JSON.stringify(Object.fromEntries(cropPathsByIndex));
      }

      if (cropPathsByIndex.size > 0) {
        ocrBlocks = ocrBlocks.map((block, index) => {
          const cropPath = cropPathsByIndex.get(index);
          return cropPath ? { ...block, cropPath } : block;
        });
      }
      if (fieldOverlayPaths.size > 0) {
        metadata.fieldOverlayPaths = JSON.stringify(Object.fromEntries(fieldOverlayPaths));
      }

      const mergedProcessingIssues = uniqueIssues([
        ...processingIssues,
        ...parsedResult.warnings,
        ...confidence.riskMessages
      ]);

      const baseFields = {
        sourceType: file.sourceType, tenantId: file.tenantId, workloadTier: file.workloadTier,
        sourceKey: file.sourceKey, sourceDocumentId: file.sourceDocumentId,
        attachmentName: file.attachmentName, mimeType: normalizedMimeType,
        receivedAt: file.receivedAt, ocrProvider, ocrText, ocrConfidence, ocrBlocks
      };

      const successData = {
        ...baseFields, status, metadata,
        parsed: parsedResult.parsed,
        confidenceScore: confidence.score, confidenceTone: confidence.tone,
        autoSelectForApproval: confidence.autoSelectForApproval,
        riskFlags: confidence.riskFlags, riskMessages: confidence.riskMessages,
        processingIssues: mergedProcessingIssues
      };
      await upsertFromPending(file, successData);

      return status === "PARSED" || status === "NEEDS_REVIEW" ? "created" : "failed";
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return "duplicate";
      }

      const failBaseFields = {
        sourceType: file.sourceType, tenantId: file.tenantId, workloadTier: file.workloadTier,
        sourceKey: file.sourceKey, sourceDocumentId: file.sourceDocumentId,
        attachmentName: file.attachmentName, mimeType: normalizedMimeType,
        receivedAt: file.receivedAt, metadata: file.metadata, ocrProvider, ocrText, ocrConfidence, ocrBlocks,
        confidenceScore: 0, confidenceTone: "red" as const,
        autoSelectForApproval: false, riskFlags: [] as string[], riskMessages: [] as string[]
      };

      if (error instanceof ExtractionPipelineError && error.code === "FAILED_OCR") {
        await upsertFromPending(file, { ...failBaseFields, status: "FAILED_OCR", processingIssues: [error.message] });
        return "failed";
      }

      logger.error("Failed to process ingested file", {
        sourceKey: file.sourceKey, sourceDocumentId: file.sourceDocumentId,
        attachmentName: file.attachmentName, error: error instanceof Error ? error.message : String(error)
      });

      try {
        await upsertFromPending(file, {
          ...failBaseFields, status: "FAILED_PARSE",
          processingIssues: [error instanceof Error ? error.message : "Unknown processing error"]
        });
      } catch (createError) {
        logger.error("Failed persisting failed invoice", {
          sourceKey: file.sourceKey,
          sourceDocumentId: file.sourceDocumentId,
          attachmentName: file.attachmentName,
          error: createError instanceof Error ? createError.message : String(createError)
        });
        throw createError;
      }

      return "failed";
    }
  }
}

async function upsertFromPending(file: IngestedFile, data: Record<string, unknown>): Promise<void> {
  const updated = await InvoiceModel.findOneAndUpdate(
    { tenantId: file.tenantId, sourceDocumentId: file.sourceDocumentId, status: "PENDING" },
    { $set: data }
  );
  if (!updated) {
    await InvoiceModel.create(data);
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

async function persistPreviewImages(
  file: IngestedFile,
  mimeType: string,
  images: OcrPageImage[],
  storageRoot: string,
  artifactPrefix: string
): Promise<Record<string, string>> {
  if (images.length === 0 && !mimeType.startsWith("image/")) {
    return {};
  }

  const targetDirectory = path.join(storageRoot, artifactPrefix);
  await fs.mkdir(targetDirectory, { recursive: true });

  const output: Record<string, string> = {};
  if (mimeType.startsWith("image/")) {
    const extension = extensionForMimeType(mimeType);
    const fileName = `page-1.${extension}`;
    const filePath = path.resolve(targetDirectory, fileName);
    if (isPathInsideRoot(storageRoot, filePath)) {
      await fs.writeFile(filePath, file.buffer);
      output["1"] = filePath;
    }
  }

  for (const image of images) {
    const parsed = decodeDataUrl(image.dataUrl);
    if (!parsed) {
      continue;
    }

    const extension = extensionForMimeType(parsed.mimeType);
    const fileName = `page-${image.page}.${extension}`;
    const filePath = path.resolve(targetDirectory, fileName);
    if (!isPathInsideRoot(storageRoot, filePath)) {
      continue;
    }

    await fs.writeFile(filePath, parsed.buffer);
    output[String(image.page)] = filePath;
  }

  return output;
}

function buildArtifactPrefix(file: IngestedFile): string {
  const hash = createHash("sha1")
    .update(`${file.tenantId}:${file.sourceKey}:${file.sourceDocumentId}:${file.attachmentName}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(file.tenantId, file.sourceKey, hash);
}

async function persistOcrBlockCrops(input: {
  file: IngestedFile;
  mimeType: string;
  blocks: OcrBlock[];
  pageSources: Map<number, CropPageImage>;
  keyPrefix: string;
  fileStore: FileStore;
}): Promise<Map<number, string>> {
  if (input.blocks.length === 0) {
    return new Map<number, string>();
  }

  if (input.pageSources.size === 0) {
    return new Map<number, string>();
  }

  const indexedBlocks = input.blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => entry.block.text.trim().length > 0);

  const results = new Map<number, string>();
  const concurrency = 8;
  for (let offset = 0; offset < indexedBlocks.length; offset += concurrency) {
    const batch = indexedBlocks.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async ({ block, index }) => {
        const pageImage = input.pageSources.get(block.page) ?? input.pageSources.get(1);
        if (!pageImage) {
          return;
        }

        const region = resolveCropRegion(block, pageImage.width, pageImage.height);
        if (!region) {
          return;
        }

        const cropped = await sharp(pageImage.buffer)
          .extract(region)
          .png({ compressionLevel: 9 })
          .toBuffer();
        const objectRef = await input.fileStore.putObject({
          key: `${input.keyPrefix}/page-${pageImage.page}/block-${index + 1}.png`,
          body: cropped,
          contentType: "image/png",
          metadata: {
            tenantId: input.file.tenantId,
            sourceKey: input.file.sourceKey,
            sourceDocumentId: input.file.sourceDocumentId
          }
        });
        results.set(index, objectRef.path);
      })
    );

    settled.forEach((result) => {
      if (result.status === "rejected") {
        logger.warn("ingestion.crop.persist.failed", {
          sourceDocumentId: input.file.sourceDocumentId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    });
  }

  return results;
}

interface CropPageImage {
  page: number;
  buffer: Buffer;
  width: number;
  height: number;
}

async function persistFieldOverlayImages(input: {
  file: IngestedFile;
  fieldProvenance: Record<string, FieldProvenanceEntry>;
  pageSources: Map<number, CropPageImage>;
  keyPrefix: string;
  fileStore: FileStore;
}): Promise<Map<string, string>> {
  if (input.pageSources.size === 0) {
    return new Map<string, string>();
  }

  const entries = Object.entries(input.fieldProvenance).filter(
    ([, value]) => value.bbox || value.bboxNormalized || value.bboxModel
  );
  if (entries.length === 0) {
    return new Map<string, string>();
  }

  const results = new Map<string, string>();
  const concurrency = 4;
  for (let offset = 0; offset < entries.length; offset += concurrency) {
    const batch = entries.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async ([field, provenance]) => {
        const pageImage = input.pageSources.get(provenance.page ?? 1) ?? input.pageSources.get(1);
        if (!pageImage) {
          return;
        }

        const normalized = resolveFieldOverlayBox(provenance, pageImage.width, pageImage.height);
        if (!normalized) {
          return;
        }

        const overlayBuffer = await renderOverlayImage(pageImage, normalized, field);
        const objectRef = await input.fileStore.putObject({
          key: `${input.keyPrefix}/${sanitizeObjectName(field)}.png`,
          body: overlayBuffer,
          contentType: "image/png",
          metadata: {
            tenantId: input.file.tenantId,
            sourceKey: input.file.sourceKey,
            sourceDocumentId: input.file.sourceDocumentId
          }
        });

        results.set(field, objectRef.path);
      })
    );

    settled.forEach((result) => {
      if (result.status === "rejected") {
        logger.warn("ingestion.overlay.persist.failed", {
          sourceDocumentId: input.file.sourceDocumentId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    });
  }

  return results;
}

async function buildPageSourcesForCropping(
  file: IngestedFile,
  mimeType: string,
  pageImages: OcrPageImage[]
): Promise<Map<number, CropPageImage>> {
  const output = new Map<number, CropPageImage>();

  if (mimeType === "application/pdf") {
    for (const pageImage of pageImages) {
      const parsed = decodeDataUrl(pageImage.dataUrl);
      if (!parsed) {
        continue;
      }

      const dimensions = await readImageDimensions(parsed.buffer);
      if (!dimensions) {
        continue;
      }

      output.set(pageImage.page, {
        page: pageImage.page,
        buffer: parsed.buffer,
        width: pageImage.width ?? dimensions.width,
        height: pageImage.height ?? dimensions.height
      });
    }
    return output;
  }

  if (!mimeType.startsWith("image/")) {
    return output;
  }

  const dimensions = await readImageDimensions(file.buffer);
  if (!dimensions) {
    return output;
  }

  output.set(1, {
    page: 1,
    buffer: file.buffer,
    width: dimensions.width,
    height: dimensions.height
  });
  return output;
}

async function readImageDimensions(value: Buffer): Promise<{ width: number; height: number } | undefined> {
  try {
    const metadata = await sharp(value).metadata();
    if (!metadata.width || !metadata.height) {
      return undefined;
    }
    return {
      width: metadata.width,
      height: metadata.height
    };
  } catch {
    return undefined;
  }
}

function resolveCropRegion(
  block: OcrBlock,
  pageWidth: number,
  pageHeight: number
): { left: number; top: number; width: number; height: number } | undefined {
  if (pageWidth <= 0 || pageHeight <= 0) {
    return undefined;
  }

  const normalized =
    normalizeUnitBox(block.bboxNormalized) ??
    normalizeModelBox(block.bboxModel) ??
    normalizeUnitBox(block.bbox) ??
    normalizeAbsoluteBox(block.bbox, pageWidth, pageHeight);
  if (!normalized) {
    return undefined;
  }

  const left = Math.max(0, Math.min(pageWidth - 1, Math.floor(normalized[0] * pageWidth)));
  const top = Math.max(0, Math.min(pageHeight - 1, Math.floor(normalized[1] * pageHeight)));
  const right = Math.max(left + 1, Math.min(pageWidth, Math.ceil(normalized[2] * pageWidth)));
  const bottom = Math.max(top + 1, Math.min(pageHeight, Math.ceil(normalized[3] * pageHeight)));
  const width = right - left;
  const height = bottom - top;
  if (width <= 1 || height <= 1) {
    return undefined;
  }

  return { left, top, width, height };
}

type Box4 = [number, number, number, number];

function validateBox(value: Box4 | undefined): Box4 | undefined {
  if (!value) return undefined;
  const [x1, y1, x2, y2] = value;
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return undefined;
  return value;
}

function normalizeUnitBox(value: Box4 | undefined): Box4 | undefined {
  const v = validateBox(value);
  if (!v) return undefined;
  const [x1, y1, x2, y2] = v;
  return (x1 < 0 || y1 < 0 || x2 > 1 || y2 > 1) ? undefined : v;
}

function normalizeModelBox(value: Box4 | undefined): Box4 | undefined {
  const v = validateBox(value);
  if (!v) return undefined;
  const scale = 999;
  return v.map((n) => Math.max(0, Math.min(1, n / scale))) as Box4;
}

function normalizeAbsoluteBox(value: Box4, pageWidth: number, pageHeight: number): Box4 | undefined {
  if (!validateBox(value)) return undefined;
  const [x1, y1, x2, y2] = value;
  return [
    Math.max(0, Math.min(1, x1 / pageWidth)), Math.max(0, Math.min(1, y1 / pageHeight)),
    Math.max(0, Math.min(1, x2 / pageWidth)), Math.max(0, Math.min(1, y2 / pageHeight))
  ];
}

function resolveFieldOverlayBox(
  provenance: FieldProvenanceEntry,
  pageWidth: number,
  pageHeight: number
): [number, number, number, number] | undefined {
  if (pageWidth <= 0 || pageHeight <= 0) {
    return undefined;
  }

  const bbox = provenance.bbox;
  const bboxNormalized = provenance.bboxNormalized;
  const bboxModel = provenance.bboxModel;
  if (bboxNormalized) {
    const normalized = normalizeUnitBox(bboxNormalized);
    if (normalized) {
      return normalized;
    }
  }

  if (bboxModel) {
    const normalized = normalizeModelBox(bboxModel);
    if (normalized) {
      return normalized;
    }
  }

  if (!bbox) {
    return undefined;
  }

  return normalizeUnitBox(bbox) ?? normalizeAbsoluteBox(bbox, pageWidth, pageHeight);
}

async function renderOverlayImage(
  pageImage: CropPageImage,
  box: [number, number, number, number],
  field: string
): Promise<Buffer> {
  const left = Math.max(0, Math.min(pageImage.width - 1, Math.floor(box[0] * pageImage.width)));
  const top = Math.max(0, Math.min(pageImage.height - 1, Math.floor(box[1] * pageImage.height)));
  const right = Math.max(left + 1, Math.min(pageImage.width, Math.ceil(box[2] * pageImage.width)));
  const bottom = Math.max(top + 1, Math.min(pageImage.height, Math.ceil(box[3] * pageImage.height)));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const strokeWidth = Math.max(2, Math.round(Math.min(pageImage.width, pageImage.height) * 0.004));
  const labelText = escapeSvgText(field);

  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pageImage.width}" height="${pageImage.height}" viewBox="0 0 ${pageImage.width} ${pageImage.height}">
  <rect x="${left}" y="${top}" width="${width}" height="${height}" fill="rgba(31,122,108,0.2)" stroke="#1f7a6c" stroke-width="${strokeWidth}" />
  <rect x="${left}" y="${Math.max(0, top - 24)}" width="${Math.min(pageImage.width - left, Math.max(110, labelText.length * 8))}" height="22" fill="#1f7a6c" />
  <text x="${left + 8}" y="${Math.max(15, top - 9)}" fill="#ffffff" font-size="13" font-family="Arial, sans-serif">${labelText}</text>
</svg>`;

  return sharp(pageImage.buffer)
    .composite([{ input: Buffer.from(overlaySvg), blend: "over" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function decodeDataUrl(value: string): { mimeType: string; buffer: Buffer } | undefined {
  const separatorIndex = value.indexOf(",");
  if (separatorIndex < 0) {
    return undefined;
  }

  const header = value.slice(0, separatorIndex);
  const payload = value.slice(separatorIndex + 1);
  const mimeMatch = /^data:([^;]+);base64$/i.exec(header.trim());
  if (!mimeMatch) {
    return undefined;
  }

  try {
    return {
      mimeType: mimeMatch[1].toLowerCase(),
      buffer: Buffer.from(payload, "base64")
    };
  } catch {
    return undefined;
  }
}

function extensionForMimeType(value: string): string {
  if (value === "image/jpeg" || value === "image/jpg") {
    return "jpg";
  }
  return "png";
}

function sanitizeObjectName(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseFieldProvenance(value: string | undefined): Record<string, FieldProvenanceEntry> {
  if (!value) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const output: Record<string, FieldProvenanceEntry> = {};
  for (const [field, rawEntry] of Object.entries(parsed)) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }

    const candidate = rawEntry as Partial<FieldProvenanceEntry>;
    const bbox = normalizeBoxTuple(candidate.bbox);
    const bboxNormalized = normalizeBoxTuple(candidate.bboxNormalized);
    const bboxModel = normalizeBoxTuple(candidate.bboxModel);
    if (!bbox && !bboxNormalized && !bboxModel) {
      continue;
    }

    output[field] = {
      source: typeof candidate.source === "string" ? candidate.source : undefined,
      page: typeof candidate.page === "number" && Number.isFinite(candidate.page) ? Math.max(1, Math.round(candidate.page)) : 1,
      ...(bbox ? { bbox } : {}),
      ...(bboxNormalized ? { bboxNormalized } : {}),
      ...(bboxModel ? { bboxModel } : {}),
      ...(typeof candidate.blockIndex === "number" && Number.isFinite(candidate.blockIndex)
        ? { blockIndex: Math.max(0, Math.round(candidate.blockIndex)) }
        : {})
    };
  }

  return output;
}

function normalizeBoxTuple(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }

  const numbers = value.map((entry) => Number(entry));
  if (!numbers.every((entry) => Number.isFinite(entry))) {
    return undefined;
  }

  const [x1, y1, x2, y2] = numbers;
  if (x2 <= x1 || y2 <= y1) {
    return undefined;
  }

  return [x1, y1, x2, y2];
}

function uniqueIssues(issues: string[]): string[] {
  return [...new Set(issues.filter((issue) => issue.trim().length > 0))];
}

function compareSourcePriority(left: IngestionSource, right: IngestionSource): number {
  return priorityForTier(left.workloadTier) - priorityForTier(right.workloadTier);
}

function priorityForTier(tier: WorkloadTier): number {
  return tier === "standard" ? 0 : 1;
}
