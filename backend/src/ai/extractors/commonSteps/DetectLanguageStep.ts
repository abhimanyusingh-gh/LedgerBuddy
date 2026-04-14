import type { PipelineStage, StageResult } from "@/core/pipeline/PipelineStage.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { DetectedInvoiceLanguage } from "../invoice/languageDetection.js";
import { detectInvoiceLanguage, resolveDetectedLanguage } from "../invoice/languageDetection.js";
import type { RankedOcrTextCandidate } from "../stages/ocrTextCandidates.js";
import { formatConfidence } from "../stages/fieldParsingUtils.js";
import { INVOICE_CTX } from "../invoice/pipeline/contextKeys.js";

export class DetectLanguageStep implements PipelineStage {
  readonly name = "detect-language";

  async execute(ctx: PipelineContext): Promise<StageResult> {
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
