export const DOCUMENT_MIME_TYPE = {
  PDF: "application/pdf",
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
  TIFF: "image/tiff",
} as const;

export type DocumentMimeType = (typeof DOCUMENT_MIME_TYPE)[keyof typeof DOCUMENT_MIME_TYPE];

export const IMAGE_MIME_TYPE = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
} as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPE)[keyof typeof IMAGE_MIME_TYPE];

export const EXPORT_CONTENT_TYPE = {
  CSV: "text/csv",
  XML: "application/xml",
  TEXT_XML: "text/xml",
  JSON: "application/json",
  ZIP: "application/zip",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

export type ExportContentType = (typeof EXPORT_CONTENT_TYPE)[keyof typeof EXPORT_CONTENT_TYPE];

function isDocumentMimeType(value: string): value is DocumentMimeType {
  return (Object.values(DOCUMENT_MIME_TYPE) as string[]).includes(value);
}

export function assertDocumentMimeType(value: string): DocumentMimeType {
  if (isDocumentMimeType(value)) {
    return value;
  }
  throw new Error(`Unsupported document MIME type: ${value}`);
}
