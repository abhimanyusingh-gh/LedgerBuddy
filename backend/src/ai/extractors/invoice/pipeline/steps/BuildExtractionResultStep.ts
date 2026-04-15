import type { PipelineContext, PipelineStep, StepOutput } from "@/core/pipeline/index.js";
import type { OcrBlock, OcrPageImage } from "@/core/interfaces/OcrProvider.js";
import type {
  InvoiceCompliance,
  InvoiceExtractionData,
  InvoiceFieldKey,
  InvoiceFieldProvenance,
  InvoiceLineItemProvenance,
  ParsedInvoiceData,
} from "@/types/invoice.js";
import type { ConfidenceAssessment } from "@/services/invoice/confidenceAssessment.js";
import type { InvoiceSlmOutput } from "@/ai/extractors/invoice/InvoiceDocumentDefinition.js";
import type { OcrRecoveryStrategy } from "@/ai/extractors/invoice/stages/lineItemRecovery.js";
import { EXTRACTION_SOURCE, type ExtractionSource } from "@/core/engine/extractionSource.js";
import { uniqueIssues } from "@/ai/extractors/stages/fieldParsingUtils.js";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.js";
import type { PipelineExtractionResult } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";

const OCR_RECOVERY_STRATEGY_SOURCE: Record<OcrRecoveryStrategy, ExtractionSource> = {
  generic: EXTRACTION_SOURCE.SLM_GENERIC,
  invoice_table: EXTRACTION_SOURCE.SLM_INVOICE_TABLE,
  receipt_statement: EXTRACTION_SOURCE.SLM_RECEIPT_STATEMENT,
};

/**
 * Stage 16: Assembles the final PipelineExtractionResult from all context store values.
 */
export class BuildExtractionResultStep implements PipelineStep {
  readonly name = "build-extraction-result";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const parsed = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.RECOVERED_PARSED);
    const slm = ctx.store.require<InvoiceSlmOutput>(POST_ENGINE_CTX.SLM_OUTPUT);
    const ocrBlocks = ctx.store.require<OcrBlock[]>("invoice.ocrBlocks");
    const ocrPageImages = ctx.store.get<OcrPageImage[]>("invoice.ocrPageImages") ?? [];
    const primaryText = ctx.store.require<string>("invoice.primaryText");
    const ocrConfidence = ctx.store.get<number>("invoice.ocrConfidence");
    const ocrTokens = ctx.store.get<number>("invoice.ocrTokens");
    const ocrProviderName = ctx.store.get<string>("invoice.ocrProviderName") ?? "";
    const confidenceAssessment = ctx.store.require<ConfidenceAssessment>(POST_ENGINE_CTX.CONFIDENCE_ASSESSMENT);
    const compliance = ctx.store.get<InvoiceCompliance>(POST_ENGINE_CTX.COMPLIANCE);
    const fieldConfidence = ctx.store.get<Partial<Record<InvoiceFieldKey, number>>>(POST_ENGINE_CTX.FIELD_CONFIDENCE) ?? {};
    const fieldProvenance = ctx.store.get<Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>>>(POST_ENGINE_CTX.FIELD_PROVENANCE) ?? {};
    const lineItemProvenance = ctx.store.get<InvoiceLineItemProvenance[]>(POST_ENGINE_CTX.LINE_ITEM_PROVENANCE) ?? [];
    const classification = ctx.store.get<InvoiceExtractionData["classification"]>(POST_ENGINE_CTX.CLASSIFICATION);
    const recoveryStrategy = ctx.store.get<OcrRecoveryStrategy>(POST_ENGINE_CTX.RECOVERY_STRATEGY) ?? "generic";

    const extraction: InvoiceExtractionData = {
      source: EXTRACTION_SOURCE.SLM_DIRECT,
      strategy: OCR_RECOVERY_STRATEGY_SOURCE[recoveryStrategy],
      ...(classification ? { classification } : {}),
      ...(classification?.invoiceType ? { invoiceType: classification.invoiceType } : {}),
      ...(Object.keys(fieldConfidence).length > 0 ? { fieldConfidence } : {}),
      ...(Object.keys(fieldProvenance).length > 0 ? { fieldProvenance } : {}),
      ...(lineItemProvenance.length > 0 ? { lineItemProvenance } : {}),
    };

    const result: PipelineExtractionResult = {
      provider: ocrProviderName,
      text: primaryText,
      confidence: ocrConfidence,
      source: EXTRACTION_SOURCE.SLM_DIRECT,
      strategy: extraction.strategy ?? EXTRACTION_SOURCE.SLM_DIRECT,
      parseResult: { parsed, warnings: ctx.issues },
      confidenceAssessment,
      attempts: [],
      ocrBlocks,
      ocrPageImages,
      processingIssues: uniqueIssues(ctx.issues),
      metadata: ctx.metadata,
      ocrTokens,
      slmTokens: slm.tokens,
      compliance,
      extraction,
    };

    ctx.store.set(POST_ENGINE_CTX.FINAL_RESULT, result);
    return {};
  }
}
