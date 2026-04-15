import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { OcrResult, OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { EnhancedOcrResult } from "@/ai/ocr/ocrPostProcessor.js";
import { buildRankedOcrTextCandidates } from "@/ai/extractors/stages/ocrTextCandidates.js";
import { INVOICE_CTX } from "@/ai/extractors/invoice/pipeline/contextKeys.js";

export class BuildTextCandidatesStep implements PipelineStep {
  readonly name = "build-text-candidates";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const ocrResult = ctx.store.require<OcrResult>(INVOICE_CTX.OCR_RESULT);
    const enhanced = ctx.store.require<EnhancedOcrResult>(INVOICE_CTX.ENHANCED_OCR);
    const blocks = ctx.store.require<OcrBlock[]>(INVOICE_CTX.OCR_BLOCKS);

    const rawText = ocrResult.text.trim();
    const textCandidates = buildRankedOcrTextCandidates({
      rawText,
      blocks,
      layoutLines: enhanced.lines,
    });

    ctx.store.set(INVOICE_CTX.RANKED_CANDIDATES, textCandidates.ranked);
    ctx.store.set(INVOICE_CTX.PRIMARY_CANDIDATE, textCandidates.primary);
    ctx.store.set(INVOICE_CTX.PRIMARY_TEXT, textCandidates.primary.text);
    ctx.store.set(INVOICE_CTX.AUGMENTED_TEXT, textCandidates.augmentedText);

    ctx.metadata.ocrPrimaryVariant = textCandidates.primary.id;
    ctx.metadata.ocrPrimaryVariantScore = textCandidates.primary.score.toFixed(3);
    ctx.metadata.ocrPrimaryTokenCount = String(textCandidates.primary.metrics.tokenCount);
    ctx.metadata.ocrCandidateCount = String(textCandidates.ranked.length);
    ctx.metadata.ocrHasKeyValueGrounding = textCandidates.keyValueText.length > 0 ? "true" : "false";
    ctx.metadata.ocrHasAugmentedContext = textCandidates.augmentedText.length > 0 ? "true" : "false";
    ctx.metadata.ocrLowQualityTokenRatio = textCandidates.primary.metrics.lowQualityTokenRatio.toFixed(4);
    ctx.metadata.ocrDuplicateLineRatio = textCandidates.primary.metrics.duplicateLineRatio.toFixed(4);

    return {};
  }
}
