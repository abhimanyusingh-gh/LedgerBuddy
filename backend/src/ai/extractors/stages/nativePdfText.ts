import { spawnSync } from "node:child_process";
import { DOCUMENT_MIME_TYPE } from "@/types/mime.js";

const MAX_PDF_BUFFER_SIZE = 100 * 1024 * 1024;

export function extractNativePdfText(fileBuffer: Buffer, mimeType: string): string {
  if (mimeType !== DOCUMENT_MIME_TYPE.PDF || fileBuffer.length === 0) {
    return "";
  }

  if (fileBuffer.length > MAX_PDF_BUFFER_SIZE) {
    return "";
  }

  try {
    const result = spawnSync("pdftotext", ["-", "-"], {
      input: fileBuffer,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024
    });
    if (result.error || result.status !== 0) {
      return "";
    }

    const text = typeof result.stdout === "string" ? result.stdout.replace(/\f/g, "\n").trim() : "";
    return text;
  } catch {
    return "";
  }
}
