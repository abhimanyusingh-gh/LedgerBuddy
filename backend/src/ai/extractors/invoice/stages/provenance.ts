import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import { PROVENANCE_SOURCE } from "@/types/invoice.js";
import type { InvoiceExtractionData, InvoiceFieldKey, InvoiceFieldProvenance, InvoiceLineItemProvenance, ParsedInvoiceData } from "@/types/invoice.js";
import { normalizeConfidence } from "@/utils/math.js";
import { findBlockByAmountValue } from "@/ai/extractors/invoice/stages/groundingAmounts.js";
import { normalizeBoxTuple, type Box4 } from "@/services/ingestion/box.js";
import { normalizeProvenanceEntry } from "@/ai/extractors/shared/provenanceNormalization.js";

export { normalizeFieldProvenance } from "@/ai/extractors/shared/provenanceNormalization.js";

type LineItemField = "row" | "description" | "hsnSac" | "quantity" | "rate" | "amountMinor" | "taxRate" | "cgstMinor" | "sgstMinor" | "igstMinor";

const LINE_ITEM_FIELDS = [
  "row",
  "description",
  "hsnSac",
  "quantity",
  "rate",
  "amountMinor",
  "taxRate",
  "cgstMinor",
  "sgstMinor",
  "igstMinor"
] as const satisfies readonly LineItemField[];

function normalizeBlockIndices(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const output: Record<string, number> = {};
  for (const [field, entry] of Object.entries(value)) {
    const parsed = Number(entry);
    if (Number.isInteger(parsed) && parsed >= 0) {
      output[field] = parsed;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export function normalizeFieldConfidence(value: unknown): Partial<Record<InvoiceFieldKey, number>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const output: Partial<Record<InvoiceFieldKey, number>> = {};
  for (const [field, entry] of Object.entries(value)) {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    output[field as InvoiceFieldKey] = normalizeConfidence(parsed);
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export function normalizeLineItemProvenance(value: unknown): InvoiceLineItemProvenance[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const output: InvoiceLineItemProvenance[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const raw = entry as Record<string, unknown>;
    const index = Number(raw.index ?? raw.itemIndex ?? raw.rowIndex ?? raw.line);
    if (!Number.isInteger(index) || index < 0) {
      continue;
    }
    const row = normalizeProvenanceEntry(raw.row);
    const fields: Record<string, InvoiceFieldProvenance> = {};
    if (raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields)) {
      for (const [fieldName, fieldValue] of Object.entries(raw.fields as Record<string, unknown>)) {
        const normalized = normalizeProvenanceEntry(fieldValue);
        if (normalized) {
          fields[fieldName] = normalized;
        }
      }
    }
    if (!row && Object.keys(fields).length === 0) {
      continue;
    }
    output.push({
      index,
      ...(row ? { row } : {}),
      ...(Object.keys(fields).length > 0 ? { fields } : {})
    });
  }
  return output.length > 0 ? output : undefined;
}

export function normalizeClassification(value: unknown): InvoiceExtractionData["classification"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const invoiceType = typeof raw.invoiceType === "string" ? raw.invoiceType.trim() : "";
  const category =
    typeof raw.category === "string"
      ? raw.category.trim()
      : typeof raw.classification === "string"
        ? raw.classification.trim()
        : "";
  const glCategory =
    typeof raw.glCategory === "string"
      ? raw.glCategory.trim()
      : typeof raw.gl_category === "string"
        ? raw.gl_category.trim()
        : "";
  const tdsSection =
    typeof raw.tdsSection === "string"
      ? raw.tdsSection.trim()
      : typeof raw.tdsCategory === "string"
        ? raw.tdsCategory.trim()
        : typeof raw.tds === "string"
          ? raw.tds.trim()
          : "";
  if (!invoiceType && !category && !glCategory && !tdsSection) {
    return undefined;
  }
  return {
    ...(invoiceType ? { invoiceType } : {}),
    ...(category ? { category } : {}),
    ...(glCategory ? { glCategory } : {}),
    ...(tdsSection ? { tdsSection } : {})
  };
}

export function mergeClassification(
  base: InvoiceExtractionData["classification"] | undefined,
  tdsSection: string | null | undefined
): InvoiceExtractionData["classification"] | undefined {
  const normalizedTds = typeof tdsSection === "string" && tdsSection.trim().length > 0 ? tdsSection.trim() : undefined;
  if (!base && !normalizedTds) {
    return undefined;
  }
  return {
    ...(base ?? {}),
    ...(normalizedTds ? { tdsSection: normalizedTds } : {})
  };
}

export function resolveLineItemProvenance(params: {
  lineItems: ParsedInvoiceData["lineItems"] | undefined;
  ocrBlocks: OcrBlock[];
  verifierLineItemProvenance: InvoiceLineItemProvenance[];
}): InvoiceLineItemProvenance[] {
  const lineItems = params.lineItems ?? [];
  if (lineItems.length === 0) {
    return [];
  }

  const verifierByIndex = new Map<number, InvoiceLineItemProvenance>();
  for (const entry of params.verifierLineItemProvenance) {
    verifierByIndex.set(entry.index, entry);
  }

  const output: InvoiceLineItemProvenance[] = [];
  for (let index = 0; index < lineItems.length; index++) {
    const item = lineItems[index];
    const verifier = verifierByIndex.get(index);
    const fields: Record<string, InvoiceFieldProvenance> = {};

    if (verifier?.fields) {
      for (const [fieldName, entry] of Object.entries(verifier.fields)) {
        const normalized = normalizeProvenanceEntry(entry);
        if (normalized) {
          fields[fieldName] = normalized;
        }
      }
    }

    for (const fieldName of LINE_ITEM_FIELDS) {
      if (fieldName === "row") {
        continue;
      }
      if (fields[fieldName]) {
        continue;
      }
      const value = item[fieldName as keyof typeof item];
      if (value === undefined || value === null) {
        continue;
      }
      const matched = findBlockForLineItemField(fieldName, value, params.ocrBlocks);
      if (matched) {
        fields[fieldName] = buildProvenanceFromBlock(
          matched.block,
          matched.index,
          PROVENANCE_SOURCE.TEXT_PATTERN,
          defaultLineItemFieldConfidence(fieldName)
        );
      }
    }

    if (!fields.description && typeof item.description === "string" && item.description.trim().length > 0) {
      const inferredDescription = findDescriptionBlockNearAmount({
        amountMinor: item.amountMinor,
        amountField: fields.amountMinor,
        rowField: normalizeProvenanceEntry(verifier?.row),
        blocks: params.ocrBlocks
      });
      if (inferredDescription) {
        fields.description = inferredDescription;
      }
    }

    const row = normalizeProvenanceEntry(verifier?.row) ?? combineLineItemRowProvenance(fields);
    if (!row && Object.keys(fields).length === 0) {
      continue;
    }
    output.push({
      index,
      ...(row ? { row } : {}),
      ...(Object.keys(fields).length > 0 ? { fields } : {})
    });
  }

  return splitAggregateLineItemBboxes(output);
}

/**
 * When LlamaExtract cites the whole line-items table as a single region for
 * every row (e.g. a markdown-table block that OCR collapses into one bbox),
 * every line item ends up sharing an identical aggregate bbox. That makes the
 * source-viewer crop useless — each row highlights the same whole-table block.
 *
 * Detect the aggregate case by grouping rows that share the same
 * bbox/bboxNormalized tuple, then split the shared y-range into N equal bands
 * so each item gets a distinct row crop in visual order. Fields that were
 * pointing at the aggregate bbox inherit the per-row band, preserving the
 * invariant that field bboxes sit within the row bbox.
 *
 * This is a geometric fallback; it doesn't try to align to actual row y
 * positions (we have no per-row OCR geometry in the aggregate case). The
 * result is approximate but monotonically distinct per item, which is the
 * minimum useful signal for the crop viewer.
 */
function splitAggregateLineItemBboxes(items: InvoiceLineItemProvenance[]): InvoiceLineItemProvenance[] {
  if (items.length < 2) {
    return items;
  }

  const bboxKey = (prov: InvoiceFieldProvenance | undefined): string | null => {
    if (!prov) return null;
    const bn = prov.bboxNormalized;
    if (bn && bn.length === 4) {
      return `N:${bn.map((n) => n.toFixed(6)).join(",")}|p${prov.page ?? ""}`;
    }
    const bb = prov.bbox;
    if (bb && bb.length === 4) {
      return `A:${bb.map((n) => n.toFixed(4)).join(",")}|p${prov.page ?? ""}`;
    }
    return null;
  };

  const groupsByRowKey = new Map<string, InvoiceLineItemProvenance[]>();
  for (const item of items) {
    const key = bboxKey(item.row);
    if (!key) continue;
    const group = groupsByRowKey.get(key);
    if (group) group.push(item);
    else groupsByRowKey.set(key, [item]);
  }

  const replacements = new Map<number, InvoiceLineItemProvenance>();
  for (const group of groupsByRowKey.values()) {
    if (group.length < 2) continue;

    // Preserve input order so visually-first row aligns with item index 0.
    group.sort((left, right) => items.indexOf(left) - items.indexOf(right));

    const aggregateKey = bboxKey(group[0].row);
    const row = group[0].row;
    if (!row || !aggregateKey) continue;

    const count = group.length;
    for (let position = 0; position < count; position++) {
      const item = group[position];
      const lo = position / count;
      const hi = (position + 1) / count;

      const splitRow = bandProvenance(row, lo, hi);

      const nextFields: Record<string, InvoiceFieldProvenance> | undefined = item.fields
        ? { ...item.fields }
        : undefined;
      if (nextFields) {
        for (const [fieldName, fieldProv] of Object.entries(nextFields)) {
          if (bboxKey(fieldProv) === aggregateKey) {
            nextFields[fieldName] = bandProvenance(fieldProv, lo, hi);
          }
        }
      }

      replacements.set(item.index, {
        ...item,
        row: splitRow,
        ...(nextFields ? { fields: nextFields } : {})
      });
    }
  }

  if (replacements.size === 0) {
    return items;
  }
  return items.map((item) => replacements.get(item.index) ?? item);
}

/**
 * Returns a copy of `prov` with its y-range sliced to [lo, hi] (relative to
 * the original y-range). x-range is preserved. Both `bbox` and
 * `bboxNormalized` are updated when present so downstream renderers pick up
 * whichever coordinate space they prefer.
 */
function bandProvenance(
  prov: InvoiceFieldProvenance,
  lo: number,
  hi: number
): InvoiceFieldProvenance {
  const next: InvoiceFieldProvenance = { ...prov };
  if (prov.bboxNormalized && prov.bboxNormalized.length === 4) {
    const [x1, y1, x2, y2] = prov.bboxNormalized;
    const height = y2 - y1;
    next.bboxNormalized = [x1, y1 + lo * height, x2, y1 + hi * height];
  }
  if (prov.bbox && prov.bbox.length === 4) {
    const [x1, y1, x2, y2] = prov.bbox;
    const height = y2 - y1;
    next.bbox = [x1, y1 + lo * height, x2, y1 + hi * height];
  }
  return next;
}

export function collectLineItemConfidence(lineItems: InvoiceLineItemProvenance[]): Record<string, number> {
  const output: Record<string, number> = {};
  for (const lineItem of lineItems) {
    if (!lineItem.fields) {
      continue;
    }
    for (const [fieldName, provenance] of Object.entries(lineItem.fields)) {
      if (typeof provenance.confidence !== "number" || !Number.isFinite(provenance.confidence)) {
        continue;
      }
      output[`lineItems.${lineItem.index}.${fieldName}`] = normalizeConfidence(provenance.confidence);
    }
  }
  return output;
}

function findBlockForLineItemField(
  field: Exclude<LineItemField, "row">,
  value: unknown,
  blocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  if (field === "description" || field === "hsnSac") {
    return findBlockByTextValue(String(value), blocks);
  }

  if (typeof value === "number" && value > 0 && Number.isFinite(value)) {
    if (field === "amountMinor" || field === "cgstMinor" || field === "sgstMinor" || field === "igstMinor") {
      return findBlockByAmountValue(Math.round(value), blocks);
    }
  }

  return undefined;
}

function findBlockByTextValue(text: string, blocks: OcrBlock[]): { block: OcrBlock; index: number } | undefined {
  const normalized = text.trim().toLowerCase();
  if (normalized.length < 2) {
    return undefined;
  }
  const exactIndex = blocks.findIndex((block) => block.text.toLowerCase().includes(normalized));
  if (exactIndex >= 0) {
    return { block: blocks[exactIndex], index: exactIndex };
  }
  const stripped = normalized.replace(/[^a-z0-9]/g, "");
  if (stripped.length < 2) {
    return undefined;
  }
  const fuzzyIndex = blocks.findIndex((block) => block.text.toLowerCase().replace(/[^a-z0-9]/g, "").includes(stripped));
  return fuzzyIndex >= 0 ? { block: blocks[fuzzyIndex], index: fuzzyIndex } : undefined;
}

function findDescriptionBlockNearAmount(params: {
  amountMinor: number;
  amountField?: InvoiceFieldProvenance;
  rowField?: InvoiceFieldProvenance;
  blocks: OcrBlock[];
}): InvoiceFieldProvenance | undefined {
  const amountMatch =
    typeof params.amountField?.blockIndex === "number" &&
    params.amountField.blockIndex >= 0 &&
    params.amountField.blockIndex < params.blocks.length
      ? { block: params.blocks[params.amountField.blockIndex], index: params.amountField.blockIndex }
      : findBlockByAmountValue(Math.round(params.amountMinor), params.blocks);
  const amountBox = amountMatch?.block.bboxNormalized;
  if (!amountBox) {
    return undefined;
  }

  const rowBox =
    Array.isArray(params.rowField?.bboxNormalized) && params.rowField.bboxNormalized.length === 4
      ? params.rowField.bboxNormalized
      : amountBox;
  const best = params.blocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry): entry is { block: OcrBlock; index: number; box: [number, number, number, number] } => Boolean(entry.box))
    .filter((entry) => entry.index !== amountMatch?.index)
    .filter((entry) => entry.box[0] < Math.min(amountBox[0] - 0.04, 0.35))
    .filter((entry) => entry.box[1] >= rowBox[1] - 0.01 && entry.box[3] <= rowBox[3] + 0.01)
    .filter((entry) => !/^(qty|quantity|rate|amount|tax|cgst|sgst|igst|amt|hsn|\/sac|\d+(\.\d+)?%?)$/i.test(entry.block.text.trim()))
    .sort((left, right) => {
      const leftDistance = Math.abs(((left.box[1] + left.box[3]) / 2) - ((amountBox[1] + amountBox[3]) / 2));
      const rightDistance = Math.abs(((right.box[1] + right.box[3]) / 2) - ((amountBox[1] + amountBox[3]) / 2));
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      return left.box[0] - right.box[0];
    })[0];
  return best ? buildProvenanceFromBlock(best.block, best.index, PROVENANCE_SOURCE.TEXT_PATTERN, defaultLineItemFieldConfidence("description")) : undefined;
}

function defaultLineItemFieldConfidence(field: Exclude<LineItemField, "row">): number {
  return field === "amountMinor" || field === "cgstMinor" || field === "sgstMinor" || field === "igstMinor"
    ? 0.9
    : 0.82;
}

function buildProvenanceFromBlock(
  block: OcrBlock,
  index: number,
  source: import("@/types/invoice.js").ProvenanceSource,
  confidence?: number
): InvoiceFieldProvenance {
  return {
    source,
    page: block.page,
    bbox: block.bbox,
    ...(block.bboxNormalized ? { bboxNormalized: block.bboxNormalized } : {}),
    ...(block.bboxModel ? { bboxModel: block.bboxModel } : {}),
    blockIndex: index,
    ...(typeof confidence === "number" ? { confidence } : {})
  };
}

function combineLineItemRowProvenance(fields: Record<string, InvoiceFieldProvenance>): InvoiceFieldProvenance | undefined {
  const entries = Object.values(fields);
  if (entries.length === 0) {
    return undefined;
  }
  const page = entries[0].page ?? 1;
  const samePageEntries = entries.filter((entry) => (entry.page ?? page) === page);
  const normalizedBoxes = samePageEntries
    .map((entry) => normalizeBoxTuple(entry.bboxNormalized))
    .filter((entry): entry is Box4 => Boolean(entry));
  if (normalizedBoxes.length > 0) {
    return {
      source: samePageEntries.some((entry) => entry.source === PROVENANCE_SOURCE.SLM) ? PROVENANCE_SOURCE.SLM : PROVENANCE_SOURCE.TEXT_PATTERN,
      page,
      bboxNormalized: unionBoxes(normalizedBoxes),
      confidence: averageConfidence(samePageEntries)
    };
  }

  const absoluteBoxes = samePageEntries
    .map((entry) => normalizeBoxTuple(entry.bbox))
    .filter((entry): entry is Box4 => Boolean(entry));
  if (absoluteBoxes.length > 0) {
    return {
      source: samePageEntries.some((entry) => entry.source === PROVENANCE_SOURCE.SLM) ? PROVENANCE_SOURCE.SLM : PROVENANCE_SOURCE.TEXT_PATTERN,
      page,
      bbox: unionBoxes(absoluteBoxes),
      confidence: averageConfidence(samePageEntries)
    };
  }
  return undefined;
}

function unionBoxes(boxes: Box4[]): Box4 {
  const x1 = Math.min(...boxes.map((box) => box[0]));
  const y1 = Math.min(...boxes.map((box) => box[1]));
  const x2 = Math.max(...boxes.map((box) => box[2]));
  const y2 = Math.max(...boxes.map((box) => box[3]));
  return [x1, y1, x2, y2];
}

function averageConfidence(entries: InvoiceFieldProvenance[]): number | undefined {
  const values = entries
    .map((entry) => entry.confidence)
    .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
  if (values.length === 0) {
    return undefined;
  }
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(avg.toFixed(4));
}
