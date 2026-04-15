import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { DetectedInvoiceLanguage } from "@/ai/extractors/invoice/languageDetection.js";
import { detectInvoiceLanguage, resolveDetectedLanguage } from "@/ai/extractors/invoice/languageDetection.js";
import type { RankedOcrTextCandidate } from "@/ai/extractors/stages/ocrTextCandidates.js";
import { formatConfidence } from "@/ai/extractors/stages/fieldParsingUtils.js";
import { INVOICE_CTX } from "@/ai/extractors/invoice/pipeline/contextKeys.js";

export class DetectLanguageStep implements PipelineStep {
  readonly name = "detect-language";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const rankedCandidates = ctx.store.require<RankedOcrTextCandidate[]>(INVOICE_CTX.RANKED_CANDIDATES);
    const preOcrLanguage = ctx.store.require<DetectedInvoiceLanguage>(INVOICE_CTX.PRE_OCR_LANGUAGE);

    const postOcr = detectInvoiceLanguage(rankedCandidates.map((c) => c.text));
    const resolved = resolveDetectedLanguage(preOcrLanguage, postOcr);

    ctx.store.set(INVOICE_CTX.LANGUAGE_RESOLUTION, { preOcr: preOcrLanguage, postOcr, resolved });

    ctx.metadata.postOcrLanguage = postOcr.code;
    ctx.metadata.postOcrLanguageConfidence = formatConfidence(postOcr.confidence);
    ctx.metadata.documentLanguage = resolved.code;
    ctx.metadata.documentLanguageConfidence = formatConfidence(resolved.confidence);

    return {};
  }
}
