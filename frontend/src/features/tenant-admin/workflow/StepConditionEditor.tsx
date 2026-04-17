import type { WorkflowStepCondition } from "@/types";

interface StepConditionEditorProps {
  condition: WorkflowStepCondition | null | undefined;
  onChange: (condition: WorkflowStepCondition | null) => void;
}

export function StepConditionEditor({ condition, onChange }: StepConditionEditorProps) {
  return (
    <>
      <label>
        Condition:
        <select
          value={condition?.field ? `${condition.field}:${condition.operator}` : "none"}
          onChange={(e) => {
            if (e.target.value === "none") {
              onChange(null);
            } else {
              const [field, operator] = e.target.value.split(":");
              onChange({
                field,
                operator: operator as WorkflowStepCondition["operator"],
                value: condition?.value ?? 5000000,
              });
            }
          }}
        >
          <option value="none">Always</option>
          <option value="totalAmountMinor:gt">Amount greater than</option>
          <option value="totalAmountMinor:gte">Amount at least</option>
          <option value="totalAmountMinor:lt">Amount less than</option>
          <option value="totalAmountMinor:lte">Amount at most</option>
        </select>
      </label>

      {condition?.field ? (
        <label>
          Threshold (₹):
          <input
            type="number"
            value={(condition.value ?? 0) / 100}
            onChange={(e) => {
              const major = Number(e.target.value);
              if (Number.isFinite(major) && major >= 0) {
                onChange({ ...condition, value: Math.round(major * 100) });
              }
            }}
            style={{ width: "6rem", fontSize: "0.82rem", padding: "0.2rem 0.4rem", border: "1px solid var(--line)", borderRadius: "0.25rem", background: "var(--bg-main)", color: "var(--ink)" }}
          />
        </label>
      ) : null}
    </>
  );
}
