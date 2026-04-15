import { ApprovalWorkflowModel, WORKFLOW_STATUS, WORKFLOW_STEP_ACTION, type WorkflowStatus, type WorkflowStepAction } from "@/models/invoice/ApprovalWorkflow.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { TenantAssignableRoles, TenantUserRoleModel, normalizeTenantRole } from "@/models/core/TenantUserRole.js";
import { HttpError } from "@/errors/HttpError.js";
import { logger } from "@/utils/logger.js";
import type { AuthenticatedRequestContext } from "@/types/auth.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import type { ApprovalStepType, ApproverType, ApprovalRule, ApprovalWorkflowMode } from "@/types/approvalWorkflow.js";

interface WorkflowStep {
  order: number;
  name: string;
  type?: ApprovalStepType;
  approverType: ApproverType;
  approverRole?: string;
  approverUserIds?: string[];
  approverPersona?: string;
  approverCapability?: string;
  rule: ApprovalRule;
  condition?: { field: string; operator: string; value: unknown } | null;
  timeoutHours?: number | null;
  escalateTo?: string | null;
}

interface WorkflowConfig {
  enabled: boolean;
  mode: ApprovalWorkflowMode;
  simpleConfig: { requireManagerReview: boolean; requireFinalSignoff: boolean };
  steps: WorkflowStep[];
}

interface WorkflowStateData {
  workflowId: string;
  currentStep: number;
  status: WorkflowStatus;
  stepResults: Array<{
    step: number;
    name: string;
    action: WorkflowStepAction;
    userId?: string;
    email?: string;
    role?: string;
    timestamp: Date;
    note?: string;
  }>;
}

const ANY_MEMBER_DB_ROLES = [...TenantAssignableRoles];

function mapStepsFromDoc(steps: Array<{
  order: number;
  name: string;
  type?: ApprovalStepType | null;
  approverType: string;
  approverRole?: string | null;
  approverUserIds?: string[];
  approverPersona?: string | null;
  approverCapability?: string | null;
  rule: string;
  condition?: { field?: string | null; operator?: string | null; value?: unknown } | null;
  timeoutHours?: number | null;
  escalateTo?: string | null;
}>): WorkflowStep[] {
  return steps.map((s) => ({
    order: s.order,
    name: s.name,
    type: s.type ?? "approval",
    approverType: s.approverType as WorkflowStep["approverType"],
    approverRole: s.approverRole ?? undefined,
    approverUserIds: s.approverUserIds ?? [],
    approverPersona: s.approverPersona ?? undefined,
    approverCapability: s.approverCapability ?? undefined,
    rule: s.rule as ApprovalRule,
    condition: s.condition?.field
      ? { field: s.condition.field, operator: s.condition.operator!, value: s.condition.value! }
      : null,
    timeoutHours: s.timeoutHours ?? null,
    escalateTo: s.escalateTo ?? null
  }));
}

export class ApprovalWorkflowService {
  async getWorkflowConfig(tenantId: string): Promise<WorkflowConfig | null> {
    const doc = await ApprovalWorkflowModel.findOne({ tenantId }).lean();
    if (!doc) return null;
    return {
      enabled: doc.enabled,
      mode: doc.mode,
      simpleConfig: {
        requireManagerReview: doc.simpleConfig?.requireManagerReview ?? false,
        requireFinalSignoff: doc.simpleConfig?.requireFinalSignoff ?? false
      },
      steps: mapStepsFromDoc(doc.steps ?? [])
    };
  }

  async saveWorkflowConfig(tenantId: string, config: WorkflowConfig, userId: string): Promise<WorkflowConfig> {
    const steps = config.mode === "simple" ? this.buildSimpleSteps(config.simpleConfig) : config.steps;

    const doc = await ApprovalWorkflowModel.findOneAndUpdate(
      { tenantId },
      { tenantId, enabled: config.enabled, mode: config.mode, simpleConfig: config.simpleConfig, steps, updatedBy: userId },
      { upsert: true, new: true }
    ).lean();

    if (config.enabled === false) {
      const result = await InvoiceModel.updateMany(
        { tenantId, status: INVOICE_STATUS.AWAITING_APPROVAL },
        {
          $set: { status: INVOICE_STATUS.NEEDS_REVIEW },
          $unset: { workflowState: "" },
          $push: { processingIssues: "Approval workflow disabled — returned to review." }
        }
      );
      if (result.modifiedCount > 0) {
        logger.info("workflow.disabled.invoices_reverted", { tenantId, count: result.modifiedCount });
      }
    }

    return {
      enabled: doc.enabled,
      mode: doc.mode,
      simpleConfig: {
        requireManagerReview: doc.simpleConfig?.requireManagerReview ?? false,
        requireFinalSignoff: doc.simpleConfig?.requireFinalSignoff ?? false
      },
      steps: mapStepsFromDoc(doc.steps ?? [])
    };
  }

  buildSimpleSteps(config: { requireManagerReview: boolean; requireFinalSignoff: boolean }): WorkflowStep[] {
    const steps: WorkflowStep[] = [
      { order: 1, name: "Team member approval", approverType: "any_member", rule: "any" }
    ];
    if (config.requireManagerReview) {
      steps.push({ order: 2, name: "Manager review", approverType: "role", approverRole: "TENANT_ADMIN", rule: "any" });
    }
    if (config.requireFinalSignoff) {
      steps.push({ order: steps.length + 1, name: "Final sign-off", approverType: "role", approverRole: "TENANT_ADMIN", rule: "any" });
    }
    return steps;
  }

  async isWorkflowEnabled(tenantId: string): Promise<boolean> {
    const doc = await ApprovalWorkflowModel.findOne({ tenantId, enabled: true }).select({ _id: 1 }).lean();
    return !!doc;
  }

  async canUserApproveStep(userId: string, tenantId: string, step: WorkflowStep): Promise<boolean> {
    if (step.approverType === "specific_users") {
      return (step.approverUserIds ?? []).includes(userId);
    }
    const roleRecord = await TenantUserRoleModel.findOne({ tenantId, userId }).lean();
    if (!roleRecord) return false;
    const userRole = normalizeTenantRole(roleRecord.role);
    if (step.approverType === "role") {
      if (!step.approverRole) {
        return false;
      }
      return userRole === normalizeTenantRole(step.approverRole);
    }
    if (step.approverType === "persona") {
      if (!step.approverPersona) {
        return false;
      }
      return userRole === normalizeTenantRole(step.approverPersona);
    }
    if (step.approverType === "capability") {
      const capabilities = (roleRecord as Record<string, unknown>).capabilities as Record<string, boolean> | undefined;
      return capabilities?.[step.approverCapability ?? ""] === true;
    }
    return userRole !== "PLATFORM_ADMIN";
  }

  evaluateCondition(step: WorkflowStep, invoice: { parsed?: { totalAmountMinor?: number | null } | null; compliance?: unknown }): boolean {
    if (!step.condition?.field) return true;
    const field = step.condition.field;

    let value: unknown;
    if (field === "totalAmountMinor") {
      value = invoice.parsed?.totalAmountMinor;
    } else if (field === "tdsAmountMinor") {
      const comp = invoice.compliance as Record<string, unknown> | null | undefined;
      value = (comp?.tds as Record<string, unknown> | undefined)?.amountMinor;
    } else if (field === "riskSignalMaxSeverity") {
      const comp = invoice.compliance as Record<string, unknown> | null | undefined;
      const signals = comp?.riskSignals as Array<{ severity: string }> | undefined;
      if (signals && signals.length > 0) {
        const severityOrder: Record<string, number> = { critical: 3, warning: 2, info: 1 };
        value = signals.reduce((max, s) => Math.max(max, severityOrder[s.severity] ?? 0), 0);
      }
    } else if (field === "glCodeSource") {
      const comp = invoice.compliance as Record<string, unknown> | null | undefined;
      value = (comp?.glCode as Record<string, unknown> | undefined)?.source;
    } else {
      return true;
    }

    if (value === undefined || value === null) return true;
    const threshold = step.condition.value;

    if (step.condition.operator === "eq") return value === threshold;
    if (step.condition.operator === "in") return Array.isArray(threshold) && threshold.includes(value);

    if (typeof value !== "number" || typeof threshold !== "number") return true;
    switch (step.condition.operator) {
      case "gt": return value > threshold;
      case "gte": return value >= threshold;
      case "lt": return value < threshold;
      case "lte": return value <= threshold;
      default: return true;
    }
  }

  async initiateWorkflow(invoiceId: string, tenantId: string): Promise<boolean> {
    const workflow = await ApprovalWorkflowModel.findOne({ tenantId, enabled: true }).lean();
    if (!workflow || workflow.steps.length === 0) return false;

    const invoice = await InvoiceModel.findOne({ _id: invoiceId, tenantId });
    if (!invoice) return false;
    if (invoice.status !== INVOICE_STATUS.PARSED && invoice.status !== INVOICE_STATUS.NEEDS_REVIEW) return false;

    const firstStep = workflow.steps.find((s) => s.order === 1);
    if (!firstStep) return false;

    const skipFirst = !this.evaluateCondition(firstStep as WorkflowStep, invoice);

    if (skipFirst && workflow.steps.length === 1) {
      return false;
    }

    invoice.status = INVOICE_STATUS.AWAITING_APPROVAL;
    invoice.set("workflowState", {
      workflowId: String(workflow._id),
      currentStep: skipFirst ? 2 : 1,
      status: WORKFLOW_STATUS.IN_PROGRESS,
      stepResults: skipFirst ? [{ step: 1, name: firstStep.name, action: WORKFLOW_STEP_ACTION.SKIPPED, timestamp: new Date(), note: "Condition not met" }] : []
    });
    invoice.processingIssues.push("Approval workflow initiated.");
    await invoice.save();
    return true;
  }

  async approveStep(invoiceId: string, authContext: AuthenticatedRequestContext): Promise<{ advanced: boolean; fullyApproved: boolean }> {
    const invoice = await InvoiceModel.findOne({ _id: invoiceId, tenantId: authContext.tenantId });
    if (!invoice) {
      throw new HttpError("Invoice not found.", 404, "invoice_not_found");
    }
    if (invoice.status !== INVOICE_STATUS.AWAITING_APPROVAL) {
      throw new HttpError("Invoice is not awaiting approval.", 400, "invoice_not_awaiting");
    }

    const workflowState = invoice.get("workflowState") as WorkflowStateData | undefined;
    if (!workflowState || workflowState.status !== WORKFLOW_STATUS.IN_PROGRESS) {
      throw new HttpError("No active workflow for this invoice.", 400, "no_active_workflow");
    }

    const workflow = await ApprovalWorkflowModel.findById(workflowState.workflowId).lean();
    if (!workflow) {
      throw new HttpError("Workflow configuration not found.", 404, "workflow_missing");
    }

    const currentStep = workflow.steps.find((s) => s.order === workflowState.currentStep);
    if (!currentStep) {
      throw new HttpError("Current workflow step not found.", 400, "step_missing");
    }

    const canApprove = await this.canUserApproveStep(authContext.userId, authContext.tenantId, currentStep as WorkflowStep);
    if (!canApprove) {
      throw new HttpError("You are not eligible to approve this step.", 403, "not_eligible");
    }

    const alreadyApprovedThisStep = workflowState.stepResults.some(
      (r) => r.step === workflowState.currentStep && r.action === WORKFLOW_STEP_ACTION.APPROVED && r.userId === authContext.userId
    );
    if (alreadyApprovedThisStep) {
      throw new HttpError("You have already approved this step.", 400, "already_approved");
    }

    workflowState.stepResults.push({
      step: workflowState.currentStep,
      name: currentStep.name,
      action: WORKFLOW_STEP_ACTION.APPROVED,
      userId: authContext.userId,
      email: authContext.email,
      role: authContext.role,
      timestamp: new Date()
    });

    if (currentStep.rule === "all") {
      let requiredCount = 0;
      if (currentStep.approverType === "specific_users") {
        requiredCount = (currentStep.approverUserIds ?? []).length;
      } else if (currentStep.approverType === "role") {
        requiredCount = await TenantUserRoleModel.countDocuments({
          tenantId: authContext.tenantId,
          role: normalizeTenantRole(currentStep.approverRole ?? "")
        });
      } else if (currentStep.approverType === "persona") {
        requiredCount = await TenantUserRoleModel.countDocuments({
          tenantId: authContext.tenantId,
          role: normalizeTenantRole(currentStep.approverPersona ?? "")
        });
      } else {
        requiredCount = await TenantUserRoleModel.countDocuments({
          tenantId: authContext.tenantId,
          role: { $in: ANY_MEMBER_DB_ROLES }
        });
      }
      const approvedCount = workflowState.stepResults.filter((r) => r.step === workflowState.currentStep && r.action === WORKFLOW_STEP_ACTION.APPROVED).length;
      if (approvedCount < requiredCount) {
        invoice.set("workflowState", workflowState);
        invoice.processingIssues.push(`Workflow step ${workflowState.currentStep} partial approval by ${authContext.email} (${approvedCount}/${requiredCount})`);
        await invoice.save();
        return { advanced: false, fullyApproved: false };
      }
    }

    const maxStep = Math.max(...workflow.steps.map((s) => s.order));
    let nextStep = workflowState.currentStep + 1;

    while (nextStep <= maxStep) {
      const step = workflow.steps.find((s) => s.order === nextStep);
      if (!step) { nextStep++; continue; }
      if (!this.evaluateCondition(step as WorkflowStep, invoice)) {
        workflowState.stepResults.push({ step: nextStep, name: step.name, action: WORKFLOW_STEP_ACTION.SKIPPED, timestamp: new Date(), note: "Condition not met" });
        nextStep++;
        continue;
      }
      break;
    }

    if (nextStep > maxStep) {
      workflowState.currentStep = 0;
      workflowState.status = WORKFLOW_STATUS.APPROVED;
      invoice.status = INVOICE_STATUS.APPROVED;
      invoice.set("approval", {
        approvedBy: authContext.email,
        approvedAt: new Date(),
        userId: authContext.userId,
        email: authContext.email,
        role: authContext.role
      });
      invoice.processingIssues.push(`Workflow completed: approved by ${authContext.email} at step ${currentStep.order}`);
    } else {
      workflowState.currentStep = nextStep;
      invoice.processingIssues.push(`Workflow step ${currentStep.order} approved by ${authContext.email}, advancing to step ${nextStep}`);
    }

    invoice.set("workflowState", workflowState);
    await invoice.save();

    return { advanced: true, fullyApproved: nextStep > maxStep };
  }

  async rejectStep(invoiceId: string, reason: string, authContext: AuthenticatedRequestContext): Promise<void> {
    const invoice = await InvoiceModel.findOne({ _id: invoiceId, tenantId: authContext.tenantId });
    if (!invoice) {
      throw new HttpError("Invoice not found.", 404, "invoice_not_found");
    }
    if (invoice.status !== INVOICE_STATUS.AWAITING_APPROVAL) {
      throw new HttpError("Invoice is not awaiting approval.", 400, "invoice_not_awaiting");
    }

    const workflowState = invoice.get("workflowState") as WorkflowStateData | undefined;
    if (!workflowState || workflowState.status !== WORKFLOW_STATUS.IN_PROGRESS) {
      throw new HttpError("No active workflow for this invoice.", 400, "no_active_workflow");
    }

    const workflow = await ApprovalWorkflowModel.findById(workflowState.workflowId).lean();
    if (!workflow) {
      throw new HttpError("Workflow configuration not found.", 404, "workflow_missing");
    }
    const currentStep = workflow.steps.find((s) => s.order === workflowState.currentStep);
    if (!currentStep) {
      throw new HttpError("Current workflow step not found.", 400, "step_missing");
    }

    const canApprove = await this.canUserApproveStep(authContext.userId, authContext.tenantId, currentStep as WorkflowStep);
    if (!canApprove) {
      throw new HttpError("You are not eligible to reject this step.", 403, "not_eligible");
    }

    workflowState.stepResults.push({
      step: workflowState.currentStep,
      name: currentStep?.name ?? `Step ${workflowState.currentStep}`,
      action: WORKFLOW_STEP_ACTION.REJECTED,
      userId: authContext.userId,
      email: authContext.email,
      role: authContext.role,
      timestamp: new Date(),
      note: reason
    });
    workflowState.status = WORKFLOW_STATUS.REJECTED;

    invoice.status = INVOICE_STATUS.NEEDS_REVIEW;
    invoice.set("workflowState", workflowState);
    invoice.processingIssues.push(`Rejected at step ${workflowState.currentStep} by ${authContext.email}: ${reason}`);
    await invoice.save();
  }

  async resetWorkflowOnEdit(invoiceId: string, tenantId: string): Promise<void> {
    const invoice = await InvoiceModel.findOne({ _id: invoiceId, tenantId });
    if (!invoice || invoice.status !== INVOICE_STATUS.AWAITING_APPROVAL) return;

    const workflowState = invoice.get("workflowState") as WorkflowStateData | undefined;
    if (!workflowState || workflowState.status !== WORKFLOW_STATUS.IN_PROGRESS) return;

    invoice.status = INVOICE_STATUS.NEEDS_REVIEW;
    invoice.set("workflowState", undefined);
    invoice.processingIssues.push("Approval workflow reset — parsed fields modified.");
    await invoice.save();
  }
}
