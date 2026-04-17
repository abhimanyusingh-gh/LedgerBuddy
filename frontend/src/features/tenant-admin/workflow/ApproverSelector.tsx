import type { WorkflowStep } from "@/types";
import { TENANT_ROLE_OPTIONS } from "@/types";

interface ApproverSelectorProps {
  approverType: WorkflowStep["approverType"];
  approverRole?: string;
  approverUserIds?: string[];
  tenantUsers: Array<{ userId: string; email: string }>;
  onApproverTypeChange: (approverType: WorkflowStep["approverType"]) => void;
  onApproverRoleChange: (role: string) => void;
  onApproverUserIdsChange: (userIds: string[]) => void;
}

export function ApproverSelector({
  approverType,
  approverRole,
  approverUserIds,
  tenantUsers,
  onApproverTypeChange,
  onApproverRoleChange,
  onApproverUserIdsChange,
}: ApproverSelectorProps) {
  return (
    <>
      <label>
        Approver:
        <select
          value={approverType}
          onChange={(e) => onApproverTypeChange(e.target.value as WorkflowStep["approverType"])}
        >
          <option value="any_member">Any member</option>
          <option value="role">Role</option>
          <option value="specific_users">Specific users</option>
        </select>
      </label>

      {approverType === "role" ? (
        <label>
          Role:
          <select
            value={approverRole ?? "TENANT_ADMIN"}
            onChange={(e) => onApproverRoleChange(e.target.value)}
          >
            {TENANT_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {approverType === "specific_users" ? (
        <label>
          Users:
          <select
            multiple
            value={approverUserIds ?? []}
            onChange={(e) =>
              onApproverUserIdsChange(
                Array.from(e.target.selectedOptions).map((o) => o.value)
              )
            }
            style={{ minHeight: "2.5rem" }}
          >
            {tenantUsers.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.email}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
