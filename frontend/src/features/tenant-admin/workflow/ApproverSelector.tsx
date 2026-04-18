import type { ApproverState, TenantUser, WorkflowStep } from "@/types";
import { TENANT_ROLE_OPTIONS, PERSONA_ROLE_OPTIONS, CAPABILITY_FLAG_OPTIONS } from "@/types";

interface ApproverSelectorProps {
  approver: ApproverState;
  tenantUsers: TenantUser[];
  onApproverChange: (approver: ApproverState) => void;
}

const OPTION_SELECT_CONFIG: Array<{
  type: WorkflowStep["approverType"];
  label: string;
  field: keyof Pick<ApproverState, "approverRole" | "approverPersona" | "approverCapability">;
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
}> = [
  { type: "role", label: "Role", field: "approverRole", defaultValue: "TENANT_ADMIN", options: TENANT_ROLE_OPTIONS },
  { type: "persona", label: "Persona", field: "approverPersona", defaultValue: "ap_clerk", options: PERSONA_ROLE_OPTIONS },
  { type: "capability", label: "Capability", field: "approverCapability", defaultValue: "canApproveInvoices", options: CAPABILITY_FLAG_OPTIONS },
];

export function ApproverSelector({
  approver,
  tenantUsers,
  onApproverChange,
}: ApproverSelectorProps) {
  const { approverType, approverUserIds } = approver;

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

      {OPTION_SELECT_CONFIG.filter((cfg) => cfg.type === approverType).map((cfg) => (
        <label key={cfg.field}>
          {cfg.label}:
          <select
            value={(approver[cfg.field] as string) ?? cfg.defaultValue}
            onChange={(e) => updateApprover({ [cfg.field]: e.target.value })}
          >
            {cfg.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}

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
    </>
  );
}
