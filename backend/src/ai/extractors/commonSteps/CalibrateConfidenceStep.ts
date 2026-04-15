import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { OcrResult } from "@/core/interfaces/OcrProvider.js";
import { calibrateDocumentConfidence } from "@/ai/extractors/invoice/confidenceScoring/FieldConfidenceScorer.js";
import { INVOICE_CTX } from "@/ai/extractors/invoice/pipeline/contextKeys.js";

export class CalibrateConfidenceStep implements PipelineStep {
  readonly name = "calibrate-confidence";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const ocrResult = ctx.store.require<OcrResult>(INVOICE_CTX.OCR_RESULT);
    const primaryText = ctx.store.require<string>(INVOICE_CTX.PRIMARY_TEXT);

    const rawText = ocrResult.text.trim();
    const calibrated = calibrateDocumentConfidence(ocrResult.confidence, rawText, primaryText);
    ctx.store.set(INVOICE_CTX.OCR_CONFIDENCE, calibrated.score);

    return {};
  }
}
