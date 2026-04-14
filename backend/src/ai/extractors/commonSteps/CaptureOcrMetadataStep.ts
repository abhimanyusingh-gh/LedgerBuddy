import type { PipelineStage, StageResult } from "@/core/pipeline/PipelineStage.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { OcrResult } from "@/core/interfaces/OcrProvider.js";
import { INVOICE_CTX } from "../invoice/pipeline/contextKeys.js";

export class CaptureOcrMetadataStep implements PipelineStage {
  readonly name = "capture-ocr-metadata";

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const ocrResult = ctx.store.require<OcrResult>(INVOICE_CTX.OCR_RESULT);

    ctx.store.set(INVOICE_CTX.OCR_BLOCKS, ocrResult.blocks ?? []);
    ctx.store.set(INVOICE_CTX.OCR_PAGE_IMAGES, ocrResult.pageImages ?? []);
    ctx.store.set(INVOICE_CTX.OCR_TOKENS, ocrResult.tokenUsage?.totalTokens ?? 0);
    ctx.store.set(INVOICE_CTX.EXTRACT_FIELDS, ocrResult.fields);

    return {};
  }
}
