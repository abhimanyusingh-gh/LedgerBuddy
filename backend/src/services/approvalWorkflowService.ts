import { ApprovalWorkflowModel } from "../models/ApprovalWorkflow.js";
import { InvoiceModel } from "../models/Invoice.js";
import { TenantUserRoleModel } from "../models/TenantUserRole.js";
import { HttpError } from "../errors/HttpError.js";
import { logger } from "../utils/logger.js";
import type { AuthenticatedRequestContext } from "../types/auth.js";

interface WorkflowStep {
  order: number;
  name: string;
  approverType: "any_member" | "role" | "specific_users";
  approverRole?: string;
  approverUserIds?: string[];
  rule: "any" | "all";
  condition?: { field: string; operator: string; value: number } | null;
}

export interface WorkflowConfig {
  enabled: boolean;
  mode: "simple" | "advanced";
  simpleConfig: { requireManagerReview: boolean; requireFinalSignoff: boolean };
  steps: WorkflowStep[];
}

interface WorkflowStateData {
  workflowId: string;
  currentStep: number;
  status: string;
  stepResults: Array<{
    step: number;
    name: string;
    action: string;
    userId?: string;
    email?: string;
    role?: string;
    timestamp: Date;
    note?: string;
  }>;
}

function mapStepsFromDoc(steps: Array<{ order: number; name: string; approverType: string; approverRole?: string | null; approverUserIds?: string[]; rule: string; condition?: { field?: string | null; operator?: string | null; value?: number | null } | null }>): WorkflowStep[] {
  return steps.map((s) => ({
    order: s.order,
    name: s.name,
    approverType: s.approverType as WorkflowStep["approverType"],
    approverRole: s.approverRole ?? undefined,
    approverUserIds: s.approverUserIds ?? [],
    rule: s.rule as "any" | "all",
    condition: s.condition?.field ? { field: s.condition.field, operator: s.condition.operator!, value: s.condition.value! } : null
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
        { tenantId, status: "AWAITING_APPROVAL" },
        { $set: { status: "NEEDS_REVIEW" }, $push: { processingIssues: "Approval workflow disabled — returned to review." } }
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
    if (step.approverType === "role") {
      return roleRecord?.role === step.approverRole;
    }
    return roleRecord?.role === "MEMBER" || roleRecord?.role === "TENANT_ADMIN";
  }

  evaluateCondition(step: WorkflowStep, invoice: { parsed?: { totalAmountMinor?: number | null } | null }): boolean {
    if (!step.condition?.field) return true;
    if (step.condition.field !== "totalAmountMinor") return true;
    const value = invoice.parsed?.totalAmountMinor;
    if (value === undefined || value === null) return true;
    const threshold = step.condition.value;
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
    if (invoice.status !== "PARSED" && invoice.status !== "NEEDS_REVIEW") return false;

    const firstStep = workflow.steps.find((s) => s.order === 1);
    if (!firstStep) return false;

    const skipFirst = !this.evaluateCondition(firstStep as WorkflowStep, invoice);

    if (skipFirst && workflow.steps.length === 1) {
      return false;
    }

    invoice.status = "AWAITING_APPROVAL";
    invoice.set("workflowState", {
      workflowId: String(workflow._id),
      currentStep: skipFirst ? 2 : 1,
      status: "in_progress",
      stepResults: skipFirst ? [{ step: 1, name: firstStep.name, action: "skipped", timestamp: new Date(), note: "Condition not met" }] : []
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
    if (invoice.status !== "AWAITING_APPROVAL") {
      throw new HttpError("Invoice is not awaiting approval.", 400, "invoice_not_awaiting");
    }

    const workflowState = invoice.get("workflowState") as WorkflowStateData | undefined;
    if (!workflowState || workflowState.status !== "in_progress") {
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
      (r) => r.step === workflowState.currentStep && r.action === "approved" && r.userId === authContext.userId
    );
    if (alreadyApprovedThisStep) {
      throw new HttpError("You have already approved this step.", 400, "already_approved");
    }

    workflowState.stepResults.push({
      step: workflowState.currentStep,
      name: currentStep.name,
      action: "approved",
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
        requiredCount = await TenantUserRoleModel.countDocuments({ tenantId: authContext.tenantId, role: currentStep.approverRole });
      } else {
        requiredCount = await TenantUserRoleModel.countDocuments({ tenantId: authContext.tenantId, role: { $in: ["MEMBER", "TENANT_ADMIN"] } });
      }
      const approvedCount = workflowState.stepResults.filter((r) => r.step === workflowState.currentStep && r.action === "approved").length;
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
        workflowState.stepResults.push({ step: nextStep, name: step.name, action: "skipped", timestamp: new Date(), note: "Condition not met" });
        nextStep++;
        continue;
      }
      break;
    }

    if (nextStep > maxStep) {
      workflowState.currentStep = 0;
      workflowState.status = "approved";
      invoice.status = "APPROVED";
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
    if (invoice.status !== "AWAITING_APPROVAL") {
      throw new HttpError("Invoice is not awaiting approval.", 400, "invoice_not_awaiting");
    }

    const workflowState = invoice.get("workflowState") as WorkflowStateData | undefined;
    if (!workflowState || workflowState.status !== "in_progress") {
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
      action: "rejected",
      userId: authContext.userId,
      email: authContext.email,
      role: authContext.role,
      timestamp: new Date(),
      note: reason
    });
    workflowState.status = "rejected";

    invoice.status = "NEEDS_REVIEW";
    invoice.set("workflowState", workflowState);
    invoice.processingIssues.push(`Rejected at step ${workflowState.currentStep} by ${authContext.email}: ${reason}`);
    await invoice.save();
  }

  async resetWorkflowOnEdit(invoiceId: string, tenantId: string): Promise<void> {
    const invoice = await InvoiceModel.findOne({ _id: invoiceId, tenantId });
    if (!invoice || invoice.status !== "AWAITING_APPROVAL") return;

    const workflowState = invoice.get("workflowState") as WorkflowStateData | undefined;
    if (!workflowState || workflowState.status !== "in_progress") return;

    invoice.status = "NEEDS_REVIEW";
    invoice.set("workflowState", undefined);
    invoice.processingIssues.push("Approval workflow reset — parsed fields modified.");
    await invoice.save();
  }
}
