import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { OcrResult } from "@/core/interfaces/OcrProvider.js";
import { postProcessOcrResult } from "@/ai/ocr/ocrPostProcessor.js";
import { INVOICE_CTX } from "@/ai/extractors/invoice/pipeline/contextKeys.js";

export class PostProcessOcrStep implements PipelineStep {
  readonly name = "post-process-ocr";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const ocrResult = ctx.store.require<OcrResult>(INVOICE_CTX.OCR_RESULT);
    const enhanced = postProcessOcrResult(ocrResult);
    ctx.store.set(INVOICE_CTX.ENHANCED_OCR, enhanced);
    return {};
  }
}
