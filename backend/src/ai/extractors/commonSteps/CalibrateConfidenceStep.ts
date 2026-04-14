import type { PipelineStage, StageResult } from "@/core/pipeline/PipelineStage.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { OcrResult } from "@/core/interfaces/OcrProvider.js";
import { calibrateDocumentConfidence } from "../invoice/confidenceScoring/FieldConfidenceScorer.js";
import { INVOICE_CTX } from "../invoice/pipeline/contextKeys.js";

export class CalibrateConfidenceStep implements PipelineStage {
  readonly name = "calibrate-confidence";

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const ocrResult = ctx.store.require<OcrResult>(INVOICE_CTX.OCR_RESULT);
    const primaryText = ctx.store.require<string>(INVOICE_CTX.PRIMARY_TEXT);

    const rawText = ocrResult.text.trim();
    const calibrated = calibrateDocumentConfidence(ocrResult.confidence, rawText, primaryText);
    ctx.store.set(INVOICE_CTX.OCR_CONFIDENCE, calibrated.score);

    return {};
  }
}
