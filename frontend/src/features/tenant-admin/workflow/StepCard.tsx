import type { WorkflowStep, WorkflowStepCondition } from "@/types";
import { ApproverSelector } from "./ApproverSelector";
import { StepConditionEditor } from "./StepConditionEditor";

interface StepCardProps {
  step: WorkflowStep;
  stepCount: number;
  tenantUsers: Array<{ userId: string; email: string }>;
  onUpdate: (patch: Partial<WorkflowStep>) => void;
  onRemove: () => void;
}

export function StepCard({ step, stepCount, tenantUsers, onUpdate, onRemove }: StepCardProps) {
  return (
    <div className="workflow-step-card">
      <div className="workflow-step-card-header">
        <span>Step {step.order}</span>
        {stepCount > 1 ? (
          <button
            type="button"
            className="app-button app-button-secondary"
            style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem" }}
            onClick={onRemove}
          >
            Remove
          </button>
        ) : null}
      </div>
      <div className="workflow-step-card-body">
        <ApproverSelector
          approverType={step.approverType}
          approverRole={step.approverRole}
          approverUserIds={step.approverUserIds}
          tenantUsers={tenantUsers}
          onApproverTypeChange={(approverType) => onUpdate({ approverType })}
          onApproverRoleChange={(approverRole) => onUpdate({ approverRole })}
          onApproverUserIdsChange={(approverUserIds) => onUpdate({ approverUserIds })}
        />

        <label>
          Rule:
          <select
            value={step.rule}
            onChange={(e) => onUpdate({ rule: e.target.value as "any" | "all" })}
          >
            <option value="any">Any one approves</option>
            <option value="all">All must approve</option>
          </select>
        </label>

        <StepConditionEditor
          condition={step.condition}
          onChange={(condition: WorkflowStepCondition | null) => onUpdate({ condition })}
        />
      </div>
    </div>
  );
}
