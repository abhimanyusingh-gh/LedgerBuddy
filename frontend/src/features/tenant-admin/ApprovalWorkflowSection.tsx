import { useState, useEffect, useCallback } from "react";
import type { ApprovalWorkflowConfig, WorkflowStep } from "@/types";
import { TENANT_ROLE_OPTIONS } from "@/types";
import { fetchApprovalWorkflow, saveApprovalWorkflow } from "@/api";
import { getUserFacingErrorMessage } from "@/lib/common/apiError";

interface ApprovalWorkflowSectionProps {
  tenantUsers: Array<{ userId: string; email: string; role: string }>;
}

function buildSimpleSteps(config: { requireManagerReview: boolean; requireFinalSignoff: boolean }): WorkflowStep[] {
  const steps: WorkflowStep[] = [
    { order: 1, name: "Team member approval", approverType: "any_member", rule: "any", condition: null }
  ];
  if (config.requireManagerReview) {
    steps.push({ order: 2, name: "Manager review", approverType: "role", approverRole: "TENANT_ADMIN", rule: "any", condition: null });
  }
  if (config.requireFinalSignoff) {
    steps.push({ order: steps.length + 1, name: "Final sign-off", approverType: "role", approverRole: "TENANT_ADMIN", rule: "any", condition: null });
  }
  return steps;
}

export function ApprovalWorkflowSection({ tenantUsers }: ApprovalWorkflowSectionProps) {
  const [config, setConfig] = useState<ApprovalWorkflowConfig>({
    enabled: false,
    mode: "simple",
    simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
    steps: []
  });
  const [savedConfig, setSavedConfig] = useState<ApprovalWorkflowConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchApprovalWorkflow()
      .then((data) => { if (!cancelled) { setConfig(data); setSavedConfig(data); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((patch: Partial<ApprovalWorkflowConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
    setSuccess(false);
  }, []);

  const dirty = savedConfig !== null && JSON.stringify(config) !== JSON.stringify(savedConfig);

  const isValid = !config.enabled || config.mode === "simple" || config.steps.length > 0;

  const handleSave = useCallback(async () => {
    if (!isValid) {
      setError("Add at least one approval step.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await saveApprovalWorkflow(config);
      setConfig(result);
      setSavedConfig(result);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      setError(getUserFacingErrorMessage(e, "Failed to save workflow."));
    } finally {
      setSaving(false);
    }
  }, [config, isValid]);

  const switchToAdvanced = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      mode: "advanced" as const,
      steps: prev.steps.length > 0 ? prev.steps : buildSimpleSteps(prev.simpleConfig)
    }));
  }, []);

  const addStep = useCallback(() => {
    setConfig((prev) => {
      const maxOrder = prev.steps.length > 0 ? Math.max(...prev.steps.map((s) => s.order)) : 0;
      const newStep: WorkflowStep = {
        order: maxOrder + 1,
        name: `Step ${maxOrder + 1}`,
        approverType: "any_member",
        rule: "any",
        condition: null
      };
      return { ...prev, steps: [...prev.steps, newStep] };
    });
  }, []);

  const removeStep = useCallback((order: number) => {
    setConfig((prev) => {
      const filtered = prev.steps.filter((s) => s.order !== order);
      const renumbered = filtered.map((s, i) => ({ ...s, order: i + 1, name: s.name.startsWith("Step ") ? `Step ${i + 1}` : s.name }));
      return { ...prev, steps: renumbered };
    });
  }, []);

  const updateStep = useCallback((order: number, patch: Partial<WorkflowStep>) => {
    setConfig((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => s.order === order ? { ...s, ...patch } : s)
    }));
  }, []);

  if (!loaded) {
    return (
      <div className="editor-card">
        <div className="editor-header"><h3>Approval Workflow</h3></div>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem", margin: "0.5rem 0" }}>Loading…</p>
      </div>
    );
  }

  const noUsers = tenantUsers.length === 0;

  return (
    <div className="editor-card" style={noUsers ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
      <div className="editor-header"><h3>Approval Workflow</h3></div>

      {noUsers ? (
        <p className="workflow-hint">Add team members before configuring approval workflows.</p>
      ) : (
        <>
      <div className="workflow-toggle-row">
        <label>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          Require approval workflow
        </label>
      </div>
      <p className="workflow-hint">
        {config.enabled
          ? "Invoices will require step-by-step approval before export."
          : "Any member or admin can approve invoices directly."}
      </p>

      {config.enabled && config.mode === "simple" ? (
        <div className="workflow-simple-options">
          <div className="workflow-option-row">
            <span className="material-symbols-outlined" style={{ fontSize: "1rem", color: "var(--accent)" }}>check_circle</span>
            <span style={{ fontSize: "0.88rem" }}>Step 1: Approved by any team member</span>
          </div>

          <div className="workflow-option-row">
            <label>
              <input
                type="checkbox"
                checked={config.simpleConfig.requireManagerReview}
                onChange={(e) => update({
                  simpleConfig: { ...config.simpleConfig, requireManagerReview: e.target.checked }
                })}
              />
              Require manager review
            </label>
            <small>(A Tenant Admin must approve after the team member)</small>
          </div>

          <div className="workflow-option-row">
            <label>
              <input
                type="checkbox"
                checked={config.simpleConfig.requireFinalSignoff}
                onChange={(e) => update({
                  simpleConfig: { ...config.simpleConfig, requireFinalSignoff: e.target.checked }
                })}
              />
              Require final sign-off
            </label>
            <small>(A second Tenant Admin confirms after manager review)</small>
          </div>

          <div className="workflow-actions">
            <button type="button" className="workflow-mode-switch" onClick={switchToAdvanced}>
              Switch to Advanced Workflow →
            </button>
          </div>
        </div>
      ) : null}

      {config.enabled && config.mode === "advanced" ? (
        <div className="workflow-simple-options">
          {config.steps.map((step, idx) => (
            <div key={step.order}>
              {idx > 0 ? <div className="workflow-step-connector">↓</div> : null}
              <div className="workflow-step-card">
                <div className="workflow-step-card-header">
                  <span>Step {step.order}</span>
                  {config.steps.length > 1 ? (
                    <button type="button" className="app-button app-button-secondary" style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem" }} onClick={() => removeStep(step.order)}>
                      Remove
                    </button>
                  ) : null}
                </div>
                <div className="workflow-step-card-body">
                  <label>
                    Approver:
                    <select value={step.approverType} onChange={(e) => updateStep(step.order, { approverType: e.target.value as WorkflowStep["approverType"] })}>
                      <option value="any_member">Any member</option>
                      <option value="role">Role</option>
                      <option value="specific_users">Specific users</option>
                    </select>
                  </label>

                  {step.approverType === "role" ? (
                    <label>
                      Role:
                      <select value={step.approverRole ?? "TENANT_ADMIN"} onChange={(e) => updateStep(step.order, { approverRole: e.target.value })}>
                        {TENANT_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {step.approverType === "specific_users" ? (
                    <label>
                      Users:
                      <select
                        multiple
                        value={step.approverUserIds ?? []}
                        onChange={(e) => updateStep(step.order, {
                          approverUserIds: Array.from(e.target.selectedOptions).map((o) => o.value)
                        })}
                        style={{ minHeight: "2.5rem" }}
                      >
                        {tenantUsers.map((u) => (
                          <option key={u.userId} value={u.userId}>{u.email}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <label>
                    Rule:
                    <select value={step.rule} onChange={(e) => updateStep(step.order, { rule: e.target.value as "any" | "all" })}>
                      <option value="any">Any one approves</option>
                      <option value="all">All must approve</option>
                    </select>
                  </label>

                  <label>
                    Condition:
                    <select
                      value={step.condition?.field ? `${step.condition.field}:${step.condition.operator}` : "none"}
                      onChange={(e) => {
                        if (e.target.value === "none") {
                          updateStep(step.order, { condition: null });
                        } else {
                          const [field, operator] = e.target.value.split(":");
                          updateStep(step.order, {
                            condition: { field, operator: operator as "gt" | "gte" | "lt" | "lte", value: step.condition?.value ?? 5000000 }
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

                  {step.condition?.field ? (
                    <label>
                      Threshold (₹):
                      <input
                        type="number"
                        value={(step.condition.value ?? 0) / 100}
                        onChange={(e) => {
                          const major = Number(e.target.value);
                          if (Number.isFinite(major) && major >= 0) {
                            updateStep(step.order, {
                              condition: { ...step.condition!, value: Math.round(major * 100) }
                            });
                          }
                        }}
                        style={{ width: "6rem", fontSize: "0.82rem", padding: "0.2rem 0.4rem", border: "1px solid var(--line)", borderRadius: "0.25rem", background: "var(--bg-main)", color: "var(--ink)" }}
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          <div className="workflow-actions">
            <button type="button" className="app-button app-button-secondary" style={{ fontSize: "0.8rem" }} onClick={addStep}>
              + Add Step
            </button>
            <button type="button" className="workflow-mode-switch" onClick={() => update({ mode: "simple" })}>
              ← Back to Simple Mode
            </button>
          </div>
        </div>
      ) : null}

      {dirty && isValid ? (
        <div className="workflow-actions">
          <button type="button" className="app-button app-button-primary" style={{ fontSize: "0.85rem" }} onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save Workflow"}
          </button>
          {error ? <span style={{ color: "var(--warn)", fontSize: "0.82rem" }}>{error}</span> : null}
          {success ? <span style={{ color: "var(--status-approved)", fontSize: "0.82rem" }}>Saved</span> : null}
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}
