import { buildTenantPathUrl } from "@/api/urls/pathBuilder";

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
