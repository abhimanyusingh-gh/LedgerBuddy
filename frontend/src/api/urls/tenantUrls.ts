import { buildTenantPathUrl } from "@/api/urls/pathBuilder";

// Tenant administrative routes — all mounted under `tenantAdminRouter` in
// `app.ts` (path `/api/tenants/:tenantId/...`). Tenant-scoped only; no
// clientOrgId in the URL. `tenantAdminRouter` omits
// `requireTenantSetupCompleted` so onboarding-time calls (e.g.
// `/onboarding/complete`) work BEFORE setup flips to completed.
export const tenantUrls = {
  usersList: (): string => buildTenantPathUrl("/admin/users"),
  usersInvite: (): string => buildTenantPathUrl("/admin/users/invite"),
  userRole: (userId: string): string =>
    buildTenantPathUrl(`/admin/users/${encodeURIComponent(userId)}/role`),
  userDelete: (userId: string): string =>
    buildTenantPathUrl(`/admin/users/${encodeURIComponent(userId)}`),
  userEnabled: (userId: string): string =>
    buildTenantPathUrl(`/admin/users/${encodeURIComponent(userId)}/enabled`),
  onboardingComplete: (): string => buildTenantPathUrl("/onboarding/complete"),
  clientOrgsList: (): string => buildTenantPathUrl("/admin/client-orgs"),
  clientOrgsCreate: (): string => buildTenantPathUrl("/admin/client-orgs"),
  clientOrgUpdate: (id: string): string =>
    buildTenantPathUrl(`/admin/client-orgs/${encodeURIComponent(id)}`),
  clientOrgDelete: (id: string): string =>
    buildTenantPathUrl(`/admin/client-orgs/${encodeURIComponent(id)}`),
  clientOrgPreviewArchive: (id: string): string =>
    buildTenantPathUrl(`/admin/client-orgs/${encodeURIComponent(id)}/preview-archive`)
};
