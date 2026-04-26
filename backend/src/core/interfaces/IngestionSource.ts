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
  /**
   * Resolved client-org for this file (#156/#159). Set by the source
   * when it has a deterministic answer — GSTIN match against the
   * mailbox's `clientOrgIds[]`, a single-candidate mailbox, or a caller
   * -supplied + ownership-verified value on the upload route. `null`
   * when resolution lands in the triage bucket; the resulting Invoice
   * gets `status: PENDING_TRIAGE` + `clientOrgId: null`.
   */
  clientOrgId: string | null;
  /**
   * Mailbox assignment this file was polled from (#181). `null` for
   * manual S3 uploads. Persisted on the resulting Invoice so the
   * recent-ingestions report attributes by actual source mailbox rather
   * than the stale `clientOrgId ∈ assignment.clientOrgIds[]` proxy.
   */
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
