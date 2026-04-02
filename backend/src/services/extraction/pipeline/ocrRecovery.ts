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
  findPreferredVendorBlockForStrategy
};

function recoverParsedFromOcr(parsed: ParsedInvoiceData, ocrBlocks: OcrBlock[], ocrText: string): ParsedInvoiceData {
  const next = recoverHeaderFieldsFromOcr(parsed, ocrBlocks, ocrText);
  const recoveredGst = recoverGstSummaryFromOcr(ocrBlocks);
  if (recoveredGst) {
    next.gst = {
      ...(next.gst ?? {}),
      ...(recoveredGst.subtotalMinor !== undefined && (next.gst?.subtotalMinor === undefined || next.gst?.subtotalMinor === 0)
        ? { subtotalMinor: recoveredGst.subtotalMinor }
        : {}),
      ...(recoveredGst.cgstMinor !== undefined && (next.gst?.cgstMinor === undefined || next.gst?.cgstMinor === 0)
        ? { cgstMinor: recoveredGst.cgstMinor }
        : {}),
      ...(recoveredGst.sgstMinor !== undefined && (next.gst?.sgstMinor === undefined || next.gst?.sgstMinor === 0)
        ? { sgstMinor: recoveredGst.sgstMinor }
        : {}),
      ...(recoveredGst.igstMinor !== undefined && (next.gst?.igstMinor === undefined || next.gst?.igstMinor === 0)
        ? { igstMinor: recoveredGst.igstMinor }
        : {}),
      ...(recoveredGst.totalTaxMinor !== undefined && (next.gst?.totalTaxMinor === undefined || next.gst?.totalTaxMinor === 0)
        ? { totalTaxMinor: recoveredGst.totalTaxMinor }
        : {})
    };
  }

  const computedSummaryTotalMinor = computeSummaryTotalMinor(next.gst);
  if (
    computedSummaryTotalMinor !== undefined &&
    (
      next.totalAmountMinor === undefined ||
      next.totalAmountMinor <= 0 ||
      (next.gst?.subtotalMinor !== undefined && next.totalAmountMinor <= next.gst.subtotalMinor)
    )
  ) {
    next.totalAmountMinor = computedSummaryTotalMinor;
  }

  const recoveredTotalMinor = recoverPreferredTotalAmountMinor(ocrBlocks);
  const hasConsistentSummaryTotal =
    typeof next.totalAmountMinor === "number" &&
    computedSummaryTotalMinor !== undefined &&
    next.totalAmountMinor === computedSummaryTotalMinor;
  if (recoveredTotalMinor !== undefined) {
    if (
      next.totalAmountMinor === undefined ||
      next.totalAmountMinor <= 0 ||
      next.totalAmountMinor === recoveredTotalMinor ||
      (!hasConsistentSummaryTotal && recoveredTotalMinor !== undefined)
    ) {
      next.totalAmountMinor = recoveredTotalMinor;
    }
  }

  return next;
}
