import type { ReactNode } from "react";
import type { GmailConnectionStatus } from "@/types";
import { TENANT_ROLE_OPTIONS, type TenantRole, type UserCapabilities } from "@/types";
import { ApprovalWorkflowSection } from "@/features/tenant-admin/ApprovalWorkflowSection";
import { GlCodeManager } from "@/features/tenant-admin/GlCodeManager";
import { EmptyState } from "@/components/common/EmptyState";
import { TcsConfigPanel } from "@/features/tenant-admin/TcsConfigPanel";
import { ComplianceConfigPanel } from "@/features/tenant-admin/ComplianceConfigPanel";
import { ReconciliationWeightsSection } from "@/features/tenant-admin/ReconciliationWeightsSection";
import { useReorderableSections } from "@/hooks/useReorderableSections";

const CONFIG_SECTION_IDS = ["workflow", "gl-codes", "compliance", "tcs", "reconciliation-weights", "users"] as const;
const STORAGE_KEY = "billforge:config-section-order";

interface TenantConfigTabProps {
  currentUserId: string;
  capabilities: UserCapabilities;
  gmailConnection: GmailConnectionStatus | null;
  onConnectGmail: () => void;
  inviteEmail: string;
  onInviteEmailChange: (email: string) => void;
  onInviteUser: () => void;
  tenantUsers: Array<{ userId: string; email: string; role: TenantRole; enabled: boolean }>;
  onRoleChange: (userId: string, role: TenantRole) => void;
  onToggleUserEnabled: (userId: string, enabled: boolean) => void;
  onRemoveUser: (userId: string) => void;
}

export function TenantConfigTab({
  currentUserId,
  capabilities,
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
  const canManageUsers = capabilities.canManageUsers === true;
  const canManageConnections = capabilities.canManageConnections === true;
  const canConfigureWorkflow = capabilities.canConfigureWorkflow === true;
  const canConfigureGlCodes = capabilities.canConfigureGlCodes === true;
  const canConfigureCompliance = capabilities.canConfigureCompliance === true;
  const canApproveInvoices = capabilities.canApproveInvoices === true;

  const { order, dragHandlers, dragOverId, draggingId } = useReorderableSections(
    STORAGE_KEY,
    [...CONFIG_SECTION_IDS]
  );

  const sectionMap: Record<string, { visible: boolean; node: ReactNode }> = {
    workflow: {
      visible: canConfigureWorkflow,
      node: <ApprovalWorkflowSection tenantUsers={tenantUsers} />,
    },
    "gl-codes": {
      visible: canConfigureGlCodes,
      node: (
        <div className="editor-card" style={{ marginTop: "1.5rem" }}>
          <h3 style={{ marginBottom: "0.75rem" }}>Chart of Accounts (GL Codes)</h3>
          <GlCodeManager />
        </div>
      ),
    },
    compliance: {
      visible: canConfigureCompliance,
      node: <ComplianceConfigPanel canConfigureCompliance={canConfigureCompliance} />,
    },
    tcs: {
      visible: canConfigureCompliance,
      node: <TcsConfigPanel canConfigureCompliance={canConfigureCompliance} />,
    },
    "reconciliation-weights": {
      visible: canConfigureCompliance || canApproveInvoices,
      node: <ReconciliationWeightsSection />,
    },
    users: {
      visible: canManageUsers,
      node: (
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
                        <select
                          value={user.role}
                          onChange={(event) => onRoleChange(user.userId, event.target.value as TenantRole)}
                          style={{ minWidth: "220px" }}
                        >
                          {TENANT_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
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
          )}
        </div>
      ),
    },
  };

  return (
    <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 7rem)", paddingBottom: "2rem" }}>
      {gmailNeedsReauth && canManageConnections ? (
        <div className="mailbox-banner" role="alert">
          <strong>We lost access to your mailbox. Please reconnect.</strong>
          <button type="button" className="app-button app-button-primary" onClick={onConnectGmail}>
            Reconnect Gmail
          </button>
        </div>
      ) : null}

      {order.map((sectionId) => {
        const section = sectionMap[sectionId];
        if (!section || !section.visible) return null;
        const handlers = dragHandlers(sectionId);
        return (
          <div
            key={sectionId}
            className={
              "reorderable-section" +
              (draggingId === sectionId ? " section-dragging" : "") +
              (dragOverId === sectionId ? " section-drag-over" : "")
            }
            {...handlers}
          >
            <span className="section-drag-handle material-symbols-outlined" aria-label="Drag to reorder">drag_indicator</span>
            {section.node}
          </div>
        );
      })}
    </div>
  );
}
