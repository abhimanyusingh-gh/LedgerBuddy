import { buildTenantPathUrl } from "@/api/urls/pathBuilder";

export const analyticsUrls = {
  overview: (): string => buildTenantPathUrl("/analytics/overview")
};
