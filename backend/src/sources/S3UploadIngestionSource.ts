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

    const checkpointMs = parseCheckpoint(lastCheckpoint);
    const objects = await this.fileStore.listObjects(this.prefix);
    const fresh = objects
      .filter((object) => object.lastModified.getTime() > checkpointMs)
      .sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());

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
        // Background-polled S3 uploads have no per-object client-org
        // metadata. The `/jobs/upload` route (which carries an explicit
        // clientOrgId in the request body) creates the Invoice
        // synchronously with the verified client-org — it does not
        // round-trip through this poller. Fall back to triage for the
        // residual cold-scan path.
        clientOrgId: null,
        workloadTier: this.workloadTier,
        sourceKey: this.key,
        sourceType: this.type,
        sourceDocumentId: object.key,
        attachmentName: fileName,
        mimeType,
        receivedAt: object.lastModified,
        buffer: result.body,
        checkpointValue: object.lastModified.toISOString(),
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
      // Object may have been deleted between list + get; skip gracefully.
      return null;
    }
  }
}

function parseCheckpoint(value: string | null): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
