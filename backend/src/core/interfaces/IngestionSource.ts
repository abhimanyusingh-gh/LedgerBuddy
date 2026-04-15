import type { WorkloadTier } from "@/types/tenant.js";

export const INGESTION_SOURCE_TYPE = {
  EMAIL: "email",
  FOLDER: "folder",
  S3_UPLOAD: "s3-upload",
} as const;

export type IngestionSourceType = (typeof INGESTION_SOURCE_TYPE)[keyof typeof INGESTION_SOURCE_TYPE];

export interface IngestedFile {
  tenantId: string;
  workloadTier: WorkloadTier;
  sourceKey: string;
  sourceType: IngestionSourceType;
  sourceDocumentId: string;
  attachmentName: string;
  mimeType: string;
  receivedAt: Date;
  buffer: Buffer;
  checkpointValue: string;
  metadata: Record<string, string>;
}

export interface IngestionSource {
  readonly key: string;
  readonly type: IngestionSourceType;
  readonly tenantId: string;
  readonly workloadTier: WorkloadTier;
  fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]>;
}
