import {
  computeInvoiceActions,
  type InvoiceActionActor,
  type InvoiceActionInvoice,
  type InvoiceActions
} from "@/services/invoice/invoiceActions.js";
import type { WorkflowConfig, WorkflowStep } from "@/services/invoice/approvalWorkflowService.js";
import type { UserCapabilities } from "@/auth/personaDefaults.js";

function caps(overrides: Partial<UserCapabilities> = {}): InvoiceActionActor["capabilities"] {
  return {
    canApproveInvoices: true,
    canSignOffCompliance: false,
    canEditInvoiceFields: false,
    canOverrideGlCode: false,
    canOverrideTds: false,
    ...overrides
  };
}

function actor(overrides: Partial<InvoiceActionActor> = {}): InvoiceActionActor {
  return {
    userId: "u1",
    role: "senior_accountant",
    capabilities: caps(),
    ...overrides
  };
}

function step(overrides: Partial<WorkflowStep> = {}): WorkflowStep {
  return {
    order: 1,
    name: "Step",
    approverType: "any_member",
    rule: "any",
    ...overrides
  };
}

function workflow(steps: WorkflowStep[], enabled = true): WorkflowConfig {
  return {
    enabled,
    mode: "advanced",
    simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
    steps
  };
}

function invoice(overrides: Partial<InvoiceActionInvoice> = {}): InvoiceActionInvoice {
  return {
    status: "AWAITING_APPROVAL",
    workflowState: { currentStep: 1 },
    ...overrides
  };
}

const ALL_HIDDEN: InvoiceActions = {
  canApprove: false,
  canReject: false,
  canEditFields: false,
  canDismissRiskSignals: false,
  canOverrideGlCode: false,
  canOverrideTds: false
};

function expectApproveReject(result: InvoiceActions, canApprove: boolean, canReject: boolean): void {
  expect(result.canApprove).toBe(canApprove);
  expect(result.canReject).toBe(canReject);
}

describe("computeInvoiceActions", () => {
  describe("capability layer — approve/reject", () => {
    it("hides everything when actor is null", () => {
      expect(computeInvoiceActions(null, invoice(), workflow([step()]))).toEqual(ALL_HIDDEN);
    });

    it("hides everything when invoice is null", () => {
      expect(computeInvoiceActions(actor(), null, workflow([step()]))).toEqual(ALL_HIDDEN);
    });

    it("hides approve/reject when capabilities missing canApproveInvoices", () => {
      const a = actor({ capabilities: caps({ canApproveInvoices: false }) });
      expectApproveReject(computeInvoiceActions(a, invoice(), workflow([step()])), false, false);
    });
  });

  describe("invoice-status gating — approve/reject", () => {
    it.each(["PENDING", "PARSED", "NEEDS_REVIEW", "APPROVED", "EXPORTED", "FAILED_OCR", "FAILED_PARSE"] as const)(
      "hides approve/reject when invoice status is %s (not AWAITING_APPROVAL)",
      (status) => {
        expectApproveReject(computeInvoiceActions(actor(), invoice({ status }), workflow([step()])), false, false);
      }
    );

    it("passes the status gate for approve/reject when AWAITING_APPROVAL", () => {
      expectApproveReject(
        computeInvoiceActions(actor(), invoice({ status: "AWAITING_APPROVAL" }), workflow([step()])),
        true,
        true
      );
    });
  });

  describe("workflow fallback", () => {
    it("allows approve/reject on capability-only fallback when workflow is null (no config)", () => {
      expectApproveReject(computeInvoiceActions(actor(), invoice(), null), true, true);
    });

    it("allows approve/reject on capability-only fallback when workflow is disabled", () => {
      expectApproveReject(computeInvoiceActions(actor(), invoice(), workflow([step()], false)), true, true);
    });
  });

  describe("workflow-step gating: any_member", () => {
    it("allows any tenant member", () => {
      const wf = workflow([step({ approverType: "any_member" })]);
      expectApproveReject(computeInvoiceActions(actor({ role: "ap_clerk" }), invoice(), wf), true, true);
    });

    it("denies platform admin (not a tenant member for approval purposes)", () => {
      const wf = workflow([step({ approverType: "any_member" })]);
      expectApproveReject(computeInvoiceActions(actor({ role: "PLATFORM_ADMIN" }), invoice(), wf), false, false);
    });
  });

  describe("workflow-step gating: role", () => {
    it("allows matching role", () => {
      const wf = workflow([step({ approverType: "role", approverRole: "ca" })]);
      expectApproveReject(computeInvoiceActions(actor({ role: "ca" }), invoice(), wf), true, true);
    });

    it("denies mismatched role", () => {
      const wf = workflow([step({ approverType: "role", approverRole: "ca" })]);
      expectApproveReject(computeInvoiceActions(actor({ role: "senior_accountant" }), invoice(), wf), false, false);
    });

    it("denies when approverRole is missing", () => {
      const wf = workflow([step({ approverType: "role" })]);
      expectApproveReject(computeInvoiceActions(actor({ role: "ca" }), invoice(), wf), false, false);
    });

  });

  describe("workflow-step gating: persona", () => {
    it("allows matching persona", () => {
      const wf = workflow([step({ approverType: "persona", approverPersona: "firm_partner" })]);
      expectApproveReject(computeInvoiceActions(actor({ role: "firm_partner" }), invoice(), wf), true, true);
    });

    it("denies mismatched persona", () => {
      const wf = workflow([step({ approverType: "persona", approverPersona: "firm_partner" })]);
      expectApproveReject(computeInvoiceActions(actor({ role: "ap_clerk" }), invoice(), wf), false, false);
    });

    it("denies when approverPersona is missing", () => {
      const wf = workflow([step({ approverType: "persona" })]);
      expectApproveReject(computeInvoiceActions(actor(), invoice(), wf), false, false);
    });
  });

  describe("workflow-step gating: specific_users", () => {
    it("allows when userId is in the list", () => {
      const wf = workflow([step({ approverType: "specific_users", approverUserIds: ["other", "u1"] })]);
      expectApproveReject(computeInvoiceActions(actor({ userId: "u1" }), invoice(), wf), true, true);
    });

    it("denies when userId is not in the list", () => {
      const wf = workflow([step({ approverType: "specific_users", approverUserIds: ["other"] })]);
      expectApproveReject(computeInvoiceActions(actor({ userId: "u1" }), invoice(), wf), false, false);
    });

    it("denies when approverUserIds is missing", () => {
      const wf = workflow([step({ approverType: "specific_users" })]);
      expectApproveReject(computeInvoiceActions(actor({ userId: "u1" }), invoice(), wf), false, false);
    });
  });

  describe("workflow-step gating: capability", () => {
    it("allows when user has the required capability", () => {
      const wf = workflow([step({ approverType: "capability", approverCapability: "canSignOffCompliance" })]);
      const a = actor({ capabilities: caps({ canSignOffCompliance: true }) });
      expectApproveReject(computeInvoiceActions(a, invoice(), wf), true, true);
    });

    it("denies when user lacks the required capability", () => {
      const wf = workflow([step({ approverType: "capability", approverCapability: "canSignOffCompliance" })]);
      expectApproveReject(computeInvoiceActions(actor(), invoice(), wf), false, false);
    });

    it("denies when approverCapability is missing", () => {
      const wf = workflow([step({ approverType: "capability" })]);
      expectApproveReject(computeInvoiceActions(actor(), invoice(), wf), false, false);
    });
  });

  describe("compliance_signoff step type", () => {
    it("requires canSignOffCompliance regardless of role match", () => {
      const wf = workflow([step({ type: "compliance_signoff", approverType: "role", approverRole: "ca" })]);
      const a = actor({ role: "ca", capabilities: caps({ canSignOffCompliance: false }) });
      expectApproveReject(computeInvoiceActions(a, invoice(), wf), false, false);
    });

    it("allows when user has canSignOffCompliance and matches role", () => {
      const wf = workflow([step({ type: "compliance_signoff", approverType: "role", approverRole: "ca" })]);
      const a = actor({ role: "ca", capabilities: caps({ canSignOffCompliance: true }) });
      expectApproveReject(computeInvoiceActions(a, invoice(), wf), true, true);
    });

    it("denies compliance_signoff capability step without canSignOffCompliance", () => {
      const wf = workflow([step({ type: "compliance_signoff", approverType: "capability", approverCapability: "canSignOffCompliance" })]);
      const a = actor({ capabilities: caps({ canSignOffCompliance: false }) });
      expectApproveReject(computeInvoiceActions(a, invoice(), wf), false, false);
    });
  });

  describe("workflow step lookup by currentStep", () => {
    it("picks the step matching workflowState.currentStep", () => {
      const wf = workflow([
        step({ order: 1, approverType: "role", approverRole: "ap_clerk" }),
        step({ order: 2, approverType: "role", approverRole: "ca" })
      ]);
      const inv = invoice({ workflowState: { currentStep: 2 } });
      expectApproveReject(computeInvoiceActions(actor({ role: "ca" }), inv, wf), true, true);
      expectApproveReject(computeInvoiceActions(actor({ role: "ap_clerk" }), inv, wf), false, false);
    });

    it("hides approve/reject when workflowState.currentStep is missing", () => {
      const wf = workflow([step()]);
      const inv = invoice({ workflowState: {} });
      expectApproveReject(computeInvoiceActions(actor(), inv, wf), false, false);
    });

    it("hides approve/reject when workflowState.currentStep doesn't match any step in config", () => {
      const wf = workflow([step({ order: 1 })]);
      const inv = invoice({ workflowState: { currentStep: 99 } });
      expectApproveReject(computeInvoiceActions(actor(), inv, wf), false, false);
    });

    it("hides approve/reject when workflow has no steps", () => {
      const wf = workflow([]);
      expectApproveReject(computeInvoiceActions(actor(), invoice(), wf), false, false);
    });
  });

  // ---------------------------------------------------------------------------
  // Per-invoice capability actions (edit / dismiss / override GL / override TDS)
  //
  // Rules mirrored from the PATCH /invoices/:id handler:
  //   - canEditFields: capabilities.canEditInvoiceFields === true && status !== EXPORTED
  //   - canDismissRiskSignals: (canSignOffCompliance || canEditInvoiceFields) && status !== EXPORTED
  //   - canOverrideGlCode: capabilities.canOverrideGlCode === true && status !== EXPORTED
  //   - canOverrideTds: capabilities.canOverrideTds === true && status !== EXPORTED
  // ---------------------------------------------------------------------------

  describe("canEditFields", () => {
    it.each([
      ["PARSED", true, true],
      ["NEEDS_REVIEW", true, true],
      ["AWAITING_APPROVAL", true, true],
      ["APPROVED", true, true],
      ["EXPORTED", true, false],
      ["PARSED", false, false],
      ["EXPORTED", false, false]
    ] as const)(
      "status=%s canEditInvoiceFields=%s => canEditFields=%s",
      (status, hasCap, expected) => {
        const a = actor({ capabilities: caps({ canEditInvoiceFields: hasCap }) });
        expect(computeInvoiceActions(a, invoice({ status }), null).canEditFields).toBe(expected);
      }
    );

  });

  describe("canDismissRiskSignals", () => {
    it.each([
      // status, canSignOffCompliance, canEditInvoiceFields, expected
      ["PARSED", true, false, true],
      ["PARSED", false, true, true],
      ["PARSED", true, true, true],
      ["PARSED", false, false, false],
      ["EXPORTED", true, true, false],
      ["EXPORTED", false, false, false],
      ["AWAITING_APPROVAL", true, false, true],
      ["APPROVED", false, true, true]
    ] as const)(
      "status=%s signoff=%s editFields=%s => canDismissRiskSignals=%s",
      (status, signoff, editFields, expected) => {
        const a = actor({
          capabilities: caps({ canSignOffCompliance: signoff, canEditInvoiceFields: editFields })
        });
        expect(computeInvoiceActions(a, invoice({ status }), null).canDismissRiskSignals).toBe(expected);
      }
    );
  });

  describe("canOverrideGlCode", () => {
    it.each([
      ["PARSED", true, true],
      ["AWAITING_APPROVAL", true, true],
      ["APPROVED", true, true],
      ["EXPORTED", true, false],
      ["PARSED", false, false],
      ["EXPORTED", false, false]
    ] as const)(
      "status=%s canOverrideGlCode cap=%s => canOverrideGlCode=%s",
      (status, hasCap, expected) => {
        const a = actor({ capabilities: caps({ canOverrideGlCode: hasCap }) });
        expect(computeInvoiceActions(a, invoice({ status }), null).canOverrideGlCode).toBe(expected);
      }
    );

  });

  describe("canOverrideTds", () => {
    it.each([
      ["PARSED", true, true],
      ["AWAITING_APPROVAL", true, true],
      ["APPROVED", true, true],
      ["EXPORTED", true, false],
      ["PARSED", false, false],
      ["EXPORTED", false, false]
    ] as const)(
      "status=%s canOverrideTds cap=%s => canOverrideTds=%s",
      (status, hasCap, expected) => {
        const a = actor({ capabilities: caps({ canOverrideTds: hasCap }) });
        expect(computeInvoiceActions(a, invoice({ status }), null).canOverrideTds).toBe(expected);
      }
    );

  });

  describe("per-invoice capabilities — independence from approve/reject", () => {
    it("user with canEditInvoiceFields but not canApproveInvoices still gets edit on PARSED invoice", () => {
      const a = actor({
        capabilities: caps({
          canApproveInvoices: false,
          canEditInvoiceFields: true,
          canOverrideGlCode: true,
          canOverrideTds: true
        })
      });
      const result = computeInvoiceActions(a, invoice({ status: "PARSED" }), null);
      expect(result).toEqual({
        canApprove: false,
        canReject: false,
        canEditFields: true,
        canDismissRiskSignals: true,
        canOverrideGlCode: true,
        canOverrideTds: true
      });
    });

    it("EXPORTED invoice hides every per-invoice mutation action regardless of caps", () => {
      const a = actor({
        capabilities: caps({
          canApproveInvoices: true,
          canEditInvoiceFields: true,
          canSignOffCompliance: true,
          canOverrideGlCode: true,
          canOverrideTds: true
        })
      });
      const result = computeInvoiceActions(a, invoice({ status: "EXPORTED" }), null);
      expect(result).toEqual({
        canApprove: false,
        canReject: false,
        canEditFields: false,
        canDismissRiskSignals: false,
        canOverrideGlCode: false,
        canOverrideTds: false
      });
    });
  });
});
