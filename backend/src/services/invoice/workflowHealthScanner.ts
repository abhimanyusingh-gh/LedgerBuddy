import { ApprovalWorkflowModel } from "@/models/invoice/ApprovalWorkflow.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { TenantModel } from "@/models/core/Tenant.js";
import { findTenantIdsByClientOrgIds } from "@/services/auth/tenantScope.js";
import { APPROVAL_STEP_TYPE, APPROVER_TYPE, type WorkflowStep, type Workflow } from "@/types/approvalWorkflow.js";

interface StepFinding {
  stepOrder: number;
  stepName: string;
  issue: string;
  severity: "error" | "warning";
}

interface TenantWorkflowHealthResult {
  tenantId: string;
  clientOrgId: string;
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
  step: WorkflowStep,
  tenantId: string
): Promise<StepFinding[]> {
  const findings: StepFinding[] = [];

  switch (step.type) {
    case APPROVAL_STEP_TYPE.COMPLIANCE_SIGNOFF: {
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
      break;
    }
    case APPROVAL_STEP_TYPE.ESCALATION:
      if (!step.escalateTo) {
        findings.push({
          stepOrder: step.order,
          stepName: step.name,
          issue: "Step has timeoutHours configured but escalateTo is empty or null",
          severity: "error"
        });
      }
      break;
    default:
      break;
  }

  if (
    step.type !== APPROVAL_STEP_TYPE.ESCALATION &&
    step.timeoutHours !== null &&
    step.timeoutHours !== undefined &&
    step.timeoutHours > 0 &&
    !step.escalateTo
  ) {
    findings.push({
      stepOrder: step.order,
      stepName: step.name,
      issue: "Step has timeoutHours configured but escalateTo is empty or null",
      severity: "error"
    });
  }

  switch (step.approverType) {
    case APPROVER_TYPE.PERSONA: {
      if (step.approverPersona) {
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
      break;
    }
    case APPROVER_TYPE.CAPABILITY: {
      if (step.approverCapability) {
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
      break;
    }
    default:
      break;
  }

  return findings;
}

export async function scanWorkflowForTenant(
  workflow: Workflow,
  tenantId: string,
  tenantName: string
): Promise<TenantWorkflowHealthResult> {
  const findings: StepFinding[] = [];

  for (const step of workflow.steps) {
    const stepFindings = await scanWorkflowStep(step, tenantId);
    findings.push(...stepFindings);
  }

  return {
    tenantId,
    clientOrgId: workflow.clientOrgId,
    tenantName,
    enabled: workflow.enabled,
    mode: workflow.mode,
    stepCount: workflow.steps.length,
    findings
  };
}

export async function scanAllWorkflows(): Promise<WorkflowHealthReport> {
  const workflows = await ApprovalWorkflowModel.find({}).lean();
  // Post hierarchy-pivot: workflows key by `clientOrgId`, tenant is
  // resolved via `ClientOrganization.tenantId`.
  const clientOrgIds = workflows.map((w) => w.clientOrgId);
  const clientOrgToTenant = await findTenantIdsByClientOrgIds(clientOrgIds);
  const uniqueTenantIds = Array.from(new Set(clientOrgToTenant.values()));
  const tenants = await TenantModel.find(
    { _id: { $in: uniqueTenantIds } },
    { name: 1 }
  ).lean();
  const tenantNameMap = new Map<string, string>();
  for (const t of tenants) {
    tenantNameMap.set(String(t._id), t.name);
  }

  const results: TenantWorkflowHealthResult[] = [];
  for (const workflow of workflows) {
    const tenantId = clientOrgToTenant.get(String(workflow.clientOrgId)) ?? "";
    const tenantName = tenantNameMap.get(tenantId) ?? "Unknown";
    const result = await scanWorkflowForTenant(
      {
        clientOrgId: String(workflow.clientOrgId),
        enabled: workflow.enabled,
        mode: workflow.mode,
        steps: workflow.steps as unknown as Workflow["steps"]
      },
      tenantId,
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
