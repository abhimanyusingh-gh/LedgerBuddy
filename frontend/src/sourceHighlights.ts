import { formatMinorAmountWithCurrency } from "./currency";
import type { Invoice } from "./types";

const FIELD_DEFINITIONS = [
  { key: "vendorName", label: "Vendor" },
  { key: "invoiceNumber", label: "Invoice Number" },
  { key: "invoiceDate", label: "Invoice Date" },
  { key: "dueDate", label: "Due Date" },
  { key: "totalAmountMinor", label: "Total Amount" },
  { key: "currency", label: "Currency" }
] as const;

export type SourceFieldKey = (typeof FIELD_DEFINITIONS)[number]["key"];

interface ProvenanceEntry {
  source?: unknown;
  page?: unknown;
  bbox?: unknown;
  bboxNormalized?: unknown;
  blockIndex?: unknown;
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
  const provenanceByField = parseMetadataRecord<ProvenanceEntry>(invoice.metadata?.fieldProvenance);
  const confidenceByField = parseMetadataRecord<number>(invoice.metadata?.fieldConfidence);
  const overlayPathByField = parseMetadataRecord<string>(invoice.metadata?.fieldOverlayPaths);
  const blocks = invoice.ocrBlocks ?? [];

  const highlights: SourceHighlight[] = [];
  for (const field of FIELD_DEFINITIONS) {
    const value = readFieldValue(invoice, field.key);
    if (!value) {
      continue;
    }

    const provenance = isRecord(provenanceByField?.[field.key]) ? (provenanceByField?.[field.key] as ProvenanceEntry) : {};
    const matchedBlock = resolveMatchedBlock(blocks, provenance, field.key, value);
    const page = readPage(provenance.page, matchedBlock?.block.page);
    const bbox = normalizeBox(provenance.bbox) ?? matchedBlock?.block.bbox;
    if (!bbox) {
      continue;
    }

    const pageBlocks = blocks.filter((block) => block.page === page);
    const bboxNormalized =
      normalizeBox(provenance.bboxNormalized) ??
      matchedBlock?.block.bboxNormalized ??
      normalizeBoxWithinPage(bbox, pageBlocks);
    if (!bboxNormalized) {
      continue;
    }

    const confidence = normalizeConfidence(confidenceByField?.[field.key]);
    const source = typeof provenance.source === "string" && provenance.source.trim().length > 0 ? provenance.source : "ocr";

    highlights.push({
      fieldKey: field.key,
      label: field.label,
      value,
      source,
      ...(confidence !== undefined ? { confidence } : {}),
      page,
      bbox,
      bboxNormalized,
      ...(matchedBlock ? { blockIndex: matchedBlock.index } : {}),
      ...(matchedBlock?.block.cropPath ? { cropPath: matchedBlock.block.cropPath } : {}),
      ...(typeof overlayPathByField?.[field.key] === "string" && overlayPathByField[field.key].trim().length > 0
        ? { overlayPath: overlayPathByField[field.key].trim() }
        : {})
    });
  }

  return highlights;
}

function readFieldValue(invoice: Invoice, field: SourceFieldKey): string | undefined {
  if (field === "totalAmountMinor") {
    const total = formatMinorAmountWithCurrency(invoice.parsed?.totalAmountMinor, invoice.parsed?.currency);
    return total !== "-" ? total : undefined;
  }

  const value = invoice.parsed?.[field];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseMetadataRecord<T>(value?: string): Record<string, T> | undefined {
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

  const index = blocks.findIndex((block) => {
    const blockText = block.text.toLowerCase();
    return terms.some((term) => blockText.includes(term));
  });

  if (index < 0) {
    return undefined;
  }

  return {
    block: blocks[index],
    index
  };
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

function fieldValueTerms(fieldKey: SourceFieldKey, value: string): string[] {
  if (fieldKey === "totalAmountMinor") {
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
