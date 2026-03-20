import type { GmailConnectionStatus, TenantMailbox } from "../../types";

interface TenantConfigTabProps {
  gmailConnection: GmailConnectionStatus | null;
  onConnectGmail: () => void;
  inviteEmail: string;
  onInviteEmailChange: (email: string) => void;
  onInviteUser: () => void;
  tenantUsers: Array<{ userId: string; email: string; role: "TENANT_ADMIN" | "MEMBER"; enabled: boolean }>;
  onRoleChange: (userId: string, role: "TENANT_ADMIN" | "MEMBER") => void;
  onToggleUserEnabled: (userId: string, enabled: boolean) => void;
  onRemoveUser: (userId: string) => void;
  mailboxes: TenantMailbox[];
  onAssignMailboxUser: (integrationId: string, userId: string) => void;
  onRemoveMailboxAssignment: (integrationId: string, userId: string) => void;
  onRemoveMailbox: (integrationId: string) => void;
}

export function TenantConfigTab({
  gmailConnection,
  onConnectGmail,
  inviteEmail,
  onInviteEmailChange,
  onInviteUser,
  tenantUsers,
  onRoleChange,
  onToggleUserEnabled,
  onRemoveUser,
  mailboxes,
  onAssignMailboxUser,
  onRemoveMailboxAssignment,
  onRemoveMailbox
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

      <div className="editor-card">
        <div className="editor-header">
          <h3>Email Inboxes</h3>
          <button type="button" className="app-button app-button-secondary" onClick={onConnectGmail}>
            Add Gmail Inbox
          </button>
        </div>
        {mailboxes.length === 0 ? (
          <p style={{ color: "var(--ink-soft)", fontSize: "0.875rem", margin: "0.5rem 0" }}>No inboxes connected.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
            {mailboxes.map((mailbox) => (
              <div key={mailbox._id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "0.75rem 1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{mailbox.emailAddress ?? "(unknown)"}</span>
                  <span className={`bank-status-badge ${mailbox.status === "connected" ? "bank-status-active" : "bank-status-error"}`}>
                    {mailbox.status}
                  </span>
                  {mailbox.lastSyncedAt ? (
                    <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                      Last synced: {new Date(mailbox.lastSyncedAt).toLocaleString()}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="app-button app-button-danger"
                    style={{ marginLeft: "auto", fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
                    onClick={() => onRemoveMailbox(mailbox._id)}
                  >
                    Remove inbox
                  </button>
                </div>
                <div style={{ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.82rem", color: "var(--ink-soft)" }}>
                    Assigned to:{" "}
                    {mailbox.assignments === "all" ? (
                      <strong>All users</strong>
                    ) : mailbox.assignments.length === 0 ? (
                      <em>No one</em>
                    ) : (
                      mailbox.assignments.map((a) => (
                        <span key={a.userId} style={{ marginRight: "0.4rem" }}>
                          {a.email}
                          <button
                            type="button"
                            className="app-button app-button-secondary"
                            style={{ fontSize: "0.72rem", padding: "0.1rem 0.4rem", marginLeft: "0.25rem" }}
                            onClick={() => onRemoveMailboxAssignment(mailbox._id, a.userId)}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </span>
                  {mailbox.assignments !== "all" && (
                    <select
                      style={{ fontSize: "0.82rem" }}
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) onAssignMailboxUser(mailbox._id, e.target.value);
                        e.target.value = "";
                      }}
                    >
                      <option value="" disabled>Add user…</option>
                      {tenantUsers
                        .filter((u) => {
                          const assigned = mailbox.assignments as Array<{ userId: string }>;
                          return !assigned.some((a) => a.userId === u.userId);
                        })
                        .map((u) => (
                          <option key={u.userId} value={u.userId}>{u.email}</option>
                        ))}
                    </select>
                  )}
                  {mailbox.assignments === "all" && (
                    <button
                      type="button"
                      className="app-button app-button-secondary"
                      style={{ fontSize: "0.8rem", padding: "0.25rem 0.75rem" }}
                      onClick={() => onRemoveMailboxAssignment(mailbox._id, "all")}
                    >
                      Restrict to specific users
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="editor-card">
        <div className="editor-header">
          <h3>Tenant Settings</h3>
        </div>
        <div className="invite-row">
          <label className="invite-label">
            Invite User Email
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
        <div className="list-scroll" style={{ maxHeight: "160px" }}>
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
              {tenantUsers.map((user) => (
                <tr key={user.userId}>
                  <td>{user.email}</td>
                  <td>
                    <button
                      type="button"
                      className={`app-button ${user.enabled ? "app-button-secondary" : "app-button-danger"}`}
                      style={{ fontSize: 12, padding: "2px 10px", minWidth: 72 }}
                      onClick={() => onToggleUserEnabled(user.userId, !user.enabled)}
                    >
                      {user.enabled ? "Active" : "Disabled"}
                    </button>
                  </td>
                  <td>
                    <select
                      value={user.role}
                      onChange={(event) =>
                        onRoleChange(user.userId, event.target.value as "TENANT_ADMIN" | "MEMBER")
                      }
                    >
                      <option value="TENANT_ADMIN">Tenant Admin</option>
                      <option value="MEMBER">Member</option>
                    </select>
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
      </div>
    </>
  );
}
