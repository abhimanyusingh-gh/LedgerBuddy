import { INGESTION_SOURCE_TYPE, type IngestedFile } from "@/core/interfaces/IngestionSource.js";
import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import {
  INVOICE_STATUS,
  type InvoiceExtractionData,
  type InvoiceStatus
} from "@/types/invoice.js";
import type { DocumentMimeType } from "@/types/mime.js";
import type { ArtifactResults } from "@/services/ingestion/artifacts.js";
import { normalizeExtractionData, encodeExtractionFieldKey } from "@/services/ingestion/provenance.js";
import { ExtractionPipelineError } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";
import { PIPELINE_ERROR_CODE } from "@/core/engine/types.js";
import { uniqueStrings } from "@/utils/text.js";

interface ExtractionResult {
  provider: string;
  text: string;
  confidence?: number | undefined;
  ocrBlocks: OcrBlock[];
  ocrPageImages: Array<{ dataUrl: string; page: number; width?: number; height?: number }>;
  ocrTokens?: number;
  slmTokens?: number;
  parseResult: { parsed: unknown; warnings: string[] };
  confidenceAssessment: { score: number; tone: import("@/types/confidence.js").ConfidenceTone; autoSelectForApproval: boolean };
  processingIssues: string[];
  attempts: unknown[];
  source: import("@/core/engine/extractionSource.js").ExtractionSource;
  strategy: import("@/core/engine/extractionSource.js").ExtractionSource;
  metadata: Record<string, string>;
  compliance?: import("../../types/invoice.js").InvoiceCompliance;
  extraction?: InvoiceExtractionData;
}

export function buildSuccessData(
  file: IngestedFile,
  mimeType: DocumentMimeType,
  extraction: ExtractionResult,
  ocrBlocks: OcrBlock[],
  artifacts: ArtifactResults
): Record<string, unknown> {
  const processingIssues = [...extraction.processingIssues];
  if (extraction.attempts.length > 1) {
    processingIssues.push(
      `Extraction agent selected ${extraction.source}/${extraction.strategy} from ${extraction.attempts.length} candidates.`
    );
  }

  const parsedResult = extraction.parseResult;
  const confidence = extraction.confidenceAssessment;
  const complianceRiskSignals = extraction.compliance?.riskSignals ?? [];
  const hasOpenRiskSignals = complianceRiskSignals.some(s => s.status === "open");
  const status: InvoiceStatus =
    parsedResult.warnings.length > 0 || hasOpenRiskSignals ? INVOICE_STATUS.NEEDS_REVIEW : INVOICE_STATUS.PARSED;

  const metadata: Record<string, string> = {
    ...file.metadata,
    extractionSource: extraction.source,
    extractionStrategy: extraction.strategy,
    extractionCandidates: String(extraction.attempts.length),
    ocrBlocksCount: String(ocrBlocks.length),
    ...extraction.metadata
  };
  const extractionData = normalizeExtractionData(extraction.extraction);

  if (Object.keys(artifacts.previewImagePaths).length > 0) {
    metadata.previewPageImages = JSON.stringify(artifacts.previewImagePaths);
  }

  let finalBlocks = ocrBlocks;
  const textBlockCount = ocrBlocks.filter((block) => block.text.trim().length > 0).length;
  if (artifacts.cropPathsByIndex.size > 0) {
    metadata.ocrBlockCropCount = String(artifacts.cropPathsByIndex.size);
    metadata.ocrBlockCropProvider = "";
    metadata.ocrBlockCropPaths = JSON.stringify(Object.fromEntries(artifacts.cropPathsByIndex));
    finalBlocks = ocrBlocks.map((block, index) => {
      const cropPath = artifacts.cropPathsByIndex.get(index);
      return cropPath ? { ...block, cropPath } : block;
    });
  }
  if (textBlockCount > 0 && artifacts.cropPathsByIndex.size === 0) {
    processingIssues.push(`Crop generation failed for all ${textBlockCount} OCR blocks.`);
  } else if (textBlockCount > 0 && artifacts.cropPathsByIndex.size < textBlockCount) {
    processingIssues.push(`Crop generation partial: ${artifacts.cropPathsByIndex.size}/${textBlockCount} blocks.`);
  }
  if (artifacts.fieldOverlayPaths.size > 0) {
    const overlayPaths = Object.fromEntries(artifacts.fieldOverlayPaths);
    metadata.fieldOverlayPaths = JSON.stringify(overlayPaths);
    if (extractionData) {
      extractionData.fieldOverlayPaths = Object.fromEntries(
        Object.entries(overlayPaths).map(([field, path]) => [encodeExtractionFieldKey(field), path])
      );
    }
  }

  const gmailMessageId = file.sourceType === INGESTION_SOURCE_TYPE.EMAIL && file.metadata?.messageId
    ? String(file.metadata.messageId).trim()
    : undefined;

  return {
    sourceType: file.sourceType, tenantId: file.tenantId, workloadTier: file.workloadTier,
    sourceKey: file.sourceKey, sourceDocumentId: file.sourceDocumentId,
    attachmentName: file.attachmentName, mimeType,
    receivedAt: file.receivedAt,
    ...(gmailMessageId ? { gmailMessageId } : {}),
    ocrProvider: extraction.provider, ocrText: extraction.text,
    ocrConfidence: extraction.confidence, ocrBlocks: finalBlocks,
    ocrTokens: extraction.ocrTokens, slmTokens: extraction.slmTokens,
    status, metadata,
    parsed: parsedResult.parsed,
    confidenceScore: Number.isFinite(confidence.score) ? confidence.score : 0, confidenceTone: confidence.tone,
    autoSelectForApproval: confidence.autoSelectForApproval,
    riskFlags: complianceRiskSignals.map(s => s.code),
    riskMessages: complianceRiskSignals.map(s => s.message),
    processingIssues: uniqueStrings([...processingIssues, ...parsedResult.warnings, ...complianceRiskSignals.map(s => s.message)]),
    ...(extractionData ? { extraction: extractionData } : {}),
    ...(extraction.compliance ? { compliance: extraction.compliance } : {})
  };
}

export function buildFailureData(
  file: IngestedFile,
  mimeType: DocumentMimeType,
  ocrState: { ocrProvider: string; ocrText: string; ocrConfidence: number | undefined; ocrBlocks: OcrBlock[] },
  error: unknown
): Record<string, unknown> {
  const base = {
    sourceType: file.sourceType, tenantId: file.tenantId, workloadTier: file.workloadTier,
    sourceKey: file.sourceKey, sourceDocumentId: file.sourceDocumentId,
    attachmentName: file.attachmentName, mimeType,
    receivedAt: file.receivedAt, metadata: file.metadata,
    ocrProvider: ocrState.ocrProvider, ocrText: ocrState.ocrText,
    ocrConfidence: ocrState.ocrConfidence, ocrBlocks: ocrState.ocrBlocks,
    confidenceScore: 0, confidenceTone: "red" as const,
    autoSelectForApproval: false, riskFlags: [] as string[], riskMessages: [] as string[]
  };

  if (error instanceof ExtractionPipelineError && error.code === PIPELINE_ERROR_CODE.FAILED_OCR) {
    return { ...base, status: INVOICE_STATUS.FAILED_OCR, processingIssues: [error.message] };
  }

  return {
    ...base, status: INVOICE_STATUS.FAILED_PARSE,
    processingIssues: [error instanceof Error ? error.message : "Unknown processing error"]
  };
}

export async function upsertFromPending(file: IngestedFile, data: Record<string, unknown>): Promise<void> {
  const { attachmentName: _keep, ...updateData } = data;
  const updated = await InvoiceModel.findOneAndUpdate(
    { tenantId: file.tenantId, sourceDocumentId: file.sourceDocumentId, status: INVOICE_STATUS.PENDING },
    { $set: updateData }
  );
  if (updated) return;

  const overwritten = await InvoiceModel.findOneAndUpdate(
    { tenantId: file.tenantId, sourceDocumentId: file.sourceDocumentId },
    { $set: updateData }
  );
  if (overwritten) return;

  await InvoiceModel.create(data);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

export { isDuplicateKeyError };
