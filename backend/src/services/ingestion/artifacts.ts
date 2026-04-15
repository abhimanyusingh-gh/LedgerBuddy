import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import type { IngestedFile } from "@/core/interfaces/IngestionSource.js";
import type { OcrBlock, OcrPageImage } from "@/core/interfaces/OcrProvider.js";
import { logger } from "@/utils/logger.js";
import { normalizeAbsoluteBox, normalizeModelBox, normalizeUnitBox, type Box4 } from "@/services/ingestion/box.js";
import {
  flattenLineItemProvenance,
  parseFieldProvenance,
  sanitizeFieldProvenanceRecord,
  type FieldProvenanceEntry
} from "@/services/ingestion/provenance.js";

interface CropPageImage {
  page: number;
  buffer: Buffer;
  width: number;
  height: number;
}

export interface ArtifactResults {
  previewImagePaths: Record<string, string>;
  cropPathsByIndex: Map<number, string>;
  fieldOverlayPaths: Map<string, string>;
}

export async function persistFieldArtifacts(input: {
  file: IngestedFile;
  mimeType: string;
  extraction: {
    ocrPageImages: OcrPageImage[];
    metadata: Record<string, string>;
    extraction?: {
      fieldProvenance?: Record<string, FieldProvenanceEntry>;
      lineItemProvenance?: Array<{ index: number; row?: FieldProvenanceEntry; fields?: Record<string, FieldProvenanceEntry> }>;
    };
  };
  ocrBlocks: OcrBlock[];
  fileStore?: FileStore;
}): Promise<ArtifactResults> {
  const artifactPrefix = buildArtifactPrefix(input.file);
  const pageSources = await buildPageSourcesForCropping(input.file, input.mimeType, input.extraction.ocrPageImages);
  const structuredFieldProvenance = sanitizeFieldProvenanceRecord(input.extraction.extraction?.fieldProvenance);
  const lineItemOverlayProvenance = flattenLineItemProvenance(input.extraction.extraction?.lineItemProvenance ?? []);
  const fallbackFieldProvenance = parseFieldProvenance(input.extraction.metadata.fieldProvenance);
  const fieldProvenance = {
    ...(structuredFieldProvenance && Object.keys(structuredFieldProvenance).length > 0
      ? structuredFieldProvenance
      : fallbackFieldProvenance),
    ...lineItemOverlayProvenance
  };

  const [previewImagePaths, cropPathsByIndex] = await Promise.all([
    input.fileStore
      ? persistPreviewImages({
          file: input.file,
          mimeType: input.mimeType,
          images: input.extraction.ocrPageImages,
          keyPrefix: `${artifactPrefix}/previews`,
          fileStore: input.fileStore
        })
      : Promise.resolve({}),
    input.fileStore
      ? persistOcrBlockCrops({
          file: input.file,
          blocks: input.ocrBlocks,
          pageSources,
          keyPrefix: `${artifactPrefix}/ocr-blocks`,
          fileStore: input.fileStore
        })
      : Promise.resolve(new Map<number, string>())
  ]);

  const fieldOverlayPaths =
    input.fileStore && Object.keys(fieldProvenance).length > 0
      ? await persistFieldOverlayImages({
          file: input.file,
          fieldProvenance,
          pageSources,
          keyPrefix: `${artifactPrefix}/source-overlays`,
          fileStore: input.fileStore
        })
      : new Map<string, string>();

  return { previewImagePaths, cropPathsByIndex, fieldOverlayPaths };
}

function buildArtifactPrefix(file: IngestedFile): string {
  const hash = createHash("sha1")
    .update(`${file.tenantId}:${file.sourceKey}:${file.sourceDocumentId}:${file.attachmentName}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(file.tenantId, file.sourceKey, hash);
}

async function persistPreviewImages(input: {
  file: IngestedFile;
  mimeType: string;
  images: OcrPageImage[];
  keyPrefix: string;
  fileStore: FileStore;
}): Promise<Record<string, string>> {
  if (input.images.length === 0 && !input.mimeType.startsWith("image/")) {
    return {};
  }

  const output: Record<string, string> = {};
  if (input.mimeType.startsWith("image/")) {
    const extension = extensionForMimeType(input.mimeType);
    const objectRef = await input.fileStore.putObject({
      key: `${input.keyPrefix}/page-1.${extension}`,
      body: input.file.buffer,
      contentType: input.mimeType,
      metadata: {
        tenantId: input.file.tenantId,
        sourceKey: input.file.sourceKey,
        sourceDocumentId: input.file.sourceDocumentId
      }
    });
    output["1"] = objectRef.path;
  }

  for (const image of input.images) {
    const parsed = decodeDataUrl(image.dataUrl);
    if (!parsed) {
      continue;
    }

    const extension = extensionForMimeType(parsed.mimeType);
    const objectRef = await input.fileStore.putObject({
      key: `${input.keyPrefix}/page-${image.page}.${extension}`,
      body: parsed.buffer,
      contentType: parsed.mimeType,
      metadata: {
        tenantId: input.file.tenantId,
        sourceKey: input.file.sourceKey,
        sourceDocumentId: input.file.sourceDocumentId
      }
    });
    output[String(image.page)] = objectRef.path;
  }

  return output;
}

async function persistOcrBlockCrops(input: {
  file: IngestedFile;
  blocks: OcrBlock[];
  pageSources: Map<number, CropPageImage>;
  keyPrefix: string;
  fileStore: FileStore;
}): Promise<Map<number, string>> {
  if (input.blocks.length === 0 || input.pageSources.size === 0) {
    return new Map<number, string>();
  }

  const indexedBlocks = input.blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => entry.block.text.trim().length > 0);

  const results = new Map<number, string>();
  const concurrency = 8;
  for (let offset = 0; offset < indexedBlocks.length; offset += concurrency) {
    const batch = indexedBlocks.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async ({ block, index }) => {
        const pageImage = input.pageSources.get(block.page) ?? input.pageSources.get(1);
        if (!pageImage) {
          return;
        }

        const region = resolveCropRegion(block, pageImage.width, pageImage.height);
        if (!region) {
          return;
        }

        const cropped = await sharp(pageImage.buffer)
          .extract(region)
          .png({ compressionLevel: 9 })
          .toBuffer();
        const objectRef = await input.fileStore.putObject({
          key: `${input.keyPrefix}/page-${pageImage.page}/block-${index + 1}.png`,
          body: cropped,
          contentType: "image/png",
          metadata: {
            tenantId: input.file.tenantId,
            sourceKey: input.file.sourceKey,
            sourceDocumentId: input.file.sourceDocumentId
          }
        });
        results.set(index, objectRef.path);
      })
    );

    settled.forEach((result) => {
      if (result.status === "rejected") {
        logger.warn("ingestion.crop.persist.failed", {
          sourceDocumentId: input.file.sourceDocumentId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    });
  }

  return results;
}

async function persistFieldOverlayImages(input: {
  file: IngestedFile;
  fieldProvenance: Record<string, FieldProvenanceEntry>;
  pageSources: Map<number, CropPageImage>;
  keyPrefix: string;
  fileStore: FileStore;
}): Promise<Map<string, string>> {
  if (input.pageSources.size === 0) {
    return new Map<string, string>();
  }

  const entries = Object.entries(input.fieldProvenance).filter(
    ([, value]) => value.bbox || value.bboxNormalized || value.bboxModel
  );
  if (entries.length === 0) {
    return new Map<string, string>();
  }

  const results = new Map<string, string>();
  const concurrency = 4;
  for (let offset = 0; offset < entries.length; offset += concurrency) {
    const batch = entries.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async ([field, provenance]) => {
        const pageImage = input.pageSources.get(provenance.page ?? 1) ?? input.pageSources.get(1);
        if (!pageImage) {
          return;
        }

        const normalized = resolveFieldOverlayBox(provenance, pageImage.width, pageImage.height);
        if (!normalized) {
          return;
        }

        const overlayBuffer = await renderOverlayImage(pageImage, normalized, field);
        const objectRef = await input.fileStore.putObject({
          key: `${input.keyPrefix}/${sanitizeObjectName(field)}.png`,
          body: overlayBuffer,
          contentType: "image/png",
          metadata: {
            tenantId: input.file.tenantId,
            sourceKey: input.file.sourceKey,
            sourceDocumentId: input.file.sourceDocumentId
          }
        });

        results.set(field, objectRef.path);
      })
    );

    settled.forEach((result) => {
      if (result.status === "rejected") {
        logger.warn("ingestion.overlay.persist.failed", {
          sourceDocumentId: input.file.sourceDocumentId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    });
  }

  return results;
}

async function buildPageSourcesForCropping(
  file: IngestedFile,
  mimeType: string,
  pageImages: OcrPageImage[]
): Promise<Map<number, CropPageImage>> {
  const output = new Map<number, CropPageImage>();

  if (mimeType === "application/pdf") {
    for (const pageImage of pageImages) {
      const parsed = decodeDataUrl(pageImage.dataUrl);
      if (!parsed) {
        continue;
      }

      const dimensions = await readImageDimensions(parsed.buffer);
      if (!dimensions) {
        continue;
      }

      output.set(pageImage.page, {
        page: pageImage.page,
        buffer: parsed.buffer,
        width: pageImage.width ?? dimensions.width,
        height: pageImage.height ?? dimensions.height
      });
    }
    return output;
  }

  if (!mimeType.startsWith("image/")) {
    return output;
  }

  const dimensions = await readImageDimensions(file.buffer);
  if (!dimensions) {
    return output;
  }

  output.set(1, {
    page: 1,
    buffer: file.buffer,
    width: dimensions.width,
    height: dimensions.height
  });
  return output;
}

async function readImageDimensions(value: Buffer): Promise<{ width: number; height: number } | undefined> {
  try {
    const metadata = await sharp(value).metadata();
    if (!metadata.width || !metadata.height) {
      return undefined;
    }
    return {
      width: metadata.width,
      height: metadata.height
    };
  } catch {
    return undefined;
  }
}

function resolveCropRegion(
  block: OcrBlock,
  pageWidth: number,
  pageHeight: number
): { left: number; top: number; width: number; height: number } | undefined {
  if (pageWidth <= 0 || pageHeight <= 0) {
    return undefined;
  }

  const normalized =
    normalizeUnitBox(block.bboxNormalized) ??
    normalizeModelBox(block.bboxModel) ??
    normalizeUnitBox(block.bbox) ??
    normalizeAbsoluteBox(block.bbox, pageWidth, pageHeight);
  if (!normalized) {
    return undefined;
  }

  const left = Math.max(0, Math.min(pageWidth - 1, Math.floor(normalized[0] * pageWidth)));
  const top = Math.max(0, Math.min(pageHeight - 1, Math.floor(normalized[1] * pageHeight)));
  const right = Math.max(left + 1, Math.min(pageWidth, Math.ceil(normalized[2] * pageWidth)));
  const bottom = Math.max(top + 1, Math.min(pageHeight, Math.ceil(normalized[3] * pageHeight)));
  const width = right - left;
  const height = bottom - top;
  if (width <= 1 || height <= 1) {
    return undefined;
  }

  return { left, top, width, height };
}

function resolveFieldOverlayBox(
  provenance: FieldProvenanceEntry,
  pageWidth: number,
  pageHeight: number
): [number, number, number, number] | undefined {
  if (pageWidth <= 0 || pageHeight <= 0) {
    return undefined;
  }

  const bbox = provenance.bbox;
  const bboxNormalized = provenance.bboxNormalized;
  const bboxModel = provenance.bboxModel;
  if (bboxNormalized) {
    const normalized = normalizeUnitBox(bboxNormalized);
    if (normalized) {
      return normalized;
    }
  }

  if (bboxModel) {
    const normalized = normalizeModelBox(bboxModel);
    if (normalized) {
      return normalized;
    }
  }

  if (!bbox) {
    return undefined;
  }

  return normalizeUnitBox(bbox) ?? normalizeAbsoluteBox(bbox, pageWidth, pageHeight);
}

async function renderOverlayImage(
  pageImage: CropPageImage,
  box: [number, number, number, number],
  field: string
): Promise<Buffer> {
  const left = Math.max(0, Math.min(pageImage.width - 1, Math.floor(box[0] * pageImage.width)));
  const top = Math.max(0, Math.min(pageImage.height - 1, Math.floor(box[1] * pageImage.height)));
  const right = Math.max(left + 1, Math.min(pageImage.width, Math.ceil(box[2] * pageImage.width)));
  const bottom = Math.max(top + 1, Math.min(pageImage.height, Math.ceil(box[3] * pageImage.height)));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const strokeWidth = Math.max(2, Math.round(Math.min(pageImage.width, pageImage.height) * 0.004));
  const labelText = escapeSvgText(field);

  const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pageImage.width}" height="${pageImage.height}" viewBox="0 0 ${pageImage.width} ${pageImage.height}">
  <rect x="${left}" y="${top}" width="${width}" height="${height}" fill="rgba(31,122,108,0.2)" stroke="#1f7a6c" stroke-width="${strokeWidth}" />
  <rect x="${left}" y="${Math.max(0, top - 24)}" width="${Math.min(pageImage.width - left, Math.max(110, labelText.length * 8))}" height="22" fill="#1f7a6c" />
  <text x="${left + 8}" y="${Math.max(15, top - 9)}" fill="#ffffff" font-size="13" font-family="Arial, sans-serif">${labelText}</text>
</svg>`;

  return sharp(pageImage.buffer)
    .composite([{ input: Buffer.from(overlaySvg), blend: "over" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function decodeDataUrl(value: string): { mimeType: string; buffer: Buffer } | undefined {
  const separatorIndex = value.indexOf(",");
  if (separatorIndex < 0) {
    return undefined;
  }

  const header = value.slice(0, separatorIndex);
  const payload = value.slice(separatorIndex + 1);
  const mimeMatch = /^data:([^;]+);base64$/i.exec(header.trim());
  if (!mimeMatch) {
    return undefined;
  }

  try {
    return {
      mimeType: mimeMatch[1].toLowerCase(),
      buffer: Buffer.from(payload, "base64")
    };
  } catch {
    return undefined;
  }
}

function extensionForMimeType(value: string): string {
  if (value === "image/jpeg" || value === "image/jpg") {
    return "jpg";
  }
  return "png";
}

const SANITIZE_OBJECT_NAME_REGEX = /[^a-z0-9_-]/gi;
function sanitizeObjectName(value: string): string {
  return value.replace(SANITIZE_OBJECT_NAME_REGEX, "-").toLowerCase();
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
