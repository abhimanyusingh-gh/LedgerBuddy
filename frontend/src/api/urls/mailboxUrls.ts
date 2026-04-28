import { buildTenantPathUrl } from "@/api/urls/pathBuilder";

// Mailbox + integration plumbing — all tenant-scoped routes mounted under
// `tenantAdminRouter` in `app.ts`:
//   - `/admin/mailboxes` (tenantAdmin router): list/assign/remove integration
//     mailboxes against tenant users.
//   - `/admin/integrations`, `/admin/mailbox-assignments` (mailboxAssignments
//     router): assign integrations to client-orgs.
//   - `/integrations/gmail`, `/integrations/gmail/connect-url` (gmailConnection
//     router): OAuth status + connect URL.
//   - `/admin/notifications/log` (notificationLog router): tenant-wide mailbox
//     notification audit log.
//
// All routes here are tenant-scoped only — no clientOrgId in the URL — so they
// resolve through `buildTenantPathUrl`.
export const mailboxUrls = {
  list: (): string => buildTenantPathUrl("/admin/mailboxes"),
  assign: (integrationId: string): string =>
    buildTenantPathUrl(`/admin/mailboxes/${encodeURIComponent(integrationId)}/assign`),
  removeAssignment: (integrationId: string, userId: string): string =>
    buildTenantPathUrl(
      `/admin/mailboxes/${encodeURIComponent(integrationId)}/assign/${encodeURIComponent(userId)}`
    ),
  remove: (integrationId: string): string =>
    buildTenantPathUrl(`/admin/mailboxes/${encodeURIComponent(integrationId)}`),
  integrationsList: (): string => buildTenantPathUrl("/admin/integrations"),
  assignmentsList: (): string => buildTenantPathUrl("/admin/mailbox-assignments"),
  assignmentsCreate: (): string => buildTenantPathUrl("/admin/mailbox-assignments"),
  assignmentUpdate: (id: string): string =>
    buildTenantPathUrl(`/admin/mailbox-assignments/${encodeURIComponent(id)}`),
  assignmentDelete: (id: string): string =>
    buildTenantPathUrl(`/admin/mailbox-assignments/${encodeURIComponent(id)}`),
  assignmentRecentIngestions: (id: string): string =>
    buildTenantPathUrl(`/admin/mailbox-assignments/${encodeURIComponent(id)}/recent-ingestions`),
  gmailStatus: (): string => buildTenantPathUrl("/integrations/gmail"),
  gmailConnectUrl: (): string => buildTenantPathUrl("/integrations/gmail/connect-url"),
  notificationLog: (): string => buildTenantPathUrl("/admin/notifications/log")
};
