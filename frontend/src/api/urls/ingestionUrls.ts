import { authenticatedUrl } from "@/api/client";
import { buildNested, buildTenantNested } from "@/api/urls/buildNested";

// Dual-scope domain: ingest orchestration is tenant-wide; the upload endpoints
// (`/jobs/upload`, `/jobs/upload/by-keys`) carry a clientOrgId in the path
// because the BE handlers depend on `req.activeClientOrgId`. See `app.ts`
// where `jobsRouter` is dual-mounted on both `tenantRouter` and `clientOrgRouter`.
export const ingestionUrls = {
  sseStatus: (): string => authenticatedUrl(buildTenantNested("/jobs/ingest/sse")),
  presign: (): string => buildTenantNested("/uploads/presign"),
  ingestRun: (): string => buildTenantNested("/jobs/ingest"),
  ingestPause: (): string => buildTenantNested("/jobs/ingest/pause"),
  ingestStatus: (): string => buildTenantNested("/jobs/ingest/status"),
  upload: (): string => buildNested("/jobs/upload"),
  uploadByKeys: (): string => buildNested("/jobs/upload/by-keys")
};
