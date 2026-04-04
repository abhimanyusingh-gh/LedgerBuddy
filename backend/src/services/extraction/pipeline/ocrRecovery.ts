import type { OcrBlock } from "../../../core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "../../../types/invoice.js";
import {
  classifyOcrRecoveryStrategy,
  recoverLineItemsFromOcr,
  type OcrRecoveryStrategy
} from "./lineItemRecovery.js";
import {
  findPreferredTotalAmountBlockForStrategy,
  computeSummaryTotalMinor,
  normalizeParsedAgainstOcrText,
  recoverGstSummaryFromOcr,
  recoverPreferredTotalAmountMinor
} from "./totalsRecovery.js";
import {
  findPreferredVendorBlockForStrategy,
  recoverHeaderFieldsFromOcr
} from "./documentFieldRecovery.js";

export {
  classifyOcrRecoveryStrategy,
  findPreferredTotalAmountBlockForStrategy,
  findPreferredVendorBlockForStrategy,
  recoverParsedFromOcr
};

function recoverParsedFromOcr(parsed: ParsedInvoiceData, ocrBlocks: OcrBlock[], ocrText: string): ParsedInvoiceData {
  const strategy = classifyOcrRecoveryStrategy(ocrBlocks, ocrText);
  const next = recoverHeaderFieldsFromOcr(parsed, ocrBlocks, ocrText);
  const normalized = normalizeParsedAgainstOcrText(next, ocrText, ocrBlocks);
  const recoveredGst = recoverGstSummaryFromOcr(ocrBlocks);
  if (recoveredGst) {
    normalized.gst = {
      ...(normalized.gst ?? {}),
      ...(recoveredGst.subtotalMinor !== undefined && (normalized.gst?.subtotalMinor === undefined || normalized.gst?.subtotalMinor === 0)
        ? { subtotalMinor: recoveredGst.subtotalMinor }
        : {}),
      ...(recoveredGst.cgstMinor !== undefined && (normalized.gst?.cgstMinor === undefined || normalized.gst?.cgstMinor === 0)
        ? { cgstMinor: recoveredGst.cgstMinor }
        : {}),
      ...(recoveredGst.sgstMinor !== undefined && (normalized.gst?.sgstMinor === undefined || normalized.gst?.sgstMinor === 0)
        ? { sgstMinor: recoveredGst.sgstMinor }
        : {}),
      ...(recoveredGst.igstMinor !== undefined && (normalized.gst?.igstMinor === undefined || normalized.gst?.igstMinor === 0)
        ? { igstMinor: recoveredGst.igstMinor }
        : {}),
      ...(recoveredGst.totalTaxMinor !== undefined && (normalized.gst?.totalTaxMinor === undefined || normalized.gst?.totalTaxMinor === 0)
        ? { totalTaxMinor: recoveredGst.totalTaxMinor }
        : {})
    };
  }

  const computedSummaryTotalMinor = computeSummaryTotalMinor(normalized.gst);
  if (
    computedSummaryTotalMinor !== undefined &&
    (
      normalized.totalAmountMinor === undefined ||
      normalized.totalAmountMinor <= 0 ||
      (normalized.gst?.subtotalMinor !== undefined && normalized.totalAmountMinor <= normalized.gst.subtotalMinor)
    )
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

  const recoveredLineItems = recoverLineItemsFromOcr(normalized.lineItems, ocrBlocks, strategy, normalized.totalAmountMinor);
  if (recoveredLineItems && recoveredLineItems.length > 0) {
    normalized.lineItems = recoveredLineItems;
  }

  return normalized;
}
