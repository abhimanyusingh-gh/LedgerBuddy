import { INGESTION_SOURCE_TYPE, type IngestionSource, type IngestedFile } from "@/core/interfaces/IngestionSource.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import type { OcrBlock, OcrProvider } from "@/core/interfaces/OcrProvider.js";
import { CheckpointModel } from "@/models/core/Checkpoint.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { logger } from "@/utils/logger.js";
import { env } from "@/config/env.js";
import { normalizeInvoiceMimeType } from "@/utils/mime.js";
import { assertDocumentMimeType } from "@/types/mime.js";
import type { WorkloadTier } from "@/types/tenant.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { type UUID, toUUID } from "@/types/uuid.js";
import { PIPELINE_ERROR_CODE } from "@/core/engine/types.js";
import { TenantModel } from "@/models/core/Tenant.js";
import { S3UploadIngestionSource } from "@/sources/S3UploadIngestionSource.js";
import { InvoiceExtractionPipeline, ExtractionPipelineError } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";
import { NoopFieldVerifier } from "@/ai/verifiers/NoopFieldVerifier.js";
import { MongoVendorTemplateStore } from "@/ai/extractors/invoice/learning/vendorTemplateStore.js";
import { buildFailureData, buildSuccessData, isDuplicateKeyError, upsertFromPending } from "@/services/ingestion/persistence.js";
import { persistFieldArtifacts } from "@/services/ingestion/artifacts.js";
import { INGESTION_FILE_RESULT, type IngestionFileResult } from "@/types/ingestion.js";
const MAX_FILE_PROCESSING_CONCURRENCY = env.INGESTION_CONCURRENCY;

interface IngestionRunSummary {
  totalFiles: number;
  newInvoices: number;
  duplicates: number;
  failures: number;
}

interface IngestionRunProgress extends IngestionRunSummary {
  processedFiles: number;
  running: boolean;
  lastUpdatedAt: Date;
  systemAlert?: string;
}

interface IngestionServiceOptions {
  afterFileProcessed?: (params: {
    tenantId: UUID;
    workloadTier: WorkloadTier;
    sourceKey: string;
    checkpointValue: string;
    result: IngestionFileResult;
  }) => Promise<void> | void;
  pipeline?: InvoiceExtractionPipeline;
  fileStore?: FileStore;
}

interface RunOnceRuntimeOptions {
  onProgress?: (progress: IngestionRunProgress) => Promise<void> | void;
  tenantId?: UUID;
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
      new InvoiceExtractionPipeline({ ocrProvider: this.ocrProvider, fieldVerifier: new NoopFieldVerifier(), templateStore: new MongoVendorTemplateStore() });
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
    const emittedAlerts = new Set<string>();
    logger.info("ingestion.run.start", { sourceCount: this.sources.length });

    const emitProgress = async (running = true, systemAlert?: string) => {
      if (!runtimeOptions?.onProgress) {
        return;
      }

      await runtimeOptions.onProgress({
        ...summary,
        processedFiles,
        running,
        lastUpdatedAt: new Date(),
        ...(systemAlert ? { systemAlert } : {})
      });
    };

    await emitProgress(true);

    const runtimeTenantId: UUID | null =
      runtimeOptions?.tenantId && runtimeOptions.tenantId.trim().length > 0 ? toUUID(runtimeOptions.tenantId.trim()) : null;
    const prioritizedSources = [...this.sources].sort(compareSourcePriority);
    const tenantMatchedSources =
      runtimeTenantId !== null
        ? prioritizedSources.filter((source) => source.tenantId === runtimeTenantId)
        : prioritizedSources;
    let tenantScopedSources =
      runtimeTenantId !== null && tenantMatchedSources.length > 0 ? tenantMatchedSources : prioritizedSources;

    if (runtimeTenantId !== null) {
      const tenantDoc = await TenantModel.findById(runtimeTenantId).select({ mode: 1 }).lean();
      if (tenantDoc?.mode === "live") {
        tenantScopedSources = tenantScopedSources.filter((s) => s.type !== INGESTION_SOURCE_TYPE.FOLDER);
      }
    }

    if (runtimeTenantId !== null && this.fileStore?.listObjects) {
      const uploadSource = new S3UploadIngestionSource(runtimeTenantId, this.fileStore);
      tenantScopedSources = [...tenantScopedSources, uploadSource];
    }

    if (runtimeTenantId !== null && tenantMatchedSources.length === 0) {
      logger.warn("ingestion.run.tenant_source_fallback", {
        tenantId: runtimeTenantId,
        sourceCount: prioritizedSources.length
      });
    }

    for (const source of tenantScopedSources) {
      const effectiveTenantId = runtimeTenantId ?? source.tenantId;
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
          const { result, systemAlert } = processed;
          logger.info("ingestion.file.result", {
            sourceKey: scopedFile.sourceKey,
            sourceDocumentId: scopedFile.sourceDocumentId,
            attachmentName: scopedFile.attachmentName,
            result
          });
          if (result === INGESTION_FILE_RESULT.CREATED) {
            summary.newInvoices += 1;
          }

          if (result === INGESTION_FILE_RESULT.DUPLICATE) {
            summary.duplicates += 1;
          }

          if (result === INGESTION_FILE_RESULT.FAILED) {
            summary.failures += 1;
          }
          processedFiles += 1;
          const newAlert = systemAlert && !emittedAlerts.has(systemAlert) ? systemAlert : undefined;
          if (newAlert) emittedAlerts.add(newAlert);
          await emitProgress(true, newAlert);

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
              result
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
    effectiveTenantId: UUID
  ): Promise<IngestedFile[]> {
    if (files.length === 0 || (source.type !== INGESTION_SOURCE_TYPE.FOLDER && source.type !== INGESTION_SOURCE_TYPE.S3_UPLOAD)) {
      return files;
    }

    const existingDocs = await InvoiceModel.find({
      sourceType: source.type,
      tenantId: effectiveTenantId,
      sourceKey: source.key,
      sourceDocumentId: { $in: files.map((file) => file.sourceDocumentId) },
      status: { $ne: INVOICE_STATUS.PENDING }
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

  private async processFile(file: IngestedFile): Promise<{ result: IngestionFileResult; systemAlert?: string }> {
    const gmailMessageId = file.sourceType === INGESTION_SOURCE_TYPE.EMAIL && file.metadata?.messageId
      ? String(file.metadata.messageId).trim()
      : undefined;

    if (gmailMessageId) {
      const msgDup = await InvoiceModel.findOne({ tenantId: file.tenantId, gmailMessageId }).lean();
      if (msgDup) return { result: INGESTION_FILE_RESULT.DUPLICATE };
    }

    const pendingDoc = await InvoiceModel.findOne({
      tenantId: file.tenantId,
      sourceDocumentId: file.sourceDocumentId,
      status: INVOICE_STATUS.PENDING
    }).select({ contentHash: 1 }).lean();
    const contentDuplicate = pendingDoc?.contentHash
      ? await InvoiceModel.findOne({
          tenantId: file.tenantId,
          contentHash: pendingDoc.contentHash,
          sourceDocumentId: { $ne: file.sourceDocumentId },
          status: { $ne: INVOICE_STATUS.PENDING }
        }).select({ _id: 1, attachmentName: 1 }).lean()
      : null;

    const normalizedMimeType = assertDocumentMimeType(normalizeInvoiceMimeType(file.mimeType));
    const baseOcrState = { ocrProvider: this.ocrProvider.name, ocrText: "", ocrConfidence: undefined as number | undefined, ocrBlocks: [] as OcrBlock[] };

    try {
      const extraction = await this.pipeline.extract({
        tenantId: file.tenantId,
        sourceKey: file.sourceKey,
        attachmentName: file.attachmentName,
        fileBuffer: file.buffer,
        mimeType: normalizedMimeType,
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

      const warnings = extraction.parseResult.warnings;
      const systemAlert = warnings.includes("slm_credit_exhausted")
        ? "AI processing quota exhausted. Please check your account and try again later."
        : warnings.includes("slm_rate_limited")
          ? "AI processing is rate-limited. Please wait a moment before retrying."
          : undefined;

      const result = successData.status === INVOICE_STATUS.PARSED || successData.status === INVOICE_STATUS.NEEDS_REVIEW ? INGESTION_FILE_RESULT.CREATED : INGESTION_FILE_RESULT.FAILED;
      return { result, systemAlert };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        logger.warn("ingestion.file.duplicate_key", {
          sourceDocumentId: file.sourceDocumentId,
          attachmentName: file.attachmentName
        });
        return { result: INGESTION_FILE_RESULT.CREATED };
      }

      const failureData = buildFailureData(file, normalizedMimeType, baseOcrState, error);
      await this.persistFailure(file, failureData, error);
      return { result: INGESTION_FILE_RESULT.FAILED };
    }
  }

  private async persistFailure(
    file: IngestedFile,
    failureData: Record<string, unknown>,
    originalError: unknown
  ): Promise<void> {
    if (originalError instanceof ExtractionPipelineError && originalError.code === PIPELINE_ERROR_CODE.FAILED_OCR) {
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

function compareSourcePriority(left: IngestionSource, right: IngestionSource): number {
  return priorityForTier(left.workloadTier) - priorityForTier(right.workloadTier);
}

function priorityForTier(tier: WorkloadTier): number {
  return tier === "standard" ? 0 : 1;
}
