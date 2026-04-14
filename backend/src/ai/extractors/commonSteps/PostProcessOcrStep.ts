import type { PipelineStage, StageResult } from "@/core/pipeline/PipelineStage.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { OcrResult } from "@/core/interfaces/OcrProvider.js";
import { postProcessOcrResult } from "@/ai/ocr/ocrPostProcessor.js";
import { INVOICE_CTX } from "../invoice/pipeline/contextKeys.js";

export class PostProcessOcrStep implements PipelineStage {
  readonly name = "post-process-ocr";

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const ocrResult = ctx.store.require<OcrResult>(INVOICE_CTX.OCR_RESULT);
    const enhanced = postProcessOcrResult(ocrResult);
    ctx.store.set(INVOICE_CTX.ENHANCED_OCR, enhanced);
    return {};
  }
}
