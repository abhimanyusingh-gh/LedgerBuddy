jest.mock("@/models/invoice/ApprovalWorkflow.js", () => ({
  ApprovalWorkflowModel: { find: jest.fn() }
}));

jest.mock("@/models/core/TenantUserRole.js", () => ({
  TenantUserRoleModel: { countDocuments: jest.fn() }
}));

jest.mock("@/models/core/Tenant.js", () => ({
  TenantModel: { find: jest.fn() }
}));

jest.mock("@/models/integration/ClientOrganization.js", () => ({
  ClientOrganizationModel: { find: jest.fn() }
}));

import { ApprovalWorkflowModel } from "@/models/invoice/ApprovalWorkflow.js";
import type { WorkflowStep, Workflow } from "@/types/approvalWorkflow.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { TenantModel } from "@/models/core/Tenant.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { scanWorkflowStep, scanWorkflowForTenant, scanAllWorkflows } from "./workflowHealthScanner.ts";

const mockApprovalWorkflowFind = ApprovalWorkflowModel.find as jest.Mock;
const mockCountDocuments = TenantUserRoleModel.countDocuments as jest.Mock;
const mockTenantFind = TenantModel.find as jest.Mock;
const mockClientOrgFind = ClientOrganizationModel.find as jest.Mock;

function buildStep(overrides: Partial<WorkflowStep> & Pick<WorkflowStep, "order" | "name" | "approverType" | "rule">): WorkflowStep {
  return {
    type: "approval",
    approverUserIds: [],
    ...overrides
  } as WorkflowStep;
}

function buildWorkflow(overrides: Partial<Workflow> & Pick<Workflow, "clientOrgId" | "enabled" | "mode" | "steps">): Workflow {
  return overrides as Workflow;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("scanWorkflowStep", () => {
  it("flags compliance_signoff when no users have canSignOffCompliance", async () => {
    mockCountDocuments.mockResolvedValueOnce(0);
    const step = buildStep({
      order: 1, name: "Compliance Review", type: "compliance_signoff",
      approverType: "any_member", rule: "any"
    });
    const findings = await scanWorkflowStep(step, "tenant-1");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].issue).toContain("canSignOffCompliance");
  });

  it("flags escalation-like step with timeoutHours but no escalateTo", async () => {
    const step = buildStep({
      order: 2, name: "Escalation Step", type: "escalation",
      approverType: "any_member", timeoutHours: 24, escalateTo: null, rule: "any"
    });
    const findings = await scanWorkflowStep(step, "tenant-1");
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
    expect(findings[0].issue).toContain("timeoutHours");
    expect(findings[0].issue).toContain("escalateTo");
  });

  it("flags persona/capability approver type with no matching users (warning severity)", async () => {
    mockCountDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const personaStep = buildStep({
      order: 1, name: "CA Review", type: "approval",
      approverType: "persona", approverPersona: "ca", rule: "any"
    });
    const personaFindings = await scanWorkflowStep(personaStep, "tenant-1");
    expect(personaFindings).toHaveLength(1);
    expect(personaFindings[0].severity).toBe("warning");
    expect(personaFindings[0].issue).toContain("ca");

    const capStep = buildStep({
      order: 3, name: "Export Approval", type: "approval",
      approverType: "capability", approverCapability: "canExportToTally", rule: "any"
    });
    const capFindings = await scanWorkflowStep(capStep, "tenant-1");
    expect(capFindings).toHaveLength(1);
    expect(capFindings[0].severity).toBe("warning");
    expect(capFindings[0].issue).toContain("canExportToTally");
  });

  it.each([
    ["compliance_signoff with users having capability", buildStep({ order: 1, name: "Compliance Review", type: "compliance_signoff", approverType: "any_member", rule: "any" }), 2],
    ["escalation with escalateTo configured", buildStep({ order: 2, name: "Escalation Step", type: "escalation", approverType: "any_member", timeoutHours: 24, escalateTo: "user-admin-1", rule: "any" }), null],
    ["persona with matching users", buildStep({ order: 1, name: "CA Review", type: "approval", approverType: "persona", approverPersona: "ca", rule: "any" }), 3],
    ["standard approval step", buildStep({ order: 1, name: "Basic Approval", type: "approval", approverType: "any_member", rule: "any" }), null],
    ["role-based step", buildStep({ order: 1, name: "Admin Approval", type: "approval", approverType: "role", approverRole: "TENANT_ADMIN", rule: "any" }), null],
  ])("returns no findings for %s", async (_label, step, countOverride) => {
    if (countOverride !== null) mockCountDocuments.mockResolvedValueOnce(countOverride as number);
    const findings = await scanWorkflowStep(step, "tenant-1");
    expect(findings).toHaveLength(0);
  });

  it("flags multiple issues on a single step", async () => {
    mockCountDocuments.mockResolvedValueOnce(0);

    const step = buildStep({
      order: 1,
      name: "Compliance Escalation",
      type: "compliance_signoff",
      approverType: "capability",
      approverCapability: "canSignOffCompliance",
      timeoutHours: 24,
      escalateTo: null,
      rule: "any"
    });

    const findings = await scanWorkflowStep(step, "tenant-1");

    expect(findings.length).toBeGreaterThanOrEqual(2);
    const issues = findings.map((f) => f.issue);
    expect(issues.some((i) => i.includes("canSignOffCompliance capability"))).toBe(true);
    expect(issues.some((i) => i.includes("escalateTo"))).toBe(true);
  });
});

describe("scanWorkflowForTenant", () => {
  it("aggregates findings from all steps", async () => {
    mockCountDocuments
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const workflow = buildWorkflow({
      clientOrgId: "org-1",
      enabled: true,
      mode: "advanced",
      steps: [
        buildStep({ order: 1, name: "Compliance", type: "compliance_signoff", approverType: "any_member", rule: "any" }),
        buildStep({ order: 2, name: "Persona Step", type: "approval", approverType: "persona", approverPersona: "ca", rule: "any" })
      ]
    });

    const result = await scanWorkflowForTenant(workflow, "tenant-1", "Test Corp");

    expect(result.tenantId).toBe("tenant-1");
    expect(result.tenantName).toBe("Test Corp");
    expect(result.enabled).toBe(true);
    expect(result.stepCount).toBe(2);
    expect(result.findings).toHaveLength(2);
  });

  it("returns empty findings for a healthy workflow", async () => {
    const workflow = buildWorkflow({
      clientOrgId: "org-2",
      enabled: true,
      mode: "simple",
      steps: [
        buildStep({ order: 1, name: "Team Approval", type: "approval", approverType: "any_member", rule: "any" })
      ]
    });

    const result = await scanWorkflowForTenant(workflow, "tenant-2", "Healthy Corp");

    expect(result.findings).toHaveLength(0);
  });
});

describe("scanAllWorkflows", () => {
  it("produces a full report across multiple tenants", async () => {
    mockApprovalWorkflowFind.mockReturnValueOnce({
      lean: () => Promise.resolve([
        {
          clientOrgId: "org-1",
          enabled: true,
          mode: "advanced",
          steps: [
            { order: 1, name: "Compliance", type: "compliance_signoff", approverType: "any_member", rule: "any", approverUserIds: [] }
          ]
        },
        {
          clientOrgId: "org-2",
          enabled: false,
          mode: "simple",
          steps: [
            { order: 1, name: "Basic", type: "approval", approverType: "any_member", rule: "any", approverUserIds: [] }
          ]
        }
      ])
    });

    mockClientOrgFind.mockReturnValueOnce({
      lean: () => Promise.resolve([
        { _id: "org-1", tenantId: "t1" },
        { _id: "org-2", tenantId: "t2" }
      ])
    });

    mockTenantFind.mockReturnValueOnce({
      lean: () => Promise.resolve([
        { _id: "t1", name: "Tenant One" },
        { _id: "t2", name: "Tenant Two" }
      ])
    });

    mockCountDocuments.mockResolvedValueOnce(0);

    const report = await scanAllWorkflows();

    expect(report.totalTenants).toBe(2);
    expect(report.tenantsWithWorkflows).toBe(2);
    expect(report.tenantsWithFindings).toBe(1);
    expect(report.totalFindings).toBe(1);
    expect(report.results).toHaveLength(2);
    expect(report.results[0].tenantName).toBe("Tenant One");
    expect(report.results[0].findings).toHaveLength(1);
    expect(report.results[1].tenantName).toBe("Tenant Two");
    expect(report.results[1].findings).toHaveLength(0);
    expect(report.scannedAt).toBeDefined();
  });

  it("returns empty report when no workflows exist", async () => {
    mockApprovalWorkflowFind.mockReturnValueOnce({
      lean: () => Promise.resolve([])
    });

    mockClientOrgFind.mockReturnValueOnce({
      lean: () => Promise.resolve([])
    });

    mockTenantFind.mockReturnValueOnce({
      lean: () => Promise.resolve([])
    });

    const report = await scanAllWorkflows();

    expect(report.totalTenants).toBe(0);
    expect(report.tenantsWithWorkflows).toBe(0);
    expect(report.tenantsWithFindings).toBe(0);
    expect(report.totalFindings).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  it("handles unknown tenant gracefully", async () => {
    mockApprovalWorkflowFind.mockReturnValueOnce({
      lean: () => Promise.resolve([
        {
          clientOrgId: "orphan-org",
          enabled: true,
          mode: "simple",
          steps: [
            { order: 1, name: "Basic", type: "approval", approverType: "any_member", rule: "any", approverUserIds: [] }
          ]
        }
      ])
    });

    mockClientOrgFind.mockReturnValueOnce({
      lean: () => Promise.resolve([])
    });

    mockTenantFind.mockReturnValueOnce({
      lean: () => Promise.resolve([])
    });

    const report = await scanAllWorkflows();

    expect(report.results[0].tenantName).toBe("Unknown");
  });
});
