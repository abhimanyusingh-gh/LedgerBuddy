import { authenticatedUrl } from "@/api/client";
import { buildClientOrgPathUrl, buildTenantPathUrl } from "@/api/urls/pathBuilder";

// Dual-scope domain: ingest orchestration is tenant-wide; the upload endpoints
// (`/jobs/upload`, `/jobs/upload/by-keys`) carry a clientOrgId in the path
// because the BE handlers depend on `req.activeClientOrgId`. See `app.ts`
// where `jobsRouter` is dual-mounted on both `tenantRouter` and `clientOrgRouter`.
export const ingestionUrls = {
  sseStatus: (): string => authenticatedUrl(buildTenantPathUrl("/jobs/ingest/sse")),
  presign: (): string => buildTenantPathUrl("/uploads/presign"),
  ingestRun: (): string => buildTenantPathUrl("/jobs/ingest"),
  ingestPause: (): string => buildTenantPathUrl("/jobs/ingest/pause"),
  ingestStatus: (): string => buildTenantPathUrl("/jobs/ingest/status"),
  upload: (): string => buildClientOrgPathUrl("/jobs/upload"),
  uploadByKeys: (): string => buildClientOrgPathUrl("/jobs/upload/by-keys")
};
