import { readActiveTenantId } from "@/api/tenantStorage";
import { readActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { MissingActiveClientOrgError } from "@/api/errors";

function rewriteToNestedShape(path: string, tenantId: string, clientOrgId: string): string {
  return `/tenants/${tenantId}/clientOrgs/${clientOrgId}${path.startsWith("/") ? path : `/${path}`}`;
}

function rewriteToTenantShape(path: string, tenantId: string): string {
  return `/tenants/${tenantId}${path.startsWith("/") ? path : `/${path}`}`;
}


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
