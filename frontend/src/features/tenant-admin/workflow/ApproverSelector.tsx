import type { ApproverState, TenantUser, WorkflowStep } from "@/types";
import { TENANT_ROLE_OPTIONS, PERSONA_ROLE_OPTIONS, CAPABILITY_FLAG_OPTIONS } from "@/types";

interface ApproverSelectorProps {
  approver: ApproverState;
  tenantUsers: TenantUser[];
  onApproverChange: (approver: ApproverState) => void;
}

export function ApproverSelector({
  approver,
  tenantUsers,
  onApproverChange,
}: ApproverSelectorProps) {
  const { approverType, approverRole, approverUserIds, approverPersona, approverCapability } = approver;

  function updateApprover(patch: Partial<ApproverState>) {
    onApproverChange({ ...approver, ...patch });
  }

  return (
    <>
      <label>
        Approver:
        <select
          value={approverType}
          onChange={(e) => updateApprover({ approverType: e.target.value as WorkflowStep["approverType"] })}
        >
          <option value="any_member">Any member</option>
          <option value="role">Role</option>
          <option value="specific_users">Specific users</option>
          <option value="persona">Persona</option>
          <option value="capability">Capability</option>
        </select>
      </label>

      {approverType === "role" ? (
        <label>
          Role:
          <select
            value={approverRole ?? "TENANT_ADMIN"}
            onChange={(e) => updateApprover({ approverRole: e.target.value })}
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
              updateApprover({
                approverUserIds: Array.from(e.target.selectedOptions).map((o) => o.value),
              })
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

      {approverType === "persona" ? (
        <label>
          Persona:
          <select
            value={approverPersona ?? "ap_clerk"}
            onChange={(e) => updateApprover({ approverPersona: e.target.value })}
          >
            {PERSONA_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {approverType === "capability" ? (
        <label>
          Capability:
          <select
            value={approverCapability ?? "canApproveInvoices"}
            onChange={(e) => updateApprover({ approverCapability: e.target.value })}
          >
            {CAPABILITY_FLAG_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
