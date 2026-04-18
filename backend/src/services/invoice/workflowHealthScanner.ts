import { ApprovalWorkflowModel } from "@/models/invoice/ApprovalWorkflow.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { TenantModel } from "@/models/core/Tenant.js";

interface WorkflowStepDoc {
  order: number;
  name: string;
  type?: string | null;
  approverType: string;
  approverRole?: string | null;
  approverPersona?: string | null;
  approverCapability?: string | null;
  approverUserIds?: string[];
  timeoutHours?: number | null;
  escalateTo?: string | null;
  rule: string;
}

interface WorkflowDoc {
  tenantId: string;
  enabled: boolean;
  mode: string;
  steps: WorkflowStepDoc[];
}

interface StepFinding {
  stepOrder: number;
  stepName: string;
  issue: string;
  severity: "error" | "warning";
}

interface TenantWorkflowHealthResult {
  tenantId: string;
  tenantName: string;
  enabled: boolean;
  mode: string;
  stepCount: number;
  findings: StepFinding[];
}

interface WorkflowHealthReport {
  scannedAt: string;
  totalTenants: number;
  tenantsWithWorkflows: number;
  tenantsWithFindings: number;
  totalFindings: number;
  results: TenantWorkflowHealthResult[];
}

export async function scanWorkflowStep(
  step: WorkflowStepDoc,
  tenantId: string
): Promise<StepFinding[]> {
  const findings: StepFinding[] = [];

  if (step.type === "compliance_signoff") {
    const complianceUsers = await TenantUserRoleModel.countDocuments({
      tenantId,
      "capabilities.canSignOffCompliance": true
    });
    if (complianceUsers === 0) {
      findings.push({
        stepOrder: step.order,
        stepName: step.name,
        issue: "compliance_signoff step exists but no tenant users have canSignOffCompliance capability",
        severity: "error"
      });
    }
  }

  if (step.type === "escalation" || (step.timeoutHours !== null && step.timeoutHours !== undefined && step.timeoutHours > 0)) {
    if (!step.escalateTo) {
      findings.push({
        stepOrder: step.order,
        stepName: step.name,
        issue: "Step has timeoutHours configured but escalateTo is empty or null",
        severity: "error"
      });
    }
  }

  if (step.approverType === "persona" && step.approverPersona) {
    const matchingUsers = await TenantUserRoleModel.countDocuments({
      tenantId,
      role: step.approverPersona
    });
    if (matchingUsers === 0) {
      findings.push({
        stepOrder: step.order,
        stepName: step.name,
        issue: `Approver persona '${step.approverPersona}' has no matching users in tenant`,
        severity: "warning"
      });
    }
  }

  if (step.approverType === "capability" && step.approverCapability) {
    const matchingUsers = await TenantUserRoleModel.countDocuments({
      tenantId,
      [`capabilities.${step.approverCapability}`]: true
    });
    if (matchingUsers === 0) {
      findings.push({
        stepOrder: step.order,
        stepName: step.name,
        issue: `Approver capability '${step.approverCapability}' has no matching users in tenant`,
        severity: "warning"
      });
    }
  }

  return findings;
}

export async function scanWorkflowForTenant(
  workflow: WorkflowDoc,
  tenantName: string
): Promise<TenantWorkflowHealthResult> {
  const findings: StepFinding[] = [];

  for (const step of workflow.steps) {
    const stepFindings = await scanWorkflowStep(step, workflow.tenantId);
    findings.push(...stepFindings);
  }

  return {
    tenantId: workflow.tenantId,
    tenantName,
    enabled: workflow.enabled,
    mode: workflow.mode,
    stepCount: workflow.steps.length,
    findings
  };
}

export async function scanAllWorkflows(): Promise<WorkflowHealthReport> {
  const workflows = await ApprovalWorkflowModel.find({}).lean();
  const tenantIds = workflows.map((w) => w.tenantId);
  const tenants = await TenantModel.find({ _id: { $in: tenantIds } }, { name: 1 }).lean();
  const tenantNameMap = new Map<string, string>();
  for (const t of tenants) {
    tenantNameMap.set(String(t._id), t.name);
  }

  const results: TenantWorkflowHealthResult[] = [];
  for (const workflow of workflows) {
    const tenantName = tenantNameMap.get(workflow.tenantId) ?? "Unknown";
    const result = await scanWorkflowForTenant(
      workflow as unknown as WorkflowDoc,
      tenantName
    );
    results.push(result);
  }

  const tenantsWithFindings = results.filter((r) => r.findings.length > 0).length;
  const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);

  return {
    scannedAt: new Date().toISOString(),
    totalTenants: results.length,
    tenantsWithWorkflows: workflows.length,
    tenantsWithFindings,
    totalFindings,
    results
  };
}
