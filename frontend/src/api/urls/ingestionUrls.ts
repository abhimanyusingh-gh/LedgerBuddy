import { authenticatedUrl } from "@/api/client";
import { buildClientOrgPathUrl, buildTenantPathUrl } from "@/api/urls/pathBuilder";

export const ingestionUrls = {
  sseStatus: (): string => authenticatedUrl(buildTenantPathUrl("/jobs/ingest/sse")),
  presign: (): string => buildTenantPathUrl("/uploads/presign"),
  ingestRun: (): string => buildTenantPathUrl("/jobs/ingest"),
  ingestPause: (): string => buildTenantPathUrl("/jobs/ingest/pause"),
  ingestStatus: (): string => buildTenantPathUrl("/jobs/ingest/status"),
  upload: (): string => buildClientOrgPathUrl("/jobs/upload"),
  uploadByKeys: (): string => buildClientOrgPathUrl("/jobs/upload/by-keys")
};
