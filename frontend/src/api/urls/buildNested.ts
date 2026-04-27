import { rewriteToNestedShape, rewriteToTenantShape } from "@/api/apiPaths";
import { readActiveTenantId } from "@/api/tenantStorage";
import { readActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { MissingActiveClientOrgError } from "@/api/errors";

// URL-provider helpers throw at construction time (not request time) so the
// missing-context error surfaces during render and is caught by
// <MissingRealmBoundary>, instead of as a rejected request promise from the
// axios interceptor.

export function buildNested(barePath: string): string {
  const tenantId = readActiveTenantId();
  const clientOrgId = readActiveClientOrgId();
  if (!tenantId || !clientOrgId) {
    throw new MissingActiveClientOrgError(barePath);
  }
  return rewriteToNestedShape(barePath, tenantId, clientOrgId);
}

export function buildTenantNested(barePath: string): string {
  const tenantId = readActiveTenantId();
  if (!tenantId) {
    throw new MissingActiveClientOrgError(barePath);
  }
  return rewriteToTenantShape(barePath, tenantId);
}
