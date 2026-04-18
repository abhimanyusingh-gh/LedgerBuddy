import type { WorkflowStep, WorkflowConditionField, WorkflowConditionOperator } from "@/types";
import { RISK_SEVERITY_OPTIONS, GL_CODE_SOURCE_OPTIONS } from "@/types";

interface StepConditionEditorProps {
  condition: WorkflowStep["condition"];
  onChange: (condition: WorkflowStep["condition"]) => void;
}

const CONDITION_FIELD_OPTIONS: Array<{ value: WorkflowConditionField; label: string }> = [
  { value: "totalAmountMinor", label: "Invoice Amount" },
  { value: "tdsAmountMinor", label: "TDS Amount" },
  { value: "riskSignalMaxSeverity", label: "Risk Severity" },
  { value: "glCodeSource", label: "GL Code Source" },
];

const NUMERIC_OPERATORS: Array<{ value: WorkflowConditionOperator; label: string }> = [
  { value: "gt", label: "greater than" },
  { value: "gte", label: "at least" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "at most" },
  { value: "eq", label: "equals" },
];

const STRING_EQ_OPERATORS: Array<{ value: WorkflowConditionOperator; label: string }> = [
  { value: "eq", label: "equals" },
  { value: "in", label: "is one of" },
];

function isNumericField(field: WorkflowConditionField): boolean {
  return field === "totalAmountMinor" || field === "tdsAmountMinor";
}

function getOperatorsForField(field: WorkflowConditionField) {
  return isNumericField(field) ? NUMERIC_OPERATORS : STRING_EQ_OPERATORS;
}

function getDefaultValueForField(field: WorkflowConditionField, operator: WorkflowConditionOperator): number | string | string[] {
  if (isNumericField(field)) return 5000000;
  if (field === "riskSignalMaxSeverity") return "critical";
  if (operator === "in") return ["manual"];
  return "manual";
}

function getDefaultOperatorForField(field: WorkflowConditionField): WorkflowConditionOperator {
  return isNumericField(field) ? "gt" : "eq";
}

export function StepConditionEditor({ condition, onChange }: StepConditionEditorProps) {
  const handleFieldChange = (newField: WorkflowConditionField) => {
    const operator = getDefaultOperatorForField(newField);
    onChange({
      field: newField,
      operator,
      value: getDefaultValueForField(newField, operator),
    });
  };

  const handleOperatorChange = (newOperator: WorkflowConditionOperator) => {
    if (!condition) return;
    const needsArrayValue = newOperator === "in";
    const currentIsArray = Array.isArray(condition.value);
    let value = condition.value;
    if (needsArrayValue && !currentIsArray) {
      value = typeof condition.value === "string" ? [condition.value] : [String(condition.value)];
    } else if (!needsArrayValue && currentIsArray) {
      value = (condition.value as string[])[0] ?? "";
    }
    onChange({ ...condition, operator: newOperator, value });
  };

  const currentField = condition?.field as WorkflowConditionField | undefined;
  const operators = currentField ? getOperatorsForField(currentField) : [];

  return (
    <>
      <label>
        Condition:
        <select
          value={currentField ?? "none"}
          onChange={(e) => {
            if (e.target.value === "none") {
              onChange(null);
            } else {
              handleFieldChange(e.target.value as WorkflowConditionField);
            }
          }}
        >
          <option value="none">Always</option>
          {CONDITION_FIELD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>

      {currentField && condition ? (
        <>
          <label>
            Operator:
            <select
              value={condition.operator}
              onChange={(e) => handleOperatorChange(e.target.value as WorkflowConditionOperator)}
            >
              {operators.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
          </label>

          {isNumericField(currentField) ? (
            <label>
              Threshold ({"\u20B9"}):
              <input
                type="number"
                value={(typeof condition.value === "number" ? condition.value : 0) / 100}
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

          {currentField === "riskSignalMaxSeverity" ? (
            <label>
              Severity:
              <select
                value={typeof condition.value === "string" ? condition.value : "critical"}
                onChange={(e) => onChange({ ...condition, value: e.target.value })}
              >
                {RISK_SEVERITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          ) : null}

          {currentField === "glCodeSource" && condition.operator === "eq" ? (
            <label>
              Source:
              <select
                value={typeof condition.value === "string" ? condition.value : "manual"}
                onChange={(e) => onChange({ ...condition, value: e.target.value })}
              >
                {GL_CODE_SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          ) : null}

          {currentField === "glCodeSource" && condition.operator === "in" ? (
            <label>
              Sources:
              <select
                multiple
                value={Array.isArray(condition.value) ? condition.value : []}
                onChange={(e) =>
                  onChange({
                    ...condition,
                    value: Array.from(e.target.selectedOptions).map((o) => o.value),
                  })
                }
                style={{ minHeight: "2.5rem" }}
              >
                {GL_CODE_SOURCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      ) : null}
    </>
  );
}
