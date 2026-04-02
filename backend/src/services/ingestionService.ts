import type { IngestionSource, IngestedFile } from "../core/interfaces/IngestionSource.js";
import type { FileStore } from "../core/interfaces/FileStore.js";
import type { OcrBlock, OcrProvider } from "../core/interfaces/OcrProvider.js";
import { CheckpointModel } from "../models/Checkpoint.js";
import { InvoiceModel } from "../models/Invoice.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { normalizeInvoiceMimeType } from "../utils/mime.js";
import type { WorkloadTier } from "../types/tenant.js";
import { TenantModel } from "../models/Tenant.js";
import { S3UploadIngestionSource } from "../sources/S3UploadIngestionSource.js";
import { InvoiceExtractionPipeline, ExtractionPipelineError } from "./extraction/InvoiceExtractionPipeline.js";
import { NoopFieldVerifier } from "../verifier/NoopFieldVerifier.js";
import { MongoVendorTemplateStore } from "./extraction/vendorTemplateStore.js";
import { buildFailureData, buildSuccessData, isDuplicateKeyError, upsertFromPending } from "./ingestion/persistence.js";
import { persistFieldArtifacts } from "./ingestion/artifacts.js";
const MAX_FILE_PROCESSING_CONCURRENCY = 2;

interface IngestionRunSummary {
  totalFiles: number;
  newInvoices: number;
  duplicates: number;
  failures: number;
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
      for (let offset = 0; offset < files.length; offset += MAX_FILE_PROCESSING_CONCURRENCY) {
        const batch = files
          .slice(offset, offset + MAX_FILE_PROCESSING_CONCURRENCY)
          .map((file) => (file.tenantId === effectiveTenantId ? file : { ...file, tenantId: effectiveTenantId }));

        const settled = await Promise.all(
          batch.map(async (scopedFile) => ({
            scopedFile,
            processed: await this.processFile(scopedFile)
          }))
        );

        for (const { scopedFile, processed } of settled) {
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
    const gmailMessageId = file.sourceType === "email" && file.metadata?.messageId
      ? String(file.metadata.messageId).trim()
      : undefined;

    if (gmailMessageId) {
      const msgDup = await InvoiceModel.findOne({ tenantId: file.tenantId, gmailMessageId }).lean();
      if (msgDup) return "duplicate";
    }

    const pendingDoc = await InvoiceModel.findOne({
      tenantId: file.tenantId,
      sourceDocumentId: file.sourceDocumentId,
      status: "PENDING"
    }).select({ contentHash: 1 }).lean();
    const contentDuplicate = pendingDoc?.contentHash
      ? await InvoiceModel.findOne({
          tenantId: file.tenantId,
          contentHash: pendingDoc.contentHash,
          sourceDocumentId: { $ne: file.sourceDocumentId },
          status: { $ne: "PENDING" }
        }).select({ _id: 1, attachmentName: 1 }).lean()
      : null;

    const normalizedMimeType = normalizeInvoiceMimeType(file.mimeType);
    const baseOcrState = { ocrProvider: this.ocrProvider.name, ocrText: "", ocrConfidence: undefined as number | undefined, ocrBlocks: [] as OcrBlock[] };

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

      const ocrBlocks = extraction.ocrBlocks;
      const artifactResults = await persistFieldArtifacts({
        file,
        mimeType: normalizedMimeType,
        extraction,
        ocrBlocks,
        fileStore: this.fileStore
      });
      const successData = buildSuccessData(file, normalizedMimeType, extraction, ocrBlocks, artifactResults);
      if (contentDuplicate) {
        const issues = (successData.processingIssues as string[]) ?? [];
        issues.push(`Duplicate content detected (matches "${contentDuplicate.attachmentName ?? "unknown"}").`);
        successData.processingIssues = issues;
      }
      await upsertFromPending(file, successData);

      return successData.status === "PARSED" || successData.status === "NEEDS_REVIEW" ? "created" : "failed";
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        logger.warn("ingestion.file.duplicate_key", {
          sourceDocumentId: file.sourceDocumentId,
          attachmentName: file.attachmentName
        });
        return "created";
      }

      const failureData = buildFailureData(file, normalizedMimeType, baseOcrState, error);
      await this.persistFailure(file, failureData, error);
      return "failed";
    }
  }

  private async persistFailure(
    file: IngestedFile,
    failureData: Record<string, unknown>,
    originalError: unknown
  ): Promise<void> {
    if (originalError instanceof ExtractionPipelineError && originalError.code === "FAILED_OCR") {
      await upsertFromPending(file, failureData);
      return;
    }

    logger.error("Failed to process ingested file", {
      sourceKey: file.sourceKey, sourceDocumentId: file.sourceDocumentId,
      attachmentName: file.attachmentName,
      error: originalError instanceof Error ? originalError.message : String(originalError)
    });

    try {
      await upsertFromPending(file, failureData);
    } catch (createError) {
      logger.error("Failed persisting failed invoice", {
        sourceKey: file.sourceKey, sourceDocumentId: file.sourceDocumentId,
        attachmentName: file.attachmentName,
        error: createError instanceof Error ? createError.message : String(createError)
      });
      throw createError;
    }
  }
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
