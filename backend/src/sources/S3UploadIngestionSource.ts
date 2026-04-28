import path from "node:path";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import type { IngestedFile, IngestionSource } from "@/core/interfaces/IngestionSource.js";
import type { WorkloadTier } from "@/types/tenant.js";
import { DOCUMENT_MIME_TYPE, type DocumentMimeType } from "@/types/mime.js";
import type { UUID } from "@/types/uuid.js";

const MIME_BY_EXTENSION: Record<string, DocumentMimeType> = {
  ".pdf": DOCUMENT_MIME_TYPE.PDF,
  ".jpg": DOCUMENT_MIME_TYPE.JPEG,
  ".jpeg": DOCUMENT_MIME_TYPE.JPEG,
  ".png": DOCUMENT_MIME_TYPE.PNG
};

export class S3UploadIngestionSource implements IngestionSource {
  readonly type = "s3-upload";
  readonly key: string;
  readonly tenantId: UUID;
  readonly workloadTier: WorkloadTier = "standard";

  private readonly fileStore: FileStore;
  private readonly prefix: string;

  constructor(tenantId: UUID, fileStore: FileStore) {
    this.tenantId = tenantId;
    this.key = `s3-upload-${tenantId}`;
    this.fileStore = fileStore;
    this.prefix = `uploads/${tenantId}`;
  }

  async fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]> {
    if (!this.fileStore.listObjects) {
      return [];
    }

    const checkpoint = parseCheckpoint(lastCheckpoint);
    const objects = await this.fileStore.listObjects(this.prefix);
    const fresh = objects
      .filter((object) => {
        const ms = object.lastModified.getTime();
        if (ms > checkpoint.lastModifiedMs) return true;
        if (ms === checkpoint.lastModifiedMs) return object.key > checkpoint.lastKey;
        return false;
      })
      .sort((a, b) => {
        const delta = a.lastModified.getTime() - b.lastModified.getTime();
        if (delta !== 0) return delta;
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      });

    const files: IngestedFile[] = [];

    for (const object of fresh) {
      const fileName = path.basename(object.key);
      const extension = path.extname(fileName).toLowerCase();
      const mimeType = MIME_BY_EXTENSION[extension];
      if (!mimeType) {
        continue;
      }

      const result = await this.safeGetObject(object.key);
      if (!result) {
        continue;
      }

      files.push({
        tenantId: this.tenantId,
        clientOrgId: null,
        workloadTier: this.workloadTier,
        sourceKey: this.key,
        sourceType: this.type,
        sourceDocumentId: object.key,
        attachmentName: fileName,
        mimeType,
        receivedAt: object.lastModified,
        buffer: result.body,
        checkpointValue: encodeCheckpoint(object.lastModified, object.key),
        metadata: {
          uploadKey: object.key
        }
      });
    }

    return files;
  }

  private async safeGetObject(key: string): Promise<{ body: Buffer } | null> {
    try {
      return await this.fileStore.getObject(key);
    } catch {
      return null;
    }
  }
}

interface ParsedCheckpoint {
  lastModifiedMs: number;
  lastKey: string;
}

const CHECKPOINT_DELIMITER = "|";

function encodeCheckpoint(lastModified: Date, key: string): string {
  return `${lastModified.toISOString()}${CHECKPOINT_DELIMITER}${key}`;
}

function parseCheckpoint(value: string | null): ParsedCheckpoint {
  if (!value) {
    return { lastModifiedMs: Number.NEGATIVE_INFINITY, lastKey: "" };
  }
  const delimiterIndex = value.indexOf(CHECKPOINT_DELIMITER);
  const isoPart = delimiterIndex === -1 ? value : value.slice(0, delimiterIndex);
  const keyPart = delimiterIndex === -1 ? "" : value.slice(delimiterIndex + 1);
  const parsed = Date.parse(isoPart);
  if (!Number.isFinite(parsed)) {
    return { lastModifiedMs: Number.NEGATIVE_INFINITY, lastKey: "" };
  }
  return { lastModifiedMs: parsed, lastKey: keyPart };
}
