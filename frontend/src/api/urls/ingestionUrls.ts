import { authenticatedUrl } from "@/api/client";
import { buildTenantNested } from "@/api/urls/buildNested";

export const ingestionUrls = {
  sseStatus: (): string => authenticatedUrl(buildTenantNested("/jobs/ingest/sse"))
};
