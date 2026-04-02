import { spawnSync } from "node:child_process";

export function extractNativePdfText(fileBuffer: Buffer, mimeType: string): string {
  if (mimeType !== "application/pdf" || fileBuffer.length === 0) {
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
