import { DOCUMENT_MIME_TYPE, type DocumentMimeType } from "@/types/mime.js";

const MIME_ALIASES: Record<string, DocumentMimeType> = {
  "image/jpg": DOCUMENT_MIME_TYPE.JPEG,
  "image/pjpeg": DOCUMENT_MIME_TYPE.JPEG,
  "image/x-png": DOCUMENT_MIME_TYPE.PNG
};

const SUPPORTED_INVOICE_MIME_TYPES = new Set<DocumentMimeType>([
  DOCUMENT_MIME_TYPE.PDF,
  DOCUMENT_MIME_TYPE.JPEG,
  DOCUMENT_MIME_TYPE.PNG
]);

export function normalizeInvoiceMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  return MIME_ALIASES[normalized] ?? normalized;
}

export function isSupportedInvoiceMimeType(mimeType: string): boolean {
  return SUPPORTED_INVOICE_MIME_TYPES.has(normalizeInvoiceMimeType(mimeType) as DocumentMimeType);
}

const EXTENSION_TO_MIME: Record<string, string> = {
  ".pdf": DOCUMENT_MIME_TYPE.PDF,
  ".png": DOCUMENT_MIME_TYPE.PNG,
  ".jpg": DOCUMENT_MIME_TYPE.JPEG,
  ".jpeg": DOCUMENT_MIME_TYPE.JPEG,
  ".webp": DOCUMENT_MIME_TYPE.WEBP
};

export function guessMimeTypeFromKey(key: string): string {
  const dot = key.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return EXTENSION_TO_MIME[key.slice(dot).toLowerCase()] ?? "application/octet-stream";
}
