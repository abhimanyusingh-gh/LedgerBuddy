import path from "node:path";
import type { FileStore } from "../core/interfaces/FileStore.js";
import type { IngestedFile, IngestionSource } from "../core/interfaces/IngestionSource.js";
import type { WorkloadTier } from "../types/tenant.js";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

export class S3UploadIngestionSource implements IngestionSource {
  readonly type = "s3-upload";
  readonly key: string;
  readonly tenantId: string;
  readonly workloadTier: WorkloadTier = "standard";

  private readonly fileStore: FileStore;
  private readonly prefix: string;

  constructor(tenantId: string, fileStore: FileStore) {
    this.tenantId = tenantId;
    this.key = `s3-upload-${tenantId}`;
    this.fileStore = fileStore;
    this.prefix = `uploads/${tenantId}`;
  }

  async fetchNewFiles(_lastCheckpoint: string | null): Promise<IngestedFile[]> {
    if (!this.fileStore.listObjects) {
      return [];
    }

    const objects = await this.fileStore.listObjects(this.prefix);
    const files: IngestedFile[] = [];

    for (const object of objects) {
      const fileName = path.basename(object.key);
      const extension = path.extname(fileName).toLowerCase();
      const mimeType = MIME_BY_EXTENSION[extension];
      if (!mimeType) {
        continue;
      }

      const result = await this.fileStore.getObject(object.key);
      files.push({
        tenantId: this.tenantId,
        workloadTier: this.workloadTier,
        sourceKey: this.key,
        sourceType: this.type,
        sourceDocumentId: object.key,
        attachmentName: fileName,
        mimeType,
        receivedAt: new Date(),
        buffer: result.body,
        checkpointValue: object.key,
        metadata: {
          uploadKey: object.key
        }
      });
    }

    return files;
  }
}
