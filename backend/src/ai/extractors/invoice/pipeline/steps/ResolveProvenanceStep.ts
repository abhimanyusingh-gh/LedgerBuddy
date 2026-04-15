import type { PipelineContext, PipelineStep, StepOutput } from "@/core/pipeline/index.js";
import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { InvoiceCompliance, InvoiceFieldKey, InvoiceFieldProvenance, ParsedInvoiceData } from "@/types/invoice.js";
import type { InvoiceSlmOutput } from "@/ai/extractors/invoice/InvoiceDocumentDefinition.js";
import {
  collectLineItemConfidence,
  mergeClassification,
  resolveLineItemProvenance,
} from "@/ai/extractors/invoice/stages/provenance.js";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.js";

/**
 * Stage 15: Resolves line-item provenance via OCR block matching, collects
 * line-item confidence, and merges classification with compliance TDS section.
 */
export class ResolveProvenanceStep implements PipelineStep {
  readonly name = "resolve-provenance";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const parsed = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.RECOVERED_PARSED);
    const ocrBlocks = ctx.store.require<OcrBlock[]>("invoice.ocrBlocks");
    const slm = ctx.store.require<InvoiceSlmOutput>(POST_ENGINE_CTX.SLM_OUTPUT);
    const fieldConfidence = ctx.store.require<Partial<Record<InvoiceFieldKey, number>>>(POST_ENGINE_CTX.FIELD_CONFIDENCE);
    const compliance = ctx.store.get<InvoiceCompliance>(POST_ENGINE_CTX.COMPLIANCE);

    const lineItemProvenance = resolveLineItemProvenance({
      lineItems: parsed.lineItems,
      ocrBlocks,
      verifierLineItemProvenance: slm.lineItemProvenance,
    });

    const lineItemConfidence = collectLineItemConfidence(lineItemProvenance);
    const combinedFieldConfidence =
      Object.keys(lineItemConfidence).length > 0
        ? { ...fieldConfidence, ...lineItemConfidence }
        : fieldConfidence;

    const classification = mergeClassification(slm.classification, compliance?.tds?.section);

    ctx.store.set(POST_ENGINE_CTX.LINE_ITEM_PROVENANCE, lineItemProvenance);
    ctx.store.set(POST_ENGINE_CTX.FIELD_CONFIDENCE, combinedFieldConfidence);
    ctx.store.set(POST_ENGINE_CTX.CLASSIFICATION, classification);
    return {};
  }
}
