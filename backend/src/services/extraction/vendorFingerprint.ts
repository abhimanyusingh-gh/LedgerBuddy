import { createHash } from "node:crypto";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface VendorFingerprint {
  key: string;
  layoutSignature: string;
  hash: string;
}

interface VendorFingerprintInput {
  buffer: Buffer;
  mimeType: string;
  sourceKey: string;
  attachmentName: string;
}

export function computeVendorFingerprint(input: VendorFingerprintInput): VendorFingerprint {
  const payloadHash = sha1(input.buffer);
  const layoutSignature = buildLayoutSignature(input.buffer, input.mimeType);
  const keyPayload = [input.sourceKey.trim().toLowerCase(), layoutSignature, input.attachmentName.toLowerCase()].join("|");
  const key = sha1(Buffer.from(keyPayload, "utf8")).slice(0, 24);

  return {
    key,
    layoutSignature,
    hash: payloadHash
  };
}

function buildLayoutSignature(buffer: Buffer, mimeType: string): string {
  const signatureParts: string[] = [];
  signatureParts.push(mimeType);
  signatureParts.push(`size-bucket:${Math.max(1, Math.ceil(buffer.length / 32_768))}`);

  if (mimeType === "application/pdf") {
    signatureParts.push(`pages:${countPdfPages(buffer)}`);
  }

  const imageDimensions = readImageDimensions(buffer, mimeType);
  if (imageDimensions) {
    const [width, height] = imageDimensions;
    signatureParts.push(`w:${width}`);
    signatureParts.push(`h:${height}`);
    signatureParts.push(`ratio:${ratioBucket(width, height)}`);
  }

  return signatureParts.join("|");
}

function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length && matches.length > 0 ? matches.length : 1;
}

function readImageDimensions(buffer: Buffer, mimeType: string): [number, number] | undefined {
  if (mimeType === "image/png" || mimeType === "image/x-png") {
    return readPngDimensions(buffer);
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg" || mimeType === "image/pjpeg") {
    return readJpegDimensions(buffer);
  }
  return undefined;
}

function readPngDimensions(buffer: Buffer): [number, number] | undefined {
  if (buffer.length < 24) {
    return undefined;
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (buffer[index] !== PNG_SIGNATURE[index]) {
      return undefined;
    }
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    return undefined;
  }
  return [width, height];
}

function readJpegDimensions(buffer: Buffer): [number, number] | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width > 0 && height > 0) {
        return [width, height];
      }
      return undefined;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength <= 0) {
      return undefined;
    }
    offset += segmentLength + 2;
  }

  return undefined;
}

function ratioBucket(width: number, height: number): string {
  if (height <= 0) {
    return "unknown";
  }
  const ratio = width / height;
  if (ratio < 0.8) {
    return "portrait";
  }
  if (ratio > 1.3) {
    return "landscape";
  }
  return "square-ish";
}

function sha1(buffer: Buffer): string {
  return createHash("sha1").update(buffer).digest("hex");
}
