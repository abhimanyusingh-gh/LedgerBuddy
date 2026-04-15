import type { WorkloadTier } from "@/types/tenant.js";
import type { DocumentMimeType } from "@/types/mime.js";

export interface IngestedFile {
  tenantId: string;
  workloadTier: WorkloadTier;
  sourceKey: string;
  sourceType: string;
  sourceDocumentId: string;
  attachmentName: string;
  mimeType: DocumentMimeType;
  receivedAt: Date;
  buffer: Buffer;
  checkpointValue: string;
  metadata: Record<string, string>;
}

export interface IngestionSource {
  readonly key: string;
  readonly type: string;
  readonly tenantId: string;
  readonly workloadTier: WorkloadTier;
  fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]>;
}
