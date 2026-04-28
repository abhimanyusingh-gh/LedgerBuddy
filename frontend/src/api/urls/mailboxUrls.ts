import { buildTenantPathUrl } from "@/api/urls/pathBuilder";

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
