import type { PipelineContext, PipelineStage, StageResult } from "@/core/pipeline/index.js";
import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import { recoverHeaderFieldsFromOcr } from "../../stages/documentFieldRecovery.js";
import {
  computeSummaryTotalMinor,
  normalizeParsedAgainstOcrText,
  recoverGstSummaryFromOcr,
  recoverPreferredTotalAmountMinor,
} from "../../stages/totalsRecovery.js";
import {
  classifyOcrRecoveryStrategy,
  recoverLineItemsFromOcr,
} from "../../stages/lineItemRecovery.js";
import { POST_ENGINE_CTX } from "../postEngineContextKeys.js";

/**
 * Stage 10: Recovers header fields, GST summary, totals, and line items from OCR blocks.
 * Equivalent to the private `recoverOcrFields()` in InvoiceExtractionPipeline.
 */
export class RecoverOcrFieldsStep implements PipelineStage {
  readonly name = "recover-ocr-fields";

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const merged = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.MERGED_PARSED);
    const ocrBlocks = ctx.store.require<OcrBlock[]>("invoice.ocrBlocks");
    const primaryText = ctx.store.require<string>("invoice.primaryText");

    const strategy = classifyOcrRecoveryStrategy(ocrBlocks, primaryText);
    ctx.store.set(POST_ENGINE_CTX.RECOVERY_STRATEGY, strategy);
    ctx.metadata.ocrRecoveryStrategy = strategy;

    const recovered = recoverOcrFields(merged, ocrBlocks, primaryText, strategy);
    ctx.store.set(POST_ENGINE_CTX.RECOVERED_PARSED, recovered);
    return {};
  }
}

function recoverOcrFields(
  parsed: ParsedInvoiceData,
  ocrBlocks: OcrBlock[],
  ocrText: string,
  strategy: string,
): ParsedInvoiceData {
  const next = recoverHeaderFieldsFromOcr(parsed, ocrBlocks, ocrText);
  const normalized = normalizeParsedAgainstOcrText(next, ocrText, ocrBlocks);

  const recoveredGst = recoverGstSummaryFromOcr(ocrBlocks);
  if (recoveredGst) {
    normalized.gst = {
      ...(normalized.gst ?? {}),
      ...(recoveredGst.subtotalMinor !== undefined && (normalized.gst?.subtotalMinor === undefined || normalized.gst?.subtotalMinor === 0)
        ? { subtotalMinor: recoveredGst.subtotalMinor } : {}),
      ...(recoveredGst.cgstMinor !== undefined && (normalized.gst?.cgstMinor === undefined || normalized.gst?.cgstMinor === 0)
        ? { cgstMinor: recoveredGst.cgstMinor } : {}),
      ...(recoveredGst.sgstMinor !== undefined && (normalized.gst?.sgstMinor === undefined || normalized.gst?.sgstMinor === 0)
        ? { sgstMinor: recoveredGst.sgstMinor } : {}),
      ...(recoveredGst.igstMinor !== undefined && (normalized.gst?.igstMinor === undefined || normalized.gst?.igstMinor === 0)
        ? { igstMinor: recoveredGst.igstMinor } : {}),
      ...(recoveredGst.totalTaxMinor !== undefined && (normalized.gst?.totalTaxMinor === undefined || normalized.gst?.totalTaxMinor === 0)
        ? { totalTaxMinor: recoveredGst.totalTaxMinor } : {}),
    };
  }

  const computedSummaryTotalMinor = computeSummaryTotalMinor(normalized.gst);
  if (
    computedSummaryTotalMinor !== undefined &&
    (normalized.totalAmountMinor === undefined ||
      normalized.totalAmountMinor <= 0 ||
      (normalized.gst?.subtotalMinor !== undefined && normalized.totalAmountMinor <= normalized.gst.subtotalMinor))
  ) {
    normalized.totalAmountMinor = computedSummaryTotalMinor;
  }

  const recoveredTotalMinor = recoverPreferredTotalAmountMinor(ocrBlocks);
  const hasConsistentSummaryTotal =
    typeof normalized.totalAmountMinor === "number" &&
    computedSummaryTotalMinor !== undefined &&
    normalized.totalAmountMinor === computedSummaryTotalMinor;
  if (recoveredTotalMinor !== undefined) {
    if (
      normalized.totalAmountMinor === undefined ||
      normalized.totalAmountMinor <= 0 ||
      normalized.totalAmountMinor === recoveredTotalMinor ||
      (!hasConsistentSummaryTotal && recoveredTotalMinor !== undefined)
    ) {
      normalized.totalAmountMinor = recoveredTotalMinor;
    }
  }

  const recoveredLineItems = recoverLineItemsFromOcr(
    normalized.lineItems, ocrBlocks, strategy as Parameters<typeof recoverLineItemsFromOcr>[2], normalized.totalAmountMinor,
  );
  if (recoveredLineItems && recoveredLineItems.length > 0) {
    normalized.lineItems = recoveredLineItems;
  }

  return normalized;
}
