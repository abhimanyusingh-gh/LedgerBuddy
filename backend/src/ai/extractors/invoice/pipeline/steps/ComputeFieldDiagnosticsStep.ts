import type { PipelineContext, PipelineStage, StageResult } from "@/core/pipeline/index.js";
import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import type { InvoiceSlmOutput } from "../../InvoiceDocumentDefinition.js";
import { addFieldDiagnosticsToMetadata } from "../../confidenceScoring/FieldConfidenceScorer.js";
import { EXTRACTION_SOURCE } from "@/core/engine/extractionSource.js";
import { POST_ENGINE_CTX } from "../postEngineContextKeys.js";

/**
 * Stage 12: Computes per-field confidence scores and provenance via OCR block grounding.
 * Wraps `addFieldDiagnosticsToMetadata()` from FieldConfidenceScorer.
 */
export class ComputeFieldDiagnosticsStep implements PipelineStage {
  readonly name = "compute-field-diagnostics";

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const parsed = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.RECOVERED_PARSED);
    const ocrBlocks = ctx.store.require<OcrBlock[]>("invoice.ocrBlocks");
    const fieldRegions = ctx.store.get<Record<string, OcrBlock[]>>("invoice.fieldRegions") ?? {};
    const ocrConfidence = ctx.store.get<number>("invoice.ocrConfidence");
    const validationIssues = ctx.store.require<string[]>(POST_ENGINE_CTX.VALIDATION_ISSUES);
    const slm = ctx.store.require<InvoiceSlmOutput>(POST_ENGINE_CTX.SLM_OUTPUT);

    const diagnostics = addFieldDiagnosticsToMetadata({
      metadata: ctx.metadata,
      parsed,
      ocrBlocks,
      fieldRegions,
      source: EXTRACTION_SOURCE.SLM_DIRECT,
      ocrConfidence,
      validationIssues,
      warnings: ctx.issues,
      templateAppliedFields: new Set<string>(),
      verifierChangedFields: slm.changedFields,
      verifierFieldConfidence: slm.fieldConfidence,
      verifierFieldProvenance: slm.fieldProvenance,
    });

    ctx.store.set(POST_ENGINE_CTX.FIELD_CONFIDENCE, diagnostics.fieldConfidence);
    ctx.store.set(POST_ENGINE_CTX.FIELD_PROVENANCE, diagnostics.fieldProvenance);
    return {};
  }
}
