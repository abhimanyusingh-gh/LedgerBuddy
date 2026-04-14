import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import { currencyBySymbol, parseAmountTokenWithOcrRepair } from "@/ai/parsers/invoiceParser.js";
import { normalizeInvoiceNumberValue, normalizeVendorText } from "./documentFieldRecovery.js";

export function normalizeParsedAgainstOcrText(
  parsed: ParsedInvoiceData,
  ocrText: string,
  ocrBlocks: OcrBlock[] = []
): ParsedInvoiceData {
  type LineItem = NonNullable<ParsedInvoiceData["lineItems"]>[number];
  const next: ParsedInvoiceData = {
    ...parsed,
    ...(parsed.gst ? { gst: { ...parsed.gst } } : {}),
    ...(parsed.lineItems ? { lineItems: parsed.lineItems.map((entry: LineItem) => ({ ...entry })) } : {})
  };

  if (next.invoiceNumber) {
    next.invoiceNumber = normalizeInvoiceNumberValue(next.invoiceNumber);
  }
  if (next.vendorName) {
    next.vendorName = normalizeVendorText(next.vendorName);
  }

  const totalCandidates = extractTotalMinorCandidates(ocrText);
  const originalTotal = next.totalAmountMinor;
  const originalComputedSummaryTotal = computeSummaryTotalMinor(next.gst);
  const hasConsistentOriginalSummary =
    typeof originalTotal === "number" &&
    typeof originalComputedSummaryTotal === "number" &&
    originalTotal === originalComputedSummaryTotal;
  if (
    typeof originalTotal === "number" &&
    Number.isInteger(originalTotal) &&
    totalCandidates.length > 0 &&
    !hasConsistentOriginalSummary
  ) {
    const correctedTotal = chooseBestTotalMinorCandidate(originalTotal, totalCandidates);
    if (correctedTotal !== originalTotal) {
      next.totalAmountMinor = correctedTotal;
      if (originalTotal > 0 && isScaleReasonable(correctedTotal, originalTotal)) {
        const ratio = correctedTotal / originalTotal;
        scaleMonetaryFields(next, ratio);
      }
    }
  } else if ((typeof originalTotal !== "number" || originalTotal <= 0) && totalCandidates.length > 0) {
    next.totalAmountMinor = totalCandidates[0];
  }

  const explicitCurrency = detectExplicitCurrency(ocrText, ocrBlocks);
  if (explicitCurrency) {
    next.currency = explicitCurrency;
  } else if (/₹/.test(ocrText) && !next.currency) {
    next.currency = "INR";
  }

  return next;
}

function detectExplicitCurrency(text: string, ocrBlocks: OcrBlock[] = []): string | undefined {
  const hasIndiaTaxContext = /\b(place of supply|gstin|cgst|sgst|igst|gst|tax invoice)\b/i.test(text) ||
    /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/i.test(text) ||
    ocrBlocks.some((block) => /\b(gstin|cgst|sgst|igst|gst|place of supply)\b/i.test(block.text));
  const hasUsdContext = /\bUSD\b/i.test(text) || ocrBlocks.some((block) => /\bUSD\b/i.test(block.text));
  if (hasUsdContext) {
    return "USD";
  }
  if (/\$/.test(text) && !hasIndiaTaxContext) {
    return "USD";
  }
  if (/\bINR\b/i.test(text) || /₹/.test(text)) {
    return "INR";
  }
  if (hasIndiaTaxContext) {
    return "INR";
  }
  if (ocrBlocks.some((block) => /\$/.test(block.text) && !hasIndiaTaxContext)) {
    return "USD";
  }
  const symbolMatch = text.match(/([$€£₹])/);
  if (symbolMatch) {
    return currencyBySymbol[symbolMatch[1]];
  }
  return undefined;
}

export function recoverGstSummaryFromOcr(
  ocrBlocks: OcrBlock[]
): { subtotalMinor?: number; cgstMinor?: number; sgstMinor?: number; igstMinor?: number; totalTaxMinor?: number } | undefined {
  const subtotalMinor = findSummaryAmountByLabel(ocrBlocks, /^(sub\s*total|subtotal|total excluding tax|taxable amount|taxable value)$/i);
  const cgstMinor = findSummaryAmountByLabel(ocrBlocks, /\bcgst(?:\d+)?\b/i, "last");
  const sgstMinor = findSummaryAmountByLabel(ocrBlocks, /\bsgst(?:\d+)?\b/i, "last");
  const igstMinor = findSummaryAmountByLabel(ocrBlocks, /\bigst(?:\d+)?\b/i, "last");
  const taxLineMinor = findSummaryAmountByLabel(ocrBlocks, /^(tax\b|gst\b|gst\s*-|tax \()/i, "last");
  const totalTaxMinor =
    sumDefined(cgstMinor, sgstMinor, igstMinor) ??
    taxLineMinor;
  if (subtotalMinor === undefined && totalTaxMinor === undefined && cgstMinor === undefined && sgstMinor === undefined && igstMinor === undefined) {
    return undefined;
  }
  return {
    ...(subtotalMinor !== undefined ? { subtotalMinor } : {}),
    ...(cgstMinor !== undefined ? { cgstMinor } : {}),
    ...(sgstMinor !== undefined ? { sgstMinor } : {}),
    ...(igstMinor !== undefined ? { igstMinor } : {}),
    ...(totalTaxMinor !== undefined ? { totalTaxMinor } : {})
  };
}

export function findPreferredTotalAmountBlockForStrategy(
  ocrBlocks: OcrBlock[],
  strategy: "generic" | "invoice_table" | "receipt_statement",
  totalAmountMinor?: number
): { block: OcrBlock; index: number } | undefined {
  if (strategy === "receipt_statement") {
    return (
      findBottomMostMatchingAmountBlock(totalAmountMinor, ocrBlocks) ??
      findBestMatchingAmountBlock(totalAmountMinor, ocrBlocks, [
        /\b(grand total|invoice total|amount due|balance due|total due|amount payable|total)\b/i,
        /\b(taxable amount|taxable value)\b/i
      ]) ??
      findAmountBlockByLabel(ocrBlocks, /^total$/i) ??
      findAmountBlockByLabel(ocrBlocks, /taxable amount/i, "last")
    );
  }
  return (
    findMatchingAmountBlockForLabels(totalAmountMinor, ocrBlocks, [/^grand total$/i, /^total$/i, /^amount due$/i, /^balance due$/i]) ??
    findSummaryTotalAmountBlock(totalAmountMinor, ocrBlocks) ??
    findBestMatchingAmountBlock(totalAmountMinor, ocrBlocks, [
      /\b(grand total|invoice total|amount payable|total)\b/i,
      /\b(subtotal)\b/i
    ]) ??
    findLastPlainNumericMatchingAmountBlock(totalAmountMinor, ocrBlocks) ??
    findAmountBlockByLabel(ocrBlocks, /^total$/i) ??
    findAmountBlockByLabel(ocrBlocks, /^(subtotal|amount due)$/i)
  );
}

export function recoverPreferredTotalAmountMinor(ocrBlocks: OcrBlock[]): number | undefined {
  for (const pattern of [/^grand total$/i, /^total$/i, /^amount due$/i, /^balance due$/i]) {
    const amount = findSummaryAmountByLabel(ocrBlocks, pattern);
    if (amount !== undefined) {
      return amount;
    }
  }
  const subtotalMinor = findSummaryAmountByLabel(ocrBlocks, /^(sub\s*total|subtotal|taxable amount|taxable value)$/i);
  const cgstMinor = findSummaryAmountByLabel(ocrBlocks, /\bcgst(?:\d+)?\b/i, "last");
  const sgstMinor = findSummaryAmountByLabel(ocrBlocks, /\bsgst(?:\d+)?\b/i, "last");
  const igstMinor = findSummaryAmountByLabel(ocrBlocks, /\bigst(?:\d+)?\b/i, "last");
  const computed = computeSummaryTotalMinor({
    ...(subtotalMinor !== undefined ? { subtotalMinor } : {}),
    ...(cgstMinor !== undefined ? { cgstMinor } : {}),
    ...(sgstMinor !== undefined ? { sgstMinor } : {}),
    ...(igstMinor !== undefined ? { igstMinor } : {})
  });
  if (computed !== undefined) {
    return computed;
  }
  return undefined;
}

export function computeSummaryTotalMinor(
  gst: Pick<NonNullable<ParsedInvoiceData["gst"]>, "subtotalMinor" | "cgstMinor" | "sgstMinor" | "igstMinor" | "totalTaxMinor"> | undefined
): number | undefined {
  if (!gst || typeof gst.subtotalMinor !== "number" || gst.subtotalMinor <= 0) {
    return undefined;
  }
  const taxMinor = typeof gst.totalTaxMinor === "number" && gst.totalTaxMinor > 0
    ? gst.totalTaxMinor
    : sumDefined(gst.cgstMinor, gst.sgstMinor, gst.igstMinor);
  if (typeof taxMinor !== "number" || taxMinor <= 0) {
    return undefined;
  }
  return gst.subtotalMinor + taxMinor;
}

function findBestMatchingAmountBlock(
  totalAmountMinor: number | undefined,
  ocrBlocks: OcrBlock[],
  preferredLabelPatterns: RegExp[]
): { block: OcrBlock; index: number } | undefined {
  if (typeof totalAmountMinor !== "number" || totalAmountMinor <= 0) {
    return undefined;
  }

  const matches = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry) => entry.box)
    .filter((entry) => {
      const amount = parseAmountTokenWithOcrRepair(entry.block.text);
      return amount !== null && Math.round(amount * 100) === totalAmountMinor;
    });
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return { block: matches[0].block, index: matches[0].index };
  }

  let best = matches[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const match of matches) {
    const labelText = findNearestSameRowLabelText(match, ocrBlocks);
    const box = match.box!;
    let score = box[1] * 8;
    if (labelText) {
      if (/\b(grand total|invoice total|total amount|total)\b/i.test(labelText)) {
        score += 12;
      } else if (/\b(amount due|balance due|total due|amount payable)\b/i.test(labelText)) {
        score += 9;
      } else if (preferredLabelPatterns[0]?.test(labelText)) {
        score += 8;
      } else if (preferredLabelPatterns[1]?.test(labelText)) {
        score += 8;
      } else if (/\b(tax|vat|gst|credit|discount)\b/i.test(labelText)) {
        score -= 6;
      }
    }
    if (/[A-Za-z]{3}/.test(match.block.text)) {
      score -= 4;
    }
    if (score > bestScore) {
      best = match;
      bestScore = score;
    }
  }

  return { block: best.block, index: best.index };
}

function findBottomMostMatchingAmountBlock(
  totalAmountMinor: number | undefined,
  ocrBlocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  if (typeof totalAmountMinor !== "number" || totalAmountMinor <= 0) {
    return undefined;
  }

  const matches = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry) => entry.box)
    .filter((entry) => {
      const amount = parseAmountTokenWithOcrRepair(entry.block.text);
      return amount !== null && Math.round(amount * 100) === totalAmountMinor;
    })
    .sort((left, right) => {
      const leftBox = left.box ?? [0, 0, 0, 0];
      const rightBox = right.box ?? [0, 0, 0, 0];
      return rightBox[1] - leftBox[1];
    });
  if (matches.length === 0) {
    return undefined;
  }

  return { block: matches[0].block, index: matches[0].index };
}

function findLastPlainNumericMatchingAmountBlock(
  totalAmountMinor: number | undefined,
  ocrBlocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  if (typeof totalAmountMinor !== "number" || totalAmountMinor <= 0) {
    return undefined;
  }
  const matches = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry) => entry.box)
    .filter((entry) => {
      const amount = parseAmountTokenWithOcrRepair(entry.block.text);
      return amount !== null && Math.round(amount * 100) === totalAmountMinor;
    })
    .filter((entry) => !/[A-Za-z]{3}/.test(entry.block.text))
    .sort((left, right) => {
      const leftBox = left.box ?? [0, 0, 0, 0];
      const rightBox = right.box ?? [0, 0, 0, 0];
      return leftBox[1] - rightBox[1];
    });
  if (matches.length < 2) {
    return undefined;
  }

  const hasNegativeAdjustment = ocrBlocks.some((block) => {
    const amount = parseAmountTokenWithOcrRepair(block.text);
    return amount !== null && amount < 0;
  });
  if (!hasNegativeAdjustment) {
    return undefined;
  }
  const last = matches[matches.length - 1];
  return { block: last.block, index: last.index };
}

function findNearestSameRowLabelText(
  amountEntry: { block: OcrBlock; index: number; box: [number, number, number, number] | undefined },
  ocrBlocks: OcrBlock[]
): string | undefined {
  const amountBox = amountEntry.box;
  if (!amountBox) {
    return undefined;
  }

  return ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry) => entry.box)
    .filter((entry) => entry.index !== amountEntry.index)
    .filter((entry) => entry.box![2] <= amountBox[0] + 0.01)
    .filter((entry) => Math.abs(((entry.box![1] + entry.box![3]) / 2) - ((amountBox[1] + amountBox[3]) / 2)) <= 0.016)
    .sort((left, right) => right.box![2] - left.box![2])[0]
    ?.block.text.trim();
}

function findAmountBlockByLabel(
  ocrBlocks: OcrBlock[],
  labelPattern: RegExp,
  preference: "first" | "last" = "first"
): { block: OcrBlock; index: number } | undefined {
  const labelEntries = ocrBlocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => labelPattern.test(entry.block.text.trim()))
    .filter((entry) => Boolean(entry.block.bboxNormalized))
    .sort((left, right) => {
      const leftBox = left.block.bboxNormalized ?? [0, 0, 0, 0];
      const rightBox = right.block.bboxNormalized ?? [0, 0, 0, 0];
      return leftBox[1] - rightBox[1];
    });
  if (labelEntries.length === 0) {
    return undefined;
  }

  const amountMatches = labelEntries
    .map((labelEntry) => {
      const labelBox = labelEntry.block.bboxNormalized;
      if (!labelBox) {
        return undefined;
      }
      const amountEntries = ocrBlocks
        .map((block, index) => ({ block, index }))
        .filter((entry) => {
          if (entry.index === labelEntry.index) {
            return false;
          }
          const box = entry.block.bboxNormalized;
          if (!box) {
            return false;
          }
          const sameRow = Math.abs(((box[1] + box[3]) / 2) - ((labelBox[1] + labelBox[3]) / 2)) <= 0.014;
          return sameRow && box[0] > labelBox[2] && parseAmountTokenWithOcrRepair(entry.block.text) !== null;
        })
        .sort((left, right) => {
          const leftBox = left.block.bboxNormalized ?? [0, 0, 0, 0];
          const rightBox = right.block.bboxNormalized ?? [0, 0, 0, 0];
          return leftBox[0] - rightBox[0];
        });
      if (amountEntries.length === 0) {
        return undefined;
      }
      const chosen = amountEntries[amountEntries.length - 1];
      return {
        labelEntry,
        amountEntry: chosen
      };
    })
    .filter((entry): entry is { labelEntry: { block: OcrBlock; index: number }; amountEntry: { block: OcrBlock; index: number } } => Boolean(entry));
  if (amountMatches.length === 0) {
    return undefined;
  }

  const ordered = amountMatches.sort((left, right) => {
    const leftBox = left.labelEntry.block.bboxNormalized ?? [0, 0, 0, 0];
    const rightBox = right.labelEntry.block.bboxNormalized ?? [0, 0, 0, 0];
    return leftBox[1] - rightBox[1];
  });
  const selected = preference === "last" ? ordered[ordered.length - 1] : ordered[0];
  return selected.amountEntry;
}

export function findSummaryAmountByLabel(
  ocrBlocks: OcrBlock[],
  labelPattern: RegExp,
  preference: "first" | "last" = "first"
): number | undefined {
  const amountEntry = findAmountBlockByLabel(ocrBlocks, labelPattern, preference);
  if (!amountEntry) {
    return undefined;
  }

      const amount = parseAmountTokenWithOcrRepair(amountEntry.block.text);
  return amount === null ? undefined : Math.round(amount * 100);
}

function findSummaryTotalAmountBlock(
  totalAmountMinor: number | undefined,
  ocrBlocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  if (typeof totalAmountMinor !== "number" || totalAmountMinor <= 0) {
    return undefined;
  }
  const summaryLabels = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry): entry is { block: OcrBlock; index: number; box: [number, number, number, number] } => Boolean(entry.box))
    .filter((entry) => /^(sub\s*total|subtotal|total excluding tax|tax|igst|cgst|sgst|total|grand total|amount due|balance due)$/i.test(entry.block.text.trim()));
  const matchingEntries: Array<{ block: OcrBlock; index: number; labelText: string }> = [];
  for (const label of summaryLabels) {
    const amountEntry = findAmountBlockByLabel(ocrBlocks, new RegExp(`^${escapeRegex(label.block.text.trim())}$`, "i"));
    const amount = amountEntry ? parseAmountTokenWithOcrRepair(amountEntry.block.text) : null;
    if (amountEntry && amount !== null && Math.round(amount * 100) === totalAmountMinor) {
      matchingEntries.push({
        block: amountEntry.block,
        index: amountEntry.index,
        labelText: label.block.text.trim()
      });
    }
  }
  if (matchingEntries.length === 0) {
    return undefined;
  }

  const summaryTop = Math.min(...summaryLabels.map((entry) => entry.box[1]));
  const hasNegativeAdjustment = ocrBlocks.some((block) => {
    const box = block.bboxNormalized;
    if (!box || box[1] < summaryTop - 0.05) {
      return false;
    }
    const amount = parseAmountTokenWithOcrRepair(block.text);
    return amount !== null && amount < 0;
  });
  if (hasNegativeAdjustment) {
    const last = matchingEntries[matchingEntries.length - 1];
    return { block: last.block, index: last.index };
  }

  const exactTotalMatch = matchingEntries.find((entry) => /^total$/i.test(entry.labelText));
  if (exactTotalMatch) {
    return { block: exactTotalMatch.block, index: exactTotalMatch.index };
  }

  const amountDueMatch = matchingEntries.find((entry) => /^(amount due|balance due|grand total)$/i.test(entry.labelText));
  if (amountDueMatch) {
    return { block: amountDueMatch.block, index: amountDueMatch.index };
  }

  const first = matchingEntries[0];
  return { block: first.block, index: first.index };
}

function findMatchingAmountBlockForLabels(
  totalAmountMinor: number | undefined,
  ocrBlocks: OcrBlock[],
  labelPatterns: RegExp[]
): { block: OcrBlock; index: number } | undefined {
  if (typeof totalAmountMinor !== "number" || totalAmountMinor <= 0) {
    return undefined;
  }
  for (const pattern of labelPatterns) {
    const amountEntry = findAmountBlockByLabel(ocrBlocks, pattern);
    const amount = amountEntry ? parseAmountTokenWithOcrRepair(amountEntry.block.text) : null;
    if (amountEntry && amount !== null && Math.round(amount * 100) === totalAmountMinor) {
      return amountEntry;
    }
  }
  return undefined;
}

function sumDefined(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === "number");
  if (present.length === 0) {
    return undefined;
  }
  return present.reduce((sum, value) => sum + value, 0);
}

function extractTotalMinorCandidates(text: string): number[] {
  const sanitizedText = text.replace(/[*`_]/g, " ");
  const matches = sanitizedText.matchAll(
    /(?:grand\s*total|invoice\s*total|invoice\s*amount|invoice\s*value|total\s*amount|net\s*payable|net\s*amount\s*payable|amount\s*due|balance\s*(?:due|as\s*of)?|total\s*due|amount\s*payable|total)\s*[:\-]?\s*(?:INR|USD|EUR|GBP|₹|\$|€|£|¥)?\s*([-+]?(?:\d{1,3}(?:[,\s.]\d{2,3})+|\d+)(?:[.,]\d{1,2})?)/gi
  );
  const values = [...matches]
    .map((match) => match[1])
    .map((value) => parseAmountTokenWithOcrRepair(value))
    .filter((value): value is number => value !== null && value > 0)
    .map((value) => Math.round(value * 100));
  const tableMatches = sanitizedText.matchAll(
    /^\|?\s*(?:grand\s*total|invoice\s*total|invoice\s*amount|invoice\s*value|total\s*amount|net\s*payable|amount\s*due|balance\s*(?:due|as\s*of)?|total\s*due|amount\s*payable|total)\s*(?:\([^)]*\))?\s*\|\s*([-+]?(?:\d{1,3}(?:[,\s.]\d{2,3})+|\d+)(?:[.,]\d{1,2})?)\s*\|?$/gim
  );
  const tableValues = [...tableMatches]
    .map((match) => match[1])
    .map((value) => parseAmountTokenWithOcrRepair(value))
    .filter((value): value is number => value !== null && value > 0)
    .map((value) => Math.round(value * 100));
  return uniqueIntegers([...values, ...tableValues]);
}

function chooseBestTotalMinorCandidate(current: number, candidates: number[]): number {
  if (candidates.includes(current)) {
    return current;
  }

  const scaledMatch = candidates.find((candidate) => {
    if (candidate <= 0) {
      return false;
    }
    const ratio = candidate / current;
    return isScaleMatch(ratio, 0.1) || isScaleMatch(ratio, 0.01) || isScaleMatch(ratio, 1) || isScaleMatch(ratio, 10) || isScaleMatch(ratio, 100);
  });
  if (scaledMatch !== undefined) {
    return scaledMatch;
  }

  const plausible = candidates.filter((candidate) => isMagnitudeCompatible(current, candidate));
  if (unlikelySmallDiff(current, plausible)) {
    return current;
  }
  if (plausible.length === 0) {
    return current;
  }

  let closest = plausible[0] ?? current;
  let closestDelta = Math.abs(closest - current);
  for (const candidate of plausible) {
    const delta = Math.abs(candidate - current);
    if (delta < closestDelta) {
      closestDelta = delta;
      closest = candidate;
    }
  }
  const maxDelta = Math.max(10000, Math.round(current * 0.4));
  if (closestDelta > maxDelta) {
    return current;
  }
  return closest;
}

function isScaleMatch(candidateToCurrentRatio: number, targetScale: number): boolean {
  if (!Number.isFinite(candidateToCurrentRatio) || candidateToCurrentRatio <= 0) {
    return false;
  }
  return Math.abs(candidateToCurrentRatio - targetScale) <= 0.02 * targetScale;
}

function isMagnitudeCompatible(current: number, candidate: number): boolean {
  if (!Number.isFinite(current) || current <= 0 || candidate <= 0) {
    return false;
  }
  const ratio = Math.max(current, candidate) / Math.min(current, candidate);
  return ratio <= 20;
}

function isScaleReasonable(corrected: number, original: number): boolean {
  if (original <= 0) {
    return false;
  }
  return isMagnitudeCompatible(original, corrected) && Math.abs(corrected - original) / original <= 0.7;
}

function unlikelySmallDiff(current: number, candidates: number[]): boolean {
  if (candidates.length === 0) {
    return true;
  }
  const minCandidate = Math.min(...candidates);
  const maxCandidate = Math.max(...candidates);
  if (current <= 0) {
    return true;
  }
  return (maxCandidate - minCandidate) / Math.max(1, current) > 2;
}

function scaleMonetaryFields(parsed: ParsedInvoiceData, ratio: number): void {
  if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(ratio - 1) < 1e-6) {
    return;
  }

  const scaleInt = (value: number | undefined): number | undefined => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return value;
    }
    return Math.round(value * ratio);
  };

  if (parsed.gst) {
    parsed.gst.subtotalMinor = scaleInt(parsed.gst.subtotalMinor);
    parsed.gst.cgstMinor = scaleInt(parsed.gst.cgstMinor);
    parsed.gst.sgstMinor = scaleInt(parsed.gst.sgstMinor);
    parsed.gst.igstMinor = scaleInt(parsed.gst.igstMinor);
    parsed.gst.cessMinor = scaleInt(parsed.gst.cessMinor);
    parsed.gst.totalTaxMinor = scaleInt(parsed.gst.totalTaxMinor);
  }

  if (parsed.lineItems) {
    parsed.lineItems = parsed.lineItems.map((item: NonNullable<ParsedInvoiceData["lineItems"]>[number]) => ({
      ...item,
      amountMinor: Math.round(item.amountMinor * ratio),
      ...(item.cgstMinor !== undefined ? { cgstMinor: Math.round(item.cgstMinor * ratio) } : {}),
      ...(item.sgstMinor !== undefined ? { sgstMinor: Math.round(item.sgstMinor * ratio) } : {}),
      ...(item.igstMinor !== undefined ? { igstMinor: Math.round(item.igstMinor * ratio) } : {})
    }));
  }
}

function uniqueIntegers(values: number[]): number[] {
  const seen = new Set<number>();
  const output: number[] = [];
  for (const value of values) {
    if (!Number.isInteger(value)) {
      continue;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
