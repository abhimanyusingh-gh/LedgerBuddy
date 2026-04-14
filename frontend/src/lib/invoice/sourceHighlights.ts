import { formatMinorAmountWithCurrency } from "@/lib/common/currency";
import type { Invoice, InvoiceLineItemProvenance } from "@/types";

const EXTRACTION_KEY_DOT_TOKEN = "__dot__";

const SCALAR_FIELD_DEFINITIONS = [
  { key: "vendorName", label: "Vendor" },
  { key: "invoiceNumber", label: "Invoice Number" },
  { key: "invoiceDate", label: "Invoice Date" },
  { key: "dueDate", label: "Due Date" },
  { key: "totalAmountMinor", label: "Total Amount" },
  { key: "currency", label: "Currency" },
  { key: "gst.gstin", label: "GSTIN" },
  { key: "gst.subtotalMinor", label: "Subtotal" },
  { key: "gst.cgstMinor", label: "CGST" },
  { key: "gst.sgstMinor", label: "SGST" },
  { key: "gst.igstMinor", label: "IGST" },
  { key: "gst.cessMinor", label: "Cess" },
  { key: "gst.totalTaxMinor", label: "Total Tax" }
] as const;

const LINE_ITEM_FIELD_DEFINITIONS = [
  { key: "description", label: "Description", valueType: "text" },
  { key: "hsnSac", label: "HSN/SAC", valueType: "text" },
  { key: "quantity", label: "Quantity", valueType: "number" },
  { key: "rate", label: "Rate", valueType: "number" },
  { key: "amountMinor", label: "Amount", valueType: "money" },
  { key: "taxRate", label: "Tax %", valueType: "number" },
  { key: "cgstMinor", label: "CGST", valueType: "money" },
  { key: "sgstMinor", label: "SGST", valueType: "money" },
  { key: "igstMinor", label: "IGST", valueType: "money" }
] as const;

type ScalarSourceFieldKey = (typeof SCALAR_FIELD_DEFINITIONS)[number]["key"];
type LineItemSourceFieldKey = (typeof LINE_ITEM_FIELD_DEFINITIONS)[number]["key"];
export type SourceFieldKey = ScalarSourceFieldKey | `lineItems.${number}.${LineItemSourceFieldKey}`;

interface ProvenanceEntry {
  source?: unknown;
  page?: unknown;
  bbox?: unknown;
  bboxNormalized?: unknown;
  bboxModel?: unknown;
  blockIndex?: unknown;
  confidence?: unknown;
}

export interface SourceHighlight {
  fieldKey: SourceFieldKey;
  label: string;
  value: string;
  source: string;
  confidence?: number;
  page: number;
  bbox: [number, number, number, number];
  bboxNormalized: [number, number, number, number];
  blockIndex?: number;
  cropPath?: string;
  overlayPath?: string;
}

export function getInvoiceSourceHighlights(invoice: Invoice): SourceHighlight[] {
  const provenanceByField = resolveFieldProvenanceMap(invoice);
  const confidenceByField = resolveFieldConfidenceMap(invoice);
  const overlayPathByField = resolveOverlayPathMap(invoice);
  const lineItemProvenanceByIndex = resolveLineItemProvenanceMap(invoice);
  const blocks = invoice.ocrBlocks ?? [];
  return [
    ...buildScalarHighlights(blocks, invoice, provenanceByField, confidenceByField, overlayPathByField),
    ...buildLineItemHighlights(blocks, invoice, lineItemProvenanceByIndex, confidenceByField, overlayPathByField)
  ];
}

function buildScalarHighlights(
  blocks: NonNullable<Invoice["ocrBlocks"]>,
  invoice: Invoice,
  provenanceByField: Record<string, ProvenanceEntry>,
  confidenceByField: Record<string, number>,
  overlayPathByField: Record<string, string>
): SourceHighlight[] {
  const highlights: SourceHighlight[] = [];

  for (const field of SCALAR_FIELD_DEFINITIONS) {
    const value = readScalarFieldValue(invoice, field.key);
    if (!value) {
      continue;
    }

    const provenance = readProvenanceEntry(provenanceByField[field.key]);
    const highlight = buildHighlight({
      blocks,
      fieldKey: field.key,
      label: field.label,
      value,
      provenance,
      confidence: confidenceByField[field.key],
      overlayPath: overlayPathByField[field.key]
    });
    if (highlight) {
      highlights.push(highlight);
    }
  }

  return highlights;
}

function buildLineItemHighlights(
  blocks: NonNullable<Invoice["ocrBlocks"]>,
  invoice: Invoice,
  lineItemProvenanceByIndex: Map<number, InvoiceLineItemProvenance>,
  confidenceByField: Record<string, number>,
  overlayPathByField: Record<string, string>
): SourceHighlight[] {
  const highlights: SourceHighlight[] = [];
  const lineItems = invoice.parsed?.lineItems ?? [];

  lineItems.forEach((lineItem, lineIndex) => {
    const lineProvenance = lineItemProvenanceByIndex.get(lineIndex);
    for (const field of LINE_ITEM_FIELD_DEFINITIONS) {
      const value = readLineItemFieldValue(lineItem, field.key, field.valueType, invoice.parsed?.currency);
      if (!value) {
        continue;
      }

      const fieldKey = `lineItems.${lineIndex}.${field.key}` as SourceFieldKey;
      const provenance = readProvenanceEntry(lineProvenance?.fields?.[field.key]);
      const highlight = buildHighlight({
        blocks,
        fieldKey,
        label: `Line ${lineIndex + 1} ${field.label}`,
        value,
        provenance,
        confidence: normalizeConfidence(provenance.confidence) ?? confidenceByField[fieldKey],
        overlayPath: overlayPathByField[fieldKey]
      });
      if (highlight) {
        highlights.push(highlight);
      }
    }
  });

  return highlights;
}

function buildHighlight(input: {
  blocks: NonNullable<Invoice["ocrBlocks"]>;
  fieldKey: SourceFieldKey;
  label: string;
  value: string;
  provenance: ProvenanceEntry;
  confidence?: number;
  overlayPath?: string;
}): SourceHighlight | undefined {
  const matchedBlock = resolveMatchedBlock(input.blocks, input.provenance, input.fieldKey, input.value);
  const page = readPage(input.provenance.page, matchedBlock?.block.page);
  const bboxModel = normalizeBox(input.provenance.bboxModel) ?? matchedBlock?.block.bboxModel;
  const provenanceNormalizedBox = normalizeBox(input.provenance.bboxNormalized);
  const bbox =
    normalizeBox(input.provenance.bbox) ??
    matchedBlock?.block.bbox ??
    bboxModel ??
    provenanceNormalizedBox;
  if (!bbox) {
    return undefined;
  }

  const pageBlocks = input.blocks.filter((block) => block.page === page);
  const rawNormalized =
    normalizeBox(input.provenance.bboxNormalized) ??
    normalizeModelBox(bboxModel) ??
    normalizeBox(matchedBlock?.block.bboxNormalized) ??
    normalizeBoxWithinPage(bbox, pageBlocks);
  const bboxNormalized = rawNormalized ? clampNormalizedBox(rawNormalized) : undefined;
  if (!bboxNormalized) {
    return undefined;
  }

  const confidence = normalizeConfidence(input.confidence);
  const source =
    typeof input.provenance.source === "string" && input.provenance.source.trim().length > 0
      ? input.provenance.source
      : "ocr";

  return {
    fieldKey: input.fieldKey,
    label: input.label,
    value: input.value,
    source,
    ...(confidence !== undefined ? { confidence } : {}),
    page,
    bbox,
    bboxNormalized,
    ...(matchedBlock ? { blockIndex: matchedBlock.index } : {}),
    ...(matchedBlock?.block.cropPath ? { cropPath: matchedBlock.block.cropPath } : {}),
    ...(typeof input.overlayPath === "string" && input.overlayPath.trim().length > 0
      ? { overlayPath: input.overlayPath.trim() }
      : {})
  };
}

function readScalarFieldValue(invoice: Invoice, field: ScalarSourceFieldKey): string | undefined {
  if (field === "totalAmountMinor") {
    const total = formatMinorAmountWithCurrency(invoice.parsed?.totalAmountMinor, invoice.parsed?.currency);
    return total !== "-" ? total : undefined;
  }

  if (field.startsWith("gst.")) {
    const gst = invoice.parsed?.gst;
    if (!gst) {
      return undefined;
    }
    const subField = field.split(".")[1] as keyof NonNullable<typeof gst>;
    const value = gst[subField];
    if (typeof value === "number" && value > 0) {
      return formatMinorAmountWithCurrency(value, invoice.parsed?.currency);
    }
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    return undefined;
  }

  const value = invoice.parsed?.[field as keyof NonNullable<Invoice["parsed"]>];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readLineItemFieldValue(
  lineItem: NonNullable<NonNullable<Invoice["parsed"]>["lineItems"]>[number],
  field: LineItemSourceFieldKey,
  valueType: "text" | "number" | "money",
  currency?: string
): string | undefined {
  const raw = lineItem[field];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (valueType === "money") {
    if (typeof raw !== "number" || raw <= 0) {
      return undefined;
    }
    const formatted = formatMinorAmountWithCurrency(raw, currency);
    return formatted === "-" ? undefined : formatted;
  }

  if (valueType === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      return undefined;
    }
    return Number.isInteger(raw) ? String(raw) : String(Number(raw.toFixed(4)));
  }

  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveFieldProvenanceMap(invoice: Invoice): Record<string, ProvenanceEntry> {
  if (invoice.extraction?.fieldProvenance && Object.keys(invoice.extraction.fieldProvenance).length > 0) {
    return decodeExtractionRecord(invoice.extraction.fieldProvenance as Record<string, ProvenanceEntry>);
  }
  return parseMetadataRecord<ProvenanceEntry>(invoice.metadata?.fieldProvenance) ?? {};
}

function resolveFieldConfidenceMap(invoice: Invoice): Record<string, number> {
  const extractionConfidence = invoice.extraction?.fieldConfidence;
  if (extractionConfidence && Object.keys(extractionConfidence).length > 0) {
    return decodeExtractionRecord(extractionConfidence);
  }
  return parseMetadataRecord<number>(invoice.metadata?.fieldConfidence) ?? {};
}

function resolveOverlayPathMap(invoice: Invoice): Record<string, string> {
  if (invoice.extraction?.fieldOverlayPaths && Object.keys(invoice.extraction.fieldOverlayPaths).length > 0) {
    return decodeExtractionRecord(invoice.extraction.fieldOverlayPaths);
  }
  return parseMetadataRecord<string>(invoice.metadata?.fieldOverlayPaths) ?? {};
}

function resolveLineItemProvenanceMap(invoice: Invoice): Map<number, InvoiceLineItemProvenance> {
  const source =
    Array.isArray(invoice.extraction?.lineItemProvenance) && invoice.extraction!.lineItemProvenance!.length > 0
      ? invoice.extraction!.lineItemProvenance!
      : parseMetadataArray<InvoiceLineItemProvenance>(invoice.metadata?.lineItemProvenance) ?? [];
  const output = new Map<number, InvoiceLineItemProvenance>();
  for (const entry of source) {
    if (!entry || typeof entry.index !== "number" || !Number.isInteger(entry.index) || entry.index < 0) {
      continue;
    }
    output.set(entry.index, entry);
  }
  return output;
}

function readProvenanceEntry(value: unknown): ProvenanceEntry {
  return isRecord(value) ? (value as ProvenanceEntry) : {};
}

export function parseMetadataRecord<T>(value?: string): Record<string, T> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? (parsed as Record<string, T>) : undefined;
  } catch {
    return undefined;
  }
}

function parseMetadataArray<T>(value?: string): T[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

function decodeExtractionRecord<T>(value: Record<string, T>): Record<string, T> {
  const output: Record<string, T> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key.split(EXTRACTION_KEY_DOT_TOKEN).join(".")] = entry;
  }
  return output;
}

function readPage(primary: unknown, fallback?: number): number {
  const candidate = Number(primary ?? fallback ?? 1);
  if (!Number.isFinite(candidate)) {
    return 1;
  }
  const rounded = Math.round(candidate);
  return rounded > 0 ? rounded : 1;
}

function normalizeConfidence(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  if (parsed > 1) {
    return Math.max(0, Math.min(1, parsed / 100));
  }
  return Math.max(0, Math.min(1, parsed));
}

function normalizeBox(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const numbers = value.map((entry) => Number(entry));
  if (!numbers.every((entry) => Number.isFinite(entry))) {
    return undefined;
  }
  const [left, top, right, bottom] = numbers;
  if (right <= left || bottom <= top) {
    return undefined;
  }
  return [left, top, right, bottom];
}

function normalizeBoxWithinPage(
  box: [number, number, number, number],
  pageBlocks: Array<{ bbox: [number, number, number, number] }>
): [number, number, number, number] | undefined {
  if (box[2] <= 1 && box[3] <= 1) {
    return clampNormalizedBox(box);
  }

  const maxX = Math.max(
    1,
    box[2],
    ...pageBlocks.map((block) => block.bbox[2]).filter((entry) => Number.isFinite(entry) && entry > 0)
  );
  const maxY = Math.max(
    1,
    box[3],
    ...pageBlocks.map((block) => block.bbox[3]).filter((entry) => Number.isFinite(entry) && entry > 0)
  );

  return clampNormalizedBox([box[0] / maxX, box[1] / maxY, box[2] / maxX, box[3] / maxY]);
}

function normalizeModelBox(
  value: [number, number, number, number] | undefined
): [number, number, number, number] | undefined {
  if (!value) {
    return undefined;
  }
  const [x1, y1, x2, y2] = value;
  if (![x1, y1, x2, y2].every((entry) => Number.isFinite(entry))) {
    return undefined;
  }
  if (x2 <= x1 || y2 <= y1) {
    return undefined;
  }
  const scale = 999;
  return clampNormalizedBox([x1 / scale, y1 / scale, x2 / scale, y2 / scale]);
}

function clampNormalizedBox(box: [number, number, number, number]): [number, number, number, number] | undefined {
  const clamped: [number, number, number, number] = [
    clampUnit(box[0]),
    clampUnit(box[1]),
    clampUnit(box[2]),
    clampUnit(box[3])
  ];
  if (clamped[2] <= clamped[0] || clamped[3] <= clamped[1]) {
    return undefined;
  }
  return clamped;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(6));
}

function findBlockForValue(
  blocks: NonNullable<Invoice["ocrBlocks"]>,
  fieldKey: SourceFieldKey,
  value: string
) {
  if (blocks.length === 0) {
    return undefined;
  }

  const terms = fieldValueTerms(fieldKey, value);
  if (terms.length === 0) {
    return undefined;
  }

  const exactIndex = blocks.findIndex((block) => {
    const blockText = block.text.toLowerCase();
    return terms.some((term) => blockText.includes(term));
  });
  if (exactIndex >= 0) {
    return { block: blocks[exactIndex], index: exactIndex };
  }

  const stripped = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (stripped.length < 2) {
    return undefined;
  }
  const fuzzyIndex = blocks.findIndex((block) => {
    const blockStripped = block.text.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return (blockStripped.includes(stripped) || stripped.includes(blockStripped)) && blockStripped.length >= 2;
  });
  if (fuzzyIndex >= 0) {
    return { block: blocks[fuzzyIndex], index: fuzzyIndex };
  }

  if (isAmountFieldKey(fieldKey)) {
    const digits = value.replace(/[^0-9]/g, "");
    if (digits.length >= 3) {
      const digitIndex = blocks.findIndex((block) => block.text.replace(/[^0-9]/g, "").includes(digits));
      if (digitIndex >= 0) {
        return { block: blocks[digitIndex], index: digitIndex };
      }
    }
  }

  return undefined;
}

function resolveMatchedBlock(
  blocks: NonNullable<Invoice["ocrBlocks"]>,
  provenance: ProvenanceEntry,
  fieldKey: SourceFieldKey,
  value: string
) {
  const blockIndex = Number(provenance.blockIndex);
  if (Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < blocks.length) {
    return {
      block: blocks[blockIndex],
      index: blockIndex
    };
  }
  return findBlockForValue(blocks, fieldKey, value);
}

function isAmountFieldKey(fieldKey: SourceFieldKey): boolean {
  return fieldKey === "totalAmountMinor" || fieldKey.endsWith(".amountMinor");
}

function fieldValueTerms(fieldKey: SourceFieldKey, value: string): string[] {
  if (isAmountFieldKey(fieldKey)) {
    return value
      .replace(/[^0-9.,]/g, " ")
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length >= 2)
      .map((entry) => entry.toLowerCase());
  }
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
