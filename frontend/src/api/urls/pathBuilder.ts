import { readActiveTenantId } from "@/api/tenantStorage";
import { readActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { MissingActiveClientOrgError } from "@/api/errors";

// URL-shape rewriters. Private to this module — every FE caller flows
// through the two builders below (consumed by `*Urls.ts` providers); the
// per-request rewriter in `client.ts` was retired in #228 Sub-PR E2.
function rewriteToNestedShape(path: string, tenantId: string, clientOrgId: string): string {
  return `/tenants/${tenantId}/clientOrgs/${clientOrgId}${path.startsWith("/") ? path : `/${path}`}`;
}

function rewriteToTenantShape(path: string, tenantId: string): string {
  return `/tenants/${tenantId}${path.startsWith("/") ? path : `/${path}`}`;
}

// URL-provider helpers throw at construction time (not request time) so the
// missing-context error surfaces during render and is caught by
// <MissingRealmBoundary>, instead of as a rejected request promise from the
// axios interceptor.

export function buildClientOrgPathUrl(barePath: string): string {
  const tenantId = readActiveTenantId();
  const clientOrgId = readActiveClientOrgId();
  if (!tenantId || !clientOrgId) {
    throw new MissingActiveClientOrgError(barePath);
  }
  return rewriteToNestedShape(barePath, tenantId, clientOrgId);
}

export function buildTenantPathUrl(barePath: string): string {
  const tenantId = readActiveTenantId();
  if (!tenantId) {
    throw new MissingActiveClientOrgError(barePath);
  }
  return rewriteToTenantShape(barePath, tenantId);
}
