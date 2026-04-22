/**
 * Tests for the demo-tenant config seed.
 *
 * We mock every Mongoose model as an in-memory store so we can assert the final
 * seeded state without spinning up Mongo. The mocks are intentionally narrow —
 * only the methods the seed helper calls are implemented.
 */

type Store<T extends Record<string, unknown>> = T[];

/* ------------------------------------------------------------------ stores */

const roleStore: Store<{
  tenantId: string;
  userId: string;
  role: string;
  capabilities: Record<string, unknown>;
}> = [];

let complianceStore: Array<Record<string, unknown>> = [];
let tcsStore: Array<Record<string, unknown>> = [];
let notificationStore: Array<Record<string, unknown>> = [];
let exportStore: Array<Record<string, unknown>> = [];
let vendorStore: Array<Record<string, unknown>> = [];
let workflowStore: Array<Record<string, unknown>> = [];

/* ------------------------------------------------------------------ helpers */

function applyUpdate(target: Record<string, unknown>, update: Record<string, unknown>): void {
  const set = (update.$set as Record<string, unknown>) ?? update;
  for (const [key, value] of Object.entries(set)) {
    if (key.startsWith("$")) continue;
    target[key] = value;
  }
  const setOnInsert = update.$setOnInsert as Record<string, unknown> | undefined;
  if (setOnInsert) {
    for (const [key, value] of Object.entries(setOnInsert)) {
      if (!(key in target)) target[key] = value;
    }
  }
}

function upsertInto<T extends Record<string, unknown>>(
  store: T[],
  query: Record<string, unknown>,
  update: Record<string, unknown>
): T {
  let entry = store.find((row) =>
    Object.entries(query).every(([k, v]) => row[k] === v)
  );
  if (!entry) {
    entry = { ...query } as T;
    store.push(entry);
  }
  applyUpdate(entry as Record<string, unknown>, update);
  return entry;
}

/* ------------------------------------------------------------------ mocks */

jest.mock("@/models/core/TenantUserRole.js", () => ({
  TenantAssignableRoles: ["TENANT_ADMIN", "ap_clerk", "senior_accountant", "ca", "audit_clerk"],
  TenantUserRoleModel: {
    updateMany: jest.fn(async (query: { tenantId: string; role: string }, update: { $set: Record<string, unknown> }) => {
      const rows = roleStore.filter((r) => r.tenantId === query.tenantId && r.role === query.role);
      for (const row of rows) {
        for (const [k, v] of Object.entries(update.$set)) {
          if (k.startsWith("capabilities.")) {
            const cap = k.slice("capabilities.".length);
            (row.capabilities as Record<string, unknown>)[cap] = v;
          }
        }
      }
      return { matchedCount: rows.length, modifiedCount: rows.length };
    })
  },
  normalizeTenantRole: (r: string) => r
}));

jest.mock("@/models/core/User.js", () => ({
  UserModel: {
    findOne: jest.fn((query: { email: string }) => ({
      lean: async () => {
        if (query.email === "mahir-cfo@neelam.test") return { _id: "cfo-user-id" };
        if (query.email === "mahir.n@globalhealthx.co") return { _id: "mahir-user-id" };
        return null;
      }
    }))
  }
}));

jest.mock("@/models/integration/TenantComplianceConfig.js", () => ({
  TenantComplianceConfigModel: {
    findOneAndUpdate: jest.fn(async (q: Record<string, unknown>, u: Record<string, unknown>) =>
      upsertInto(complianceStore, q, u)
    )
  }
}));

jest.mock("@/models/integration/TenantTcsConfig.js", () => ({
  TenantTcsConfigModel: {
    findOneAndUpdate: jest.fn(async (q: Record<string, unknown>, u: Record<string, unknown>) =>
      upsertInto(tcsStore, q, u)
    )
  }
}));

jest.mock("@/models/integration/TenantNotificationConfig.js", () => ({
  TenantNotificationConfigModel: {
    findOneAndUpdate: jest.fn(async (q: Record<string, unknown>, u: Record<string, unknown>) =>
      upsertInto(notificationStore, q, u)
    )
  },
  NOTIFICATION_RECIPIENT_TYPES: ["integration_creator", "all_tenant_admins", "specific_user"]
}));

jest.mock("@/models/integration/TenantExportConfig.js", () => ({
  TenantExportConfigModel: {
    findOneAndUpdate: jest.fn(async (q: Record<string, unknown>, u: Record<string, unknown>) =>
      upsertInto(exportStore, q, u)
    )
  }
}));

jest.mock("@/models/compliance/VendorMaster.js", () => ({
  VendorMasterModel: {
    findOneAndUpdate: jest.fn(async (q: Record<string, unknown>, u: Record<string, unknown>) =>
      upsertInto(vendorStore, q, u)
    )
  }
}));

jest.mock("@/services/invoice/approvalWorkflowService.js", () => {
  class MockApprovalWorkflowService {
    async saveWorkflowConfig(tenantId: string, config: Record<string, unknown>, userId: string) {
      const entry = upsertInto(workflowStore, { tenantId }, { $set: { ...config, updatedBy: userId, tenantId } });
      return entry;
    }
  }
  return { ApprovalWorkflowService: MockApprovalWorkflowService };
});

/* ------------------------------------------------------------------ imports */

import { seedDemoTenantConfig } from "./seedDemoTenantConfig.js";

const TENANT_ID = "65f0000000000000000000c3";
const MAHIR_USER_ID = "mahir-user-id";

function seedRoleRows() {
  roleStore.length = 0;
  roleStore.push(
    { tenantId: TENANT_ID, userId: "u-admin", role: "TENANT_ADMIN", capabilities: { approvalLimitMinor: 123 } },
    { tenantId: TENANT_ID, userId: "u-ap", role: "ap_clerk", capabilities: { approvalLimitMinor: 999 } },
    { tenantId: TENANT_ID, userId: "u-sr", role: "senior_accountant", capabilities: { approvalLimitMinor: 1 } },
    { tenantId: TENANT_ID, userId: "u-ca", role: "ca", capabilities: { approvalLimitMinor: 1 } },
    { tenantId: TENANT_ID, userId: "u-view", role: "audit_clerk", capabilities: { approvalLimitMinor: 5 } }
  );
}

beforeEach(() => {
  complianceStore = [];
  tcsStore = [];
  notificationStore = [];
  exportStore = [];
  vendorStore = [];
  workflowStore = [];
  seedRoleRows();
});

describe("seedDemoTenantConfig", () => {
  it("is idempotent: re-running produces the same single-row state with no duplicates", async () => {
    await seedDemoTenantConfig(TENANT_ID, MAHIR_USER_ID);
    await seedDemoTenantConfig(TENANT_ID, MAHIR_USER_ID);

    expect(complianceStore).toHaveLength(1);
    expect(tcsStore).toHaveLength(1);
    expect(notificationStore).toHaveLength(1);
    expect(exportStore).toHaveLength(1);
    expect(vendorStore).toHaveLength(3);
    expect(workflowStore).toHaveLength(1);
  });

  it("persists an approval workflow with 4 steps and correct condition types on each", async () => {
    await seedDemoTenantConfig(TENANT_ID, MAHIR_USER_ID);

    const wf = workflowStore[0];
    expect(wf.enabled).toBe(true);
    expect(wf.mode).toBe("advanced");

    const steps = wf.steps as Array<Record<string, unknown>>;
    expect(steps).toHaveLength(4);

    expect(steps[0].type).toBe("approval");
    expect(steps[0].approverRole).toBe("senior_accountant");
    expect(steps[0].condition).toBeUndefined();

    expect(steps[1].type).toBe("compliance_signoff");
    expect(steps[1].approverCapability).toBe("canSignOffCompliance");
    expect(steps[1].condition).toEqual({ field: "totalAmountMinor", operator: "gt", value: 5000000 });

    expect(steps[2].type).toBe("approval");
    expect(steps[2].approverRole).toBe("ca");
    expect(steps[2].condition).toEqual({ field: "riskSignalMaxSeverity", operator: "gte", value: 2 });

    expect(steps[3].type).toBe("escalation");
    expect(steps[3].approverType).toBe("specific_users");
    expect(steps[3].escalateTo).toBe(MAHIR_USER_ID);
    expect(steps[3].timeoutHours).toBe(24);
    expect(steps[3].condition).toEqual({ field: "totalAmountMinor", operator: "gt", value: 25000000 });
  });

  it("sets TenantUserRole.capabilities.approvalLimitMinor per role", async () => {
    await seedDemoTenantConfig(TENANT_ID, MAHIR_USER_ID);

    const limits = Object.fromEntries(
      roleStore.map((r) => [r.role, (r.capabilities as Record<string, unknown>).approvalLimitMinor])
    );

    expect(limits.ap_clerk).toBe(2500000);
    expect(limits.senior_accountant).toBe(10000000);
    expect(limits.ca).toBe(50000000);
    expect(limits.TENANT_ADMIN).toBeNull();
    expect(limits.audit_clerk).toBe(0);
  });

  it("seeds TCS history with exactly 2 entries, fully overwritten on re-run", async () => {
    await seedDemoTenantConfig(TENANT_ID, MAHIR_USER_ID);
    await seedDemoTenantConfig(TENANT_ID, MAHIR_USER_ID);

    const tcs = tcsStore[0];
    const history = tcs.history as Array<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0].newRate).toBe(0.1);
    expect(history[0].previousRate).toBe(0.075);
    expect(history[0].reason).toBe("FY26 budget revision");
    expect(history[1].newRate).toBe(0.075);
    expect(history[1].previousRate).toBe(0.05);
    expect(tcs.ratePercent).toBe(0.1);
    expect(tcs.enabled).toBe(true);
    expect(tcs.tcsModifyRoles).toEqual(["TENANT_ADMIN", "ca"]);
  });

  it("persists Acme Contractors LLP vendor with agreedPaymentDays: 45 unchanged", async () => {
    await seedDemoTenantConfig(TENANT_ID, MAHIR_USER_ID);

    const acme = vendorStore.find((v) => v.name === "Acme Contractors LLP");
    expect(acme).toBeDefined();
    expect(acme!.vendorFingerprint).toBe("acme-contractors-llp");
    const msme = acme!.msme as Record<string, unknown>;
    expect(msme.agreedPaymentDays).toBe(45);
    expect(msme.classification).toBe("small");
    expect(msme.udyamNumber).toBe("UDYAM-KA-02-0001234");
  });

  it("seeds compliance config with complianceEnabled: true and the demo field set", async () => {
    await seedDemoTenantConfig(TENANT_ID, MAHIR_USER_ID);

    const config = complianceStore[0];
    expect(config.complianceEnabled).toBe(true);
    expect(config.tdsEnabled).toBe(true);
    expect(config.defaultTdsSection).toBe("194J");
    expect(config.panValidationEnabled).toBe(true);
    expect(config.riskSignalsEnabled).toBe(true);
    expect(config.ocrWeight).toBeCloseTo(0.7);
    expect(config.completenessWeight).toBeCloseTo(0.3);
    expect(config.learningMode).toBe("active");
    expect(config.updatedBy).toBe("seed:demo-tenant");

    const activeSignals = config.activeRiskSignals as string[];
    expect(activeSignals).toEqual(expect.arrayContaining([
      "TOTAL_AMOUNT_ABOVE_EXPECTED", "DUE_DATE_TOO_FAR", "MISSING_MANDATORY_FIELDS",
      "DUPLICATE_INVOICE_NUMBER", "VENDOR_BANK_CHANGED", "PAN_FORMAT_INVALID",
      "PAN_GSTIN_MISMATCH", "MSME_PAYMENT_OVERDUE", "MSME_PAYMENT_DUE_SOON", "SENDER_FREEMAIL"
    ]));
    expect(activeSignals).toHaveLength(10);
  });
});
