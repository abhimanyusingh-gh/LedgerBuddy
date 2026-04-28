import type { WorkloadTier } from "@/types/tenant.js";
import type { DocumentMimeType } from "@/types/mime.js";
import type { UUID } from "@/types/uuid.js";

export const INGESTION_SOURCE_TYPE = {
  EMAIL: "email",
  S3_UPLOAD: "s3-upload",
} as const;

export type IngestionSourceType = (typeof INGESTION_SOURCE_TYPE)[keyof typeof INGESTION_SOURCE_TYPE];

export interface IngestedFile {
  tenantId: UUID;
  clientOrgId: string | null;
  sourceMailboxAssignmentId?: string | null;
  workloadTier: WorkloadTier;
  sourceKey: string;
  sourceType: IngestionSourceType;
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
  readonly type: IngestionSourceType;
  readonly tenantId: UUID;
  readonly workloadTier: WorkloadTier;
  fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]>;
}
