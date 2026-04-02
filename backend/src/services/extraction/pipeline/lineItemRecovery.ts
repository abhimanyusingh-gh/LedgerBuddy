import type { OcrBlock } from "../../../core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "../../../types/invoice.js";
import { parseAmountToken } from "../../../parser/invoiceParser.js";
import { extractAmountValueNearColumn, extractNumericValueNearColumn, findBlockIndexByExactText } from "./grounding.js";
import { findSummaryAmountByLabel } from "./totalsRecovery.js";

export type OcrRecoveryStrategy = "generic" | "invoice_table" | "receipt_statement";
type BoxedBlock = { block: OcrBlock; index: number; box: [number, number, number, number] };

export function classifyOcrRecoveryStrategy(ocrBlocks: OcrBlock[], ocrText: string): OcrRecoveryStrategy {
  const hasBillingStatement = findBlockIndexByExactText(ocrBlocks, /billing statement/i) >= 0;
  const hasIssuedBy = findBlockIndexByExactText(ocrBlocks, /^issued by$/i) >= 0;
  const hasTaxableAmount = findBlockIndexByExactText(ocrBlocks, /taxable amount/i) >= 0;
  if (hasBillingStatement || (hasIssuedBy && hasTaxableAmount)) {
    return "receipt_statement";
  }

  const hasDescription = findBlockIndexByExactText(ocrBlocks, /description/i) >= 0;
  const hasAmountHeader = findBlockIndexByExactText(ocrBlocks, /^amount$/i) >= 0;
  if (hasDescription && hasAmountHeader) {
    return "invoice_table";
  }

  if (/billing statement/i.test(ocrText)) {
    return "receipt_statement";
  }

  return "generic";
}

export function recoverLineItemsFromOcr(
  existing: ParsedInvoiceData["lineItems"] | undefined,
  ocrBlocks: OcrBlock[],
  strategy: OcrRecoveryStrategy,
  fallbackTotalAmountMinor?: number
): ParsedInvoiceData["lineItems"] | undefined {
  const normalizedExisting = normalizeLineItemsAgainstTotal(existing, fallbackTotalAmountMinor);
  if (strategy === "receipt_statement") {
    const recoveredReceiptItems = recoverReceiptLineItemsFromOcr(normalizedExisting, ocrBlocks, fallbackTotalAmountMinor);
    if (Array.isArray(recoveredReceiptItems) && recoveredReceiptItems.length > 0) {
      return recoveredReceiptItems;
    }
  }

  const descriptionHeaderIndex = findBlockIndexByExactText(ocrBlocks, /description/i);
  const amountHeaderIndex =
    findBlockIndexByExactText(ocrBlocks, /^amount$/i) >= 0
      ? findBlockIndexByExactText(ocrBlocks, /^amount$/i)
      : findBlockIndexByExactText(ocrBlocks, /\bamount\b/i);
  if (descriptionHeaderIndex < 0 || amountHeaderIndex < 0) {
    return normalizedExisting ?? recoverReceiptLineItemsFromOcr(normalizedExisting, ocrBlocks, fallbackTotalAmountMinor);
  }

  const descriptionHeader = ocrBlocks[descriptionHeaderIndex];
  const amountHeader = ocrBlocks[amountHeaderIndex];
  const descriptionHeaderBox = descriptionHeader.bboxNormalized;
  const amountHeaderBox = amountHeader.bboxNormalized;
  if (!descriptionHeaderBox || !amountHeaderBox) {
    return existing;
  }

  const totalBoundaryIndex = findBlockIndexByExactText(
    ocrBlocks,
    /^(sub\s*total|subtotal|total|amount due|balance due|grand total|total in words)$/i
  );
  const topBoundary = descriptionHeaderBox[3];
  const bottomBoundary = totalBoundaryIndex >= 0 ? (ocrBlocks[totalBoundaryIndex].bboxNormalized?.[1] ?? 1) : 1;
  const rowBlocks: BoxedBlock[] = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry): entry is BoxedBlock => Boolean(entry.box))
    .filter((entry) => entry.box![1] >= topBoundary && entry.box![3] <= bottomBoundary + 0.002);

  const descriptionBlocks = rowBlocks
    .filter((entry) => entry.box![0] <= 0.35)
    .filter((entry) => !/^(description|qty|unit\s*price|amount)$/i.test(entry.block.text.trim()))
    .sort((left, right) => left.box![1] - right.box![1]);
  const amountBlocks = rowBlocks
    .filter((entry) => entry.box![0] >= amountHeaderBox[0] - 0.03)
    .filter((entry) => parseAmountToken(entry.block.text) !== null)
    .sort((left, right) => left.box![1] - right.box![1]);
  if (descriptionBlocks.length === 0 || amountBlocks.length === 0) {
    return normalizedExisting;
  }

  const descriptionRows: BoxedBlock[][] = [];
  for (const block of descriptionBlocks) {
    const lastRow = descriptionRows[descriptionRows.length - 1];
    if (!lastRow) {
      descriptionRows.push([block]);
      continue;
    }
    const prevMid = (lastRow[lastRow.length - 1].box![1] + lastRow[lastRow.length - 1].box![3]) / 2;
    const nextMid = (block.box![1] + block.box![3]) / 2;
    if (Math.abs(nextMid - prevMid) <= 0.035) {
      lastRow.push(block);
    } else {
      descriptionRows.push([block]);
    }
  }

  const qtyHeaderIndex = findBlockIndexByExactText(ocrBlocks, /^qty$/i);
  const unitPriceHeaderIndex = findBlockIndexByExactText(ocrBlocks, /unit\s*price/i);
  let recoveredItems = recoverInvoiceTableLineItemsFromRows(
    ocrBlocks,
    descriptionRows,
    amountBlocks,
    qtyHeaderIndex,
    unitPriceHeaderIndex
  );
  if (recoveredItems.length <= 1 && amountBlocks.length >= 2) {
    recoveredItems = recoverInvoiceTableLineItemsFromAmountAnchors(
      ocrBlocks,
      amountBlocks,
      qtyHeaderIndex,
      unitPriceHeaderIndex,
      topBoundary,
      bottomBoundary
    );
  }
  recoveredItems = normalizeLineItemsAgainstTotal(recoveredItems, fallbackTotalAmountMinor) ?? [];
  if (recoveredItems.length === 0) {
    return normalizedExisting ?? recoverReceiptLineItemsFromOcr(normalizedExisting, ocrBlocks, fallbackTotalAmountMinor);
  }
  return recoveredItems;
}

function recoverInvoiceTableLineItemsFromRows(
  ocrBlocks: OcrBlock[],
  descriptionRows: Array<Array<{ block: OcrBlock; index: number; box: [number, number, number, number] | undefined }>>,
  amountBlocks: Array<{ block: OcrBlock; index: number; box: [number, number, number, number] | undefined }>,
  qtyHeaderIndex: number,
  unitPriceHeaderIndex: number
): NonNullable<ParsedInvoiceData["lineItems"]> {
  const recoveredItems: NonNullable<ParsedInvoiceData["lineItems"]> = [];
  for (const row of descriptionRows) {
    const description = row.map((entry) => entry.block.text.trim()).filter(Boolean).join(" ").trim();
    const rowTop = Math.min(...row.map((entry) => entry.box![1]));
    const rowBottom = Math.max(...row.map((entry) => entry.box![3]));
    const amountBlock = amountBlocks.find((entry) => {
      const mid = (entry.box![1] + entry.box![3]) / 2;
      return mid >= rowTop - 0.01 && mid <= rowBottom + 0.01;
    });
    const amountMajor = amountBlock ? parseAmountToken(amountBlock.block.text) : null;
    if (!description || amountMajor === null) {
      continue;
    }

    const quantity = qtyHeaderIndex >= 0 ? extractNumericValueNearColumn(ocrBlocks, qtyHeaderIndex, rowTop, rowBottom) : undefined;
    const rate = unitPriceHeaderIndex >= 0 ? extractAmountValueNearColumn(ocrBlocks, unitPriceHeaderIndex, rowTop, rowBottom) : undefined;
    recoveredItems.push({
      description,
      amountMinor: Math.round(amountMajor * 100),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(rate !== undefined ? { rate } : {})
    });
  }
  return recoveredItems;
}

function recoverInvoiceTableLineItemsFromAmountAnchors(
  ocrBlocks: OcrBlock[],
  amountBlocks: Array<{ block: OcrBlock; index: number; box: [number, number, number, number] | undefined }>,
  qtyHeaderIndex: number,
  unitPriceHeaderIndex: number,
  topBoundary: number,
  bottomBoundary: number
): NonNullable<ParsedInvoiceData["lineItems"]> {
  const blocks = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry): entry is BoxedBlock => Boolean(entry.box))
    .filter((entry) => entry.box[1] >= topBoundary && entry.box[3] <= bottomBoundary + 0.002);
  const recoveredItems: NonNullable<ParsedInvoiceData["lineItems"]> = [];
  for (let i = 0; i < amountBlocks.length; i += 1) {
    const amountBlock = amountBlocks[i];
    const currentMid = (amountBlock.box![1] + amountBlock.box![3]) / 2;
    const prevMid = i > 0 ? (amountBlocks[i - 1].box![1] + amountBlocks[i - 1].box![3]) / 2 : topBoundary;
    const nextMid = i < amountBlocks.length - 1 ? (amountBlocks[i + 1].box![1] + amountBlocks[i + 1].box![3]) / 2 : bottomBoundary;
    const rowTop = i > 0 ? (prevMid + currentMid) / 2 : currentMid - 0.02;
    const rowBottom = i < amountBlocks.length - 1 ? (currentMid + nextMid) / 2 : currentMid + 0.02;
    const description = blocks
      .filter((entry) => entry.index !== amountBlock.index)
      .filter((entry) => entry.box[0] < Math.min(amountBlock.box![0] - 0.05, 0.35))
      .filter((entry) => entry.box[1] >= rowTop - 0.006 && entry.box[3] <= rowBottom + 0.006)
      .map((entry) => entry.block.text.trim())
      .filter((text) => text.length > 0)
      .filter((text) => !/^(description|qty|unit\s*price|amount|tax|sub\s*total|subtotal|total|amount due|rate|cgst|sgst|amt|hsn|\/sac)$/i.test(text))
      .join(" ")
      .trim();
    const amountMajor = parseAmountToken(amountBlock.block.text);
    if (!description || amountMajor === null) {
      continue;
    }
    const quantity = qtyHeaderIndex >= 0 ? extractNumericValueNearColumn(ocrBlocks, qtyHeaderIndex, rowTop, rowBottom) : undefined;
    const rate = unitPriceHeaderIndex >= 0 ? extractAmountValueNearColumn(ocrBlocks, unitPriceHeaderIndex, rowTop, rowBottom) : undefined;
    recoveredItems.push({
      description,
      amountMinor: Math.round(amountMajor * 100),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(rate !== undefined ? { rate } : {})
    });
  }
  return recoveredItems;
}

function recoverReceiptLineItemsFromOcr(
  existing: ParsedInvoiceData["lineItems"] | undefined,
  ocrBlocks: OcrBlock[],
  fallbackTotalAmountMinor?: number
): ParsedInvoiceData["lineItems"] | undefined {
  const billingStatementIndex = findBlockIndexByExactText(ocrBlocks, /billing statement/i);
  if (billingStatementIndex < 0) {
    return existing;
  }

  const statementBox = ocrBlocks[billingStatementIndex]?.bboxNormalized;
  const taxableIndex = findBlockIndexByExactText(ocrBlocks, /taxable amount/i);
  const taxableBox = taxableIndex >= 0 ? ocrBlocks[taxableIndex]?.bboxNormalized : undefined;
  if (!statementBox) {
    return existing;
  }

  const descriptionBlocks = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry) => entry.box)
    .filter((entry) => entry.box![1] > statementBox[3])
    .filter((entry) => !taxableBox || entry.box![3] < taxableBox[1])
    .filter((entry) => entry.box![0] < 0.35)
    .filter((entry) => !/^(billing statement|hsn code:|taxable amount)$/i.test(entry.block.text.trim()))
    .sort((left, right) => left.box![1] - right.box![1]);
  if (descriptionBlocks.length === 0) {
    return existing;
  }

  const description = descriptionBlocks
    .map((entry) => entry.block.text.trim())
    .filter((text) => text.length > 0 && !/^hsn code:/i.test(text))
    .join(" ")
    .trim();
  if (!description) {
    return existing;
  }

  const taxableAmountMinor = taxableIndex >= 0 ? findSummaryAmountByLabel(ocrBlocks, /taxable amount/i) : undefined;
  const amountMinor = fallbackTotalAmountMinor ?? taxableAmountMinor;
  if (amountMinor === undefined) {
    return existing;
  }

  return [{ description, amountMinor }];
}

function normalizeLineItemsAgainstTotal(
  items: ParsedInvoiceData["lineItems"] | undefined,
  totalAmountMinor?: number
): ParsedInvoiceData["lineItems"] | undefined {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }
  const normalized = items.map((item) => ({ ...item }));
  if (normalized.length === 1 && typeof totalAmountMinor === "number" && totalAmountMinor > 0) {
    const ratio = normalized[0].amountMinor / totalAmountMinor;
    if (!Number.isFinite(ratio) || ratio > 2 || ratio < 0.5) {
      normalized[0].amountMinor = totalAmountMinor;
    }
  }
  if (normalized.some((item) => item.amountMinor < 0) && normalized.some((item) => item.amountMinor > 0)) {
    normalized.sort((left, right) => left.amountMinor - right.amountMinor);
  }
  return normalized;
}
