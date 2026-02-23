import type { IngestionSource, IngestedFile } from "../core/interfaces/IngestionSource.js";
import type { OcrBlock, OcrProvider } from "../core/interfaces/OcrProvider.js";
import { CheckpointModel } from "../models/Checkpoint.js";
import { InvoiceModel } from "../models/Invoice.js";
import { logger } from "../utils/logger.js";
import type { InvoiceStatus } from "../types/invoice.js";
import { env } from "../config/env.js";
import { normalizeInvoiceMimeType } from "../utils/mime.js";
import type { WorkloadTier } from "../types/tenant.js";
import { InvoiceExtractionPipeline, ExtractionPipelineError } from "./extraction/InvoiceExtractionPipeline.js";
import { NoopFieldVerifier } from "../verifier/NoopFieldVerifier.js";
import { MongoVendorTemplateStore } from "./extraction/vendorTemplateStore.js";

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
}

interface RunOnceRuntimeOptions {
  onProgress?: (progress: IngestionRunProgress) => Promise<void> | void;
}

export class IngestionService {
  private readonly afterFileProcessed?: IngestionServiceOptions["afterFileProcessed"];
  private readonly pipeline: InvoiceExtractionPipeline;

  constructor(
    private readonly sources: IngestionSource[],
    private readonly ocrProvider: OcrProvider,
    options?: IngestionServiceOptions
  ) {
    this.afterFileProcessed = options?.afterFileProcessed;
    this.pipeline =
      options?.pipeline ??
      new InvoiceExtractionPipeline(this.ocrProvider, new NoopFieldVerifier(), new MongoVendorTemplateStore());
  }

  async runOnce(runtimeOptions?: RunOnceRuntimeOptions): Promise<IngestionRunSummary> {
    const summary: IngestionRunSummary = {
      totalFiles: 0,
      newInvoices: 0,
      duplicates: 0,
      failures: 0
    };
    let processedFiles = 0;
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

    const prioritizedSources = [...this.sources].sort(compareSourcePriority);
    for (const source of prioritizedSources) {
      const checkpoint = await CheckpointModel.findOne({ sourceKey: source.key, tenantId: source.tenantId }).lean();
      const sourceFiles = await source.fetchNewFiles(checkpoint?.marker ?? null);
      const files = await this.filterAlreadyProcessedFiles(source, sourceFiles);
      logger.info("ingestion.source.scan", {
        tenantId: source.tenantId,
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
        const processed = await this.processFile(file);
        logger.info("ingestion.file.result", {
          sourceKey: file.sourceKey,
          sourceDocumentId: file.sourceDocumentId,
          attachmentName: file.attachmentName,
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

        if (file.checkpointValue !== nextMarker) {
          await CheckpointModel.findOneAndUpdate(
            { sourceKey: source.key, tenantId: source.tenantId },
            { sourceKey: source.key, tenantId: source.tenantId, marker: file.checkpointValue },
            { upsert: true, new: true }
          );
          nextMarker = file.checkpointValue;
        }

        if (this.afterFileProcessed) {
          await this.afterFileProcessed({
            tenantId: file.tenantId,
            workloadTier: file.workloadTier,
            sourceKey: source.key,
            checkpointValue: file.checkpointValue,
            result: processed
          });
        }
      }
    }

    logger.info("ingestion.run.complete", { ...summary, processedFiles });
    await emitProgress(false);
    return summary;
  }

  private async filterAlreadyProcessedFiles(source: IngestionSource, files: IngestedFile[]): Promise<IngestedFile[]> {
    if (files.length === 0 || source.type !== "folder") {
      return files;
    }

    const existingDocs = await InvoiceModel.find({
      sourceType: source.type,
      tenantId: source.tenantId,
      sourceKey: source.key,
      sourceDocumentId: { $in: files.map((file) => file.sourceDocumentId) }
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
      attachmentName: file.attachmentName
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

      const metadata = {
        ...file.metadata,
        extractionSource: extraction.source,
        extractionStrategy: extraction.strategy,
        extractionCandidates: String(extraction.attempts.length),
        ocrBlocksCount: String(ocrBlocks.length),
        ...extraction.metadata
      };

      const mergedProcessingIssues = uniqueIssues([
        ...processingIssues,
        ...parsedResult.warnings,
        ...confidence.riskMessages
      ]);

      await InvoiceModel.create({
        sourceType: file.sourceType,
        tenantId: file.tenantId,
        workloadTier: file.workloadTier,
        sourceKey: file.sourceKey,
        sourceDocumentId: file.sourceDocumentId,
        attachmentName: file.attachmentName,
        mimeType: normalizedMimeType,
        receivedAt: file.receivedAt,
        status,
        metadata,
        ocrProvider,
        ocrText,
        ocrConfidence,
        ocrBlocks,
        parsed: parsedResult.parsed,
        confidenceScore: confidence.score,
        confidenceTone: confidence.tone,
        autoSelectForApproval: confidence.autoSelectForApproval,
        riskFlags: confidence.riskFlags,
        riskMessages: confidence.riskMessages,
        processingIssues: mergedProcessingIssues
      });

      return status === "PARSED" || status === "NEEDS_REVIEW" ? "created" : "failed";
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return "duplicate";
      }

      if (error instanceof ExtractionPipelineError && error.code === "FAILED_OCR") {
        await InvoiceModel.create({
          sourceType: file.sourceType,
          tenantId: file.tenantId,
          workloadTier: file.workloadTier,
          sourceKey: file.sourceKey,
          sourceDocumentId: file.sourceDocumentId,
          attachmentName: file.attachmentName,
          mimeType: normalizedMimeType,
          receivedAt: file.receivedAt,
          status: "FAILED_OCR",
          processingIssues: [error.message],
          metadata: file.metadata,
          ocrProvider,
          ocrText,
          ocrConfidence,
          ocrBlocks,
          confidenceScore: 0,
          confidenceTone: "red",
          autoSelectForApproval: false,
          riskFlags: [],
          riskMessages: []
        });
        return "failed";
      }

      logger.error("Failed to process ingested file", {
        sourceKey: file.sourceKey,
        sourceDocumentId: file.sourceDocumentId,
        attachmentName: file.attachmentName,
        error: error instanceof Error ? error.message : String(error)
      });

      try {
        await InvoiceModel.create({
          sourceType: file.sourceType,
          tenantId: file.tenantId,
          workloadTier: file.workloadTier,
          sourceKey: file.sourceKey,
          sourceDocumentId: file.sourceDocumentId,
          attachmentName: file.attachmentName,
          mimeType: normalizedMimeType,
          receivedAt: file.receivedAt,
          status: "FAILED_PARSE",
          processingIssues: [error instanceof Error ? error.message : "Unknown processing error"],
          metadata: file.metadata,
          ocrProvider,
          ocrText,
          ocrConfidence,
          ocrBlocks,
          confidenceScore: 0,
          confidenceTone: "red",
          autoSelectForApproval: false,
          riskFlags: [],
          riskMessages: []
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

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
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
