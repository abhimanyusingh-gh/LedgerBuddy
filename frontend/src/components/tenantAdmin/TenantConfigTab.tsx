import type { GmailConnectionStatus } from "../../types";
import { ApprovalWorkflowSection } from "./ApprovalWorkflowSection";
import { EmptyState } from "../EmptyState";

interface TenantConfigTabProps {
  currentUserId: string;
  gmailConnection: GmailConnectionStatus | null;
  onConnectGmail: () => void;
  inviteEmail: string;
  onInviteEmailChange: (email: string) => void;
  onInviteUser: () => void;
  tenantUsers: Array<{ userId: string; email: string; role: "TENANT_ADMIN" | "MEMBER" | "VIEWER"; enabled: boolean }>;
  onRoleChange: (userId: string, role: "TENANT_ADMIN" | "MEMBER" | "VIEWER") => void;
  onToggleUserEnabled: (userId: string, enabled: boolean) => void;
  onRemoveUser: (userId: string) => void;
}

export function TenantConfigTab({
  currentUserId,
  gmailConnection,
  onConnectGmail,
  inviteEmail,
  onInviteEmailChange,
  onInviteUser,
  tenantUsers,
  onRoleChange,
  onToggleUserEnabled,
  onRemoveUser
}: TenantConfigTabProps) {
  const gmailConnectionState = gmailConnection?.connectionState ?? "DISCONNECTED";
  const gmailNeedsReauth = gmailConnectionState === "NEEDS_REAUTH";

  return (
    <>
      {gmailNeedsReauth ? (
        <div className="mailbox-banner" role="alert">
          <strong>We lost access to your mailbox. Please reconnect.</strong>
          <button type="button" className="app-button app-button-primary" onClick={onConnectGmail}>
            Reconnect Gmail
          </button>
        </div>
      ) : null}

      <ApprovalWorkflowSection tenantUsers={tenantUsers} />

      <div className="editor-card">
        <div className="editor-header">
          <h3>Users</h3>
        </div>
        <div className="invite-row" style={{ marginTop: "0.5rem" }}>
          <label className="invite-label">
            Invite by email
            <input
              value={inviteEmail}
              onChange={(event) => onInviteEmailChange(event.target.value)}
              placeholder="user@example.com"
            />
          </label>
          <button
            type="button"
            className="invite-send-button"
            onClick={onInviteUser}
            disabled={!inviteEmail.trim()}
          >
            Send Invite
          </button>
        </div>
        {tenantUsers.filter((u) => u.userId !== currentUserId).length === 0 ? (
          <EmptyState icon="group" heading="No team members yet" description="Invite users by email to collaborate on invoice processing." />
        ) : (
          <div className="list-scroll" style={{ maxHeight: "200px", marginTop: "0.75rem" }}>
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {tenantUsers.filter((user) => user.userId !== currentUserId).map((user) => (
                  <tr key={user.userId}>
                    <td>{user.email}</td>
                    <td>
                      <label className="toggle-switch">
                        <input type="checkbox" checked={user.enabled} onChange={() => onToggleUserEnabled(user.userId, !user.enabled)} />
                        <span className="toggle-track" />
                      </label>
                    </td>
                    <td>
                      <div className="role-slider">
                        <button type="button" className={user.role === "TENANT_ADMIN" ? "role-slider-active" : ""} onClick={() => onRoleChange(user.userId, "TENANT_ADMIN")}>Admin</button>
                        <button type="button" className={user.role === "MEMBER" ? "role-slider-active" : ""} onClick={() => onRoleChange(user.userId, "MEMBER")}>Member</button>
                        <button type="button" className={user.role === "VIEWER" ? "role-slider-active" : ""} onClick={() => onRoleChange(user.userId, "VIEWER")}>Viewer</button>
                      </div>
                    </td>
                    <td>
                      <button type="button" className="app-button app-button-secondary" onClick={() => onRemoveUser(user.userId)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
