import type { PipelineContext, PipelineStep, StepOutput } from "@/core/pipeline/index.js";
import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import { recoverHeaderFieldsFromOcr } from "@/ai/extractors/invoice/stages/documentFieldRecovery.js";
import {
  computeSummaryTotalMinor,
  normalizeParsedAgainstOcrText,
  recoverGstSummaryFromOcr,
  recoverPreferredTotalAmountMinor,
} from "@/ai/extractors/invoice/stages/totalsRecovery.js";
import {
  classifyOcrRecoveryStrategy,
  recoverLineItemsFromOcr,
  type OcrRecoveryStrategy,
} from "@/ai/extractors/invoice/stages/lineItemRecovery.js";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.js";
import { EXTRACTION_SOURCE, type ExtractionSource } from "@/core/engine/extractionSource.js";

const OCR_RECOVERY_STRATEGY_SOURCE: Record<OcrRecoveryStrategy, ExtractionSource> = {
  generic: EXTRACTION_SOURCE.SLM_GENERIC,
  invoice_table: EXTRACTION_SOURCE.SLM_INVOICE_TABLE,
  receipt_statement: EXTRACTION_SOURCE.SLM_RECEIPT_STATEMENT,
};

export class RecoverOcrFieldsStep implements PipelineStep {
  readonly name = "recover-ocr-fields";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const merged = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.MERGED_PARSED);
    const ocrBlocks = ctx.store.require<OcrBlock[]>("invoice.ocrBlocks");
    const primaryText = ctx.store.require<string>("invoice.primaryText");

    const strategy = classifyOcrRecoveryStrategy(ocrBlocks, primaryText);
    ctx.store.set(POST_ENGINE_CTX.RECOVERY_STRATEGY, strategy);
    ctx.metadata.ocrRecoveryStrategy = strategy;

    const extractionStrategy = ctx.store.get<ExtractionSource>(POST_ENGINE_CTX.ENGINE_STRATEGY);
    const isLlamaExtract = extractionStrategy === EXTRACTION_SOURCE.LLAMA_EXTRACT;
    const resolvedStrategy = isLlamaExtract ? EXTRACTION_SOURCE.LLAMA_EXTRACT : OCR_RECOVERY_STRATEGY_SOURCE[strategy];
    ctx.store.set(POST_ENGINE_CTX.RESOLVED_STRATEGY, resolvedStrategy);

    const recovered = recoverOcrFields(merged, ocrBlocks, primaryText, strategy);
    ctx.store.set(POST_ENGINE_CTX.RECOVERED_PARSED, recovered);
    return {};
  }
}

function recoverOcrFields(
  parsed: ParsedInvoiceData,
  ocrBlocks: OcrBlock[],
  ocrText: string,
  strategy: OcrRecoveryStrategy,
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
    normalized.lineItems, ocrBlocks, strategy, normalized.totalAmountMinor,
  );
  if (recoveredLineItems && recoveredLineItems.length > 0) {
    normalized.lineItems = recoveredLineItems;
  }

  return normalized;
}
