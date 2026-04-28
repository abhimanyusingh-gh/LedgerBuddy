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
import { normalizeExtractionData } from "@/services/ingestion/provenance.js";
import { ExtractionPipelineError } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";
import { PIPELINE_ERROR_CODE } from "@/core/engine/types.js";
import { logger } from "@/utils/logger.js";
import { uniqueStrings } from "@/utils/text.js";

const UPSERT_OVERWRITE_SAFE_STATUSES: readonly InvoiceStatus[] = [
  INVOICE_STATUS.PENDING,
  INVOICE_STATUS.PENDING_TRIAGE,
  INVOICE_STATUS.FAILED_OCR,
  INVOICE_STATUS.FAILED_PARSE,
];

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
    ocrBlocksCount: String(ocrBlocks.length),
    ...extraction.metadata
  };
  const extractionData = normalizeExtractionData(extraction.extraction);

  if (Object.keys(artifacts.previewImagePaths).length > 0) {
    metadata.previewPageImages = JSON.stringify(artifacts.previewImagePaths);
  }

  const finalBlocks = ocrBlocks;

  const gmailMessageId = file.sourceType === INGESTION_SOURCE_TYPE.EMAIL && file.metadata?.messageId
    ? String(file.metadata.messageId).trim()
    : undefined;

  const triage = file.clientOrgId === null;
  const effectiveStatus: InvoiceStatus = triage ? INVOICE_STATUS.PENDING_TRIAGE : status;

  return {
    tenantId: file.tenantId,
    sourceType: file.sourceType, clientOrgId: file.clientOrgId, workloadTier: file.workloadTier,
    sourceKey: file.sourceKey, sourceDocumentId: file.sourceDocumentId,
    attachmentName: file.attachmentName, mimeType,
    receivedAt: file.receivedAt,
    ...(file.sourceMailboxAssignmentId ? { sourceMailboxAssignmentId: file.sourceMailboxAssignmentId } : {}),
    ...(gmailMessageId ? { gmailMessageId } : {}),
    ocrProvider: extraction.provider, ocrText: extraction.text,
    ocrConfidence: extraction.confidence, ocrBlocks: finalBlocks,
    ocrTokens: extraction.ocrTokens, slmTokens: extraction.slmTokens,
    status: effectiveStatus, metadata,
    parsed: parsedResult.parsed,
    confidenceScore: Number.isFinite(confidence.score) ? confidence.score : 0, confidenceTone: confidence.tone,
    autoSelectForApproval: confidence.autoSelectForApproval,
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
    tenantId: file.tenantId,
    sourceType: file.sourceType, clientOrgId: file.clientOrgId, workloadTier: file.workloadTier,
    sourceKey: file.sourceKey, sourceDocumentId: file.sourceDocumentId,
    attachmentName: file.attachmentName, mimeType,
    receivedAt: file.receivedAt, metadata: file.metadata,
    ...(file.sourceMailboxAssignmentId ? { sourceMailboxAssignmentId: file.sourceMailboxAssignmentId } : {}),
    ocrProvider: ocrState.ocrProvider, ocrText: ocrState.ocrText,
    ocrConfidence: ocrState.ocrConfidence, ocrBlocks: ocrState.ocrBlocks,
    confidenceScore: 0, confidenceTone: "red" as const,
    autoSelectForApproval: false
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
  const matchBase: Record<string, unknown> = { sourceDocumentId: file.sourceDocumentId };
  if (file.clientOrgId) {
    matchBase.clientOrgId = file.clientOrgId;
  } else {
    matchBase.clientOrgId = null;
  }

  const updated = await InvoiceModel.findOneAndUpdate(
    { ...matchBase, status: INVOICE_STATUS.PENDING },
    { $set: updateData }
  );
  if (updated) return;

  const overwritten = await InvoiceModel.findOneAndUpdate(
    { ...matchBase, status: { $in: UPSERT_OVERWRITE_SAFE_STATUSES } },
    { $set: updateData }
  );
  if (overwritten) return;

  const protectedExisting = await InvoiceModel.findOne(matchBase)
    .select({ _id: 1, status: 1 })
    .lean();
  if (protectedExisting) {
    logger.warn("ingestion.upsert.skipped.protected", {
      tenantId: file.tenantId,
      sourceKey: file.sourceKey,
      sourceDocumentId: file.sourceDocumentId,
      existingStatus: protectedExisting.status,
      invoiceId: String(protectedExisting._id),
    });
    return;
  }

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
