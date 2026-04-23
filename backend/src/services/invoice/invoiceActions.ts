import type { WorkflowConfig, WorkflowStep } from "@/services/invoice/approvalWorkflowService.js";
import type { UserCapabilities } from "@/auth/personaDefaults.js";
import { INVOICE_STATUS, type InvoiceStatus } from "@/types/invoice.js";
import { normalizeTenantRole } from "@/models/core/TenantUserRole.js";

/**
 * Pure, stateless computation of which actions a given actor can perform on a given
 * invoice. Mirrors the authorization the mutation endpoints already enforce, but takes
 * the actor's resolved role + capabilities as input rather than reading the TenantUserRole
 * document — callers should resolve those once per request and reuse.
 *
 * The result is attached to invoice responses as `invoice.actions` so the UI can render
 * action controls without duplicating gating logic or making a second round trip.
 * The server's authorization on the actual mutation endpoints is unchanged; this helper
 * shares logic with that path so visibility and enforcement stay consistent.
 *
 * Rules mirrored:
 * - canApprove / canReject: `canApproveInvoices` capability + invoice is AWAITING_APPROVAL
 *   + workflow-step eligibility (role / persona / userId / capability / any_member).
 * - canEditFields: `canEditInvoiceFields` capability + status !== EXPORTED.
 *   (Mirrors `requireCap("canEditInvoiceFields")` on PATCH /invoices/:id plus the
 *   explicit `status === EXPORTED` check in the handler.)
 * - canDismissRiskSignals: (`canSignOffCompliance` || `canEditInvoiceFields`) +
 *   status !== EXPORTED. Dismissing a risk signal flows through the same PATCH handler
 *   that the `canEditInvoiceFields` capability gates; sign-off users can also dismiss.
 * - canOverrideGlCode: `canOverrideGlCode` capability + status !== EXPORTED.
 * - canOverrideTds: `canOverrideTds` capability + status !== EXPORTED.
 */
export interface InvoiceActions {
  canApprove: boolean;
  canReject: boolean;
  canEditFields: boolean;
  canDismissRiskSignals: boolean;
  canOverrideGlCode: boolean;
  canOverrideTds: boolean;
}

export interface InvoiceActionActor {
  userId: string;
  role: string;
  capabilities: Pick<
    UserCapabilities,
    | "canApproveInvoices"
    | "canSignOffCompliance"
    | "canEditInvoiceFields"
    | "canOverrideGlCode"
    | "canOverrideTds"
  > &
    Partial<UserCapabilities>;
}

export interface InvoiceActionInvoice {
  status: InvoiceStatus | string;
  workflowState?: { currentStep?: number | null } | null;
}

const ALL_HIDDEN: InvoiceActions = {
  canApprove: false,
  canReject: false,
  canEditFields: false,
  canDismissRiskSignals: false,
  canOverrideGlCode: false,
  canOverrideTds: false
};

function safeNormalize(role: string | undefined | null): string | null {
  if (!role) return null;
  try {
    return normalizeTenantRole(role);
  } catch {
    return null;
  }
}

function findCurrentStep(workflow: WorkflowConfig, currentStep: number | null | undefined): WorkflowStep | undefined {
  if (typeof currentStep !== "number" || currentStep <= 0) return undefined;
  if (!Array.isArray(workflow.steps)) return undefined;
  return workflow.steps.find((s) => s.order === currentStep);
}

function actorMatchesStep(actor: InvoiceActionActor, step: WorkflowStep): boolean {
  const caps = actor.capabilities;
  if (step.type === "compliance_signoff" && caps.canSignOffCompliance !== true) {
    return false;
  }

  switch (step.approverType) {
    case "specific_users":
      return (step.approverUserIds ?? []).includes(actor.userId);
    case "role": {
      if (!step.approverRole) return false;
      const actorRole = safeNormalize(actor.role);
      const stepRole = safeNormalize(step.approverRole);
      return actorRole !== null && stepRole !== null && actorRole === stepRole;
    }
    case "persona": {
      if (!step.approverPersona) return false;
      const actorRole = safeNormalize(actor.role);
      const personaRole = safeNormalize(step.approverPersona);
      return actorRole !== null && personaRole !== null && actorRole === personaRole;
    }
    case "capability": {
      const capName = step.approverCapability;
      if (!capName) return false;
      return (caps as Record<string, unknown>)[capName] === true;
    }
    case "any_member": {
      const actorRole = safeNormalize(actor.role);
      return actorRole !== null && actorRole !== "PLATFORM_ADMIN";
    }
    default:
      return false;
  }
}

function computeApproveReject(
  actor: InvoiceActionActor,
  invoice: InvoiceActionInvoice,
  workflow: WorkflowConfig | null | undefined
): { canApprove: boolean; canReject: boolean } {
  if (actor.capabilities.canApproveInvoices !== true) return { canApprove: false, canReject: false };
  if (invoice.status !== INVOICE_STATUS.AWAITING_APPROVAL) return { canApprove: false, canReject: false };

  if (!workflow || workflow.enabled === false) {
    return { canApprove: true, canReject: true };
  }

  const step = findCurrentStep(workflow, invoice.workflowState?.currentStep ?? null);
  if (!step) return { canApprove: false, canReject: false };
  if (!actorMatchesStep(actor, step)) return { canApprove: false, canReject: false };
  return { canApprove: true, canReject: true };
}

export function computeInvoiceActions(
  actor: InvoiceActionActor | null | undefined,
  invoice: InvoiceActionInvoice | null | undefined,
  workflow: WorkflowConfig | null | undefined
): InvoiceActions {
  if (!actor || !invoice) return { ...ALL_HIDDEN };

  const { canApprove, canReject } = computeApproveReject(actor, invoice, workflow);

  const notExported = invoice.status !== INVOICE_STATUS.EXPORTED;
  const caps = actor.capabilities;
  const canEditFields = notExported && caps.canEditInvoiceFields === true;
  const canDismissRiskSignals =
    notExported && (caps.canSignOffCompliance === true || caps.canEditInvoiceFields === true);
  const canOverrideGlCode = notExported && caps.canOverrideGlCode === true;
  const canOverrideTds = notExported && caps.canOverrideTds === true;

  return {
    canApprove,
    canReject,
    canEditFields,
    canDismissRiskSignals,
    canOverrideGlCode,
    canOverrideTds
  };
}
