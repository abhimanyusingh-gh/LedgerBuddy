import request from "supertest";
import { Types } from "mongoose";
import { describeHarness } from "./mongoTestHarness.js";
import {
  createIntegrationApp,
  TEST_BEARER_TOKEN,
  TEST_USER_EMAIL,
  type IntegrationAppContext
} from "./integrationApp.js";
import { BankAccountModel } from "@/models/bank/BankAccount.js";
import { ExportBatchModel } from "@/models/invoice/ExportBatch.js";
import { GlCodeMasterModel } from "@/models/compliance/GlCodeMaster.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { UserModel } from "@/models/core/User.js";
import { BANK_ACCOUNT_STATUS } from "@/types/bankAccount.js";
import { INVOICE_STATUS } from "@/types/invoice.js";

const REST_MOUNT_PROBE_HEADERS = {
  authorization: `Bearer ${TEST_BEARER_TOKEN}`,
  "x-requested-with": "LedgerBuddy"
} as const;

describeHarness("REST nested-mount middleware chain (#171 / #219)", ({ getHarness }) => {
  let ctx: IntegrationAppContext;

  beforeAll(async () => {
    getHarness();
    ctx = await createIntegrationApp();
  });

  afterEach(async () => {
    await Promise.all([
      InvoiceModel.deleteMany({ tenantId: ctx.tenantId }),
      GlCodeMasterModel.deleteMany({ tenantId: ctx.tenantId }),
      BankAccountModel.deleteMany({ tenantId: ctx.tenantId }),
      ExportBatchModel.deleteMany({ tenantId: ctx.tenantId }),
      TenantUserRoleModel.deleteMany({ tenantId: ctx.tenantId }),
      UserModel.deleteMany({ tenantId: ctx.tenantId })
    ]);
  });

  it("invoice domain — GET /invoices/:id stamps activeClientOrgId from path", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: ctx.tenantId,
      clientOrgId: ctx.clientOrgId,
      sourceType: "harness",
      sourceKey: "harness",
      sourceDocumentId: "doc-1",
      attachmentName: "INV-1.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: INVOICE_STATUS.PARSED,
      parsed: {
        invoiceNumber: "INV-1",
        vendorName: "Acme",
        invoiceDate: new Date(),
        totalAmountMinor: 12345,
        currency: "INR"
      }
    });

    const response = await request(ctx.app)
      .get(`/api/tenants/${ctx.tenantId}/clientOrgs/${ctx.clientOrgId}/invoices/${invoice._id}`)
      .set(REST_MOUNT_PROBE_HEADERS);

    expect(response.status).toBe(200);
    expect(String(response.body._id)).toBe(String(invoice._id));
  });

  it("ingestion domain — GET /jobs/ingest/status passes both middlewares", async () => {
    const response = await request(ctx.app)
      .get(`/api/tenants/${ctx.tenantId}/clientOrgs/${ctx.clientOrgId}/jobs/ingest/status`)
      .set(REST_MOUNT_PROBE_HEADERS);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ running: expect.any(Boolean) }));
  });

  it("compliance domain — GET /admin/gl-codes returns clientOrg-scoped items", async () => {
    const otherClientOrgId = new Types.ObjectId();
    await GlCodeMasterModel.collection.insertMany([
      { tenantId: ctx.tenantId, clientOrgId: ctx.clientOrgId, code: "5001", name: "Office Rent", category: "Expense", isActive: true, createdAt: new Date(), updatedAt: new Date() },
      { tenantId: ctx.tenantId, clientOrgId: otherClientOrgId, code: "9999", name: "Other Org", category: "Expense", isActive: true, createdAt: new Date(), updatedAt: new Date() }
    ]);

    const response = await request(ctx.app)
      .get(`/api/tenants/${ctx.tenantId}/clientOrgs/${ctx.clientOrgId}/admin/gl-codes`)
      .set(REST_MOUNT_PROBE_HEADERS);

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { code: string }) => item.code)).toEqual(["5001"]);
  });

  it("bank domain — GET /bank/accounts returns clientOrg-scoped accounts", async () => {
    const otherClientOrgId = new Types.ObjectId();
    await BankAccountModel.collection.insertMany([
      {
        tenantId: ctx.tenantId, clientOrgId: ctx.clientOrgId, createdByUserId: "u1",
        status: BANK_ACCOUNT_STATUS.ACTIVE, aaAddress: "harness@aa", accountNumber: "0001",
        bankName: "TestBank", ifsc: "TEST0000001", currency: "INR",
        createdAt: new Date(), updatedAt: new Date()
      },
      {
        tenantId: ctx.tenantId, clientOrgId: otherClientOrgId, createdByUserId: "u1",
        status: BANK_ACCOUNT_STATUS.ACTIVE, aaAddress: "other@aa", accountNumber: "9999",
        bankName: "TestBank", ifsc: "TEST0000001", currency: "INR",
        createdAt: new Date(), updatedAt: new Date()
      }
    ]);

    const response = await request(ctx.app)
      .get(`/api/tenants/${ctx.tenantId}/clientOrgs/${ctx.clientOrgId}/bank/accounts`)
      .set(REST_MOUNT_PROBE_HEADERS);

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { accountNumber: string }) => item.accountNumber)).toEqual(["0001"]);
  });

  it("tenant domain — GET /admin/users enforces requireMatchingTenantIdParam", async () => {
    const user = await UserModel.create({
      email: TEST_USER_EMAIL,
      externalSubject: "harness-sub-1",
      tenantId: ctx.tenantId,
      displayName: "Harness User",
      lastLoginAt: new Date(),
      enabled: true
    });
    await TenantUserRoleModel.create({
      tenantId: ctx.tenantId,
      userId: String(user._id),
      role: "TENANT_ADMIN"
    });

    const response = await request(ctx.app)
      .get(`/api/tenants/${ctx.tenantId}/admin/users`)
      .set(REST_MOUNT_PROBE_HEADERS);

    expect(response.status).toBe(200);
    expect(response.body.items.map((item: { email: string }) => item.email)).toEqual([TEST_USER_EMAIL]);
  });

  it("export domain — GET /exports/tally/history returns clientOrg-scoped batches", async () => {
    const otherClientOrgId = new Types.ObjectId();
    await ExportBatchModel.collection.insertMany([
      {
        tenantId: ctx.tenantId, clientOrgId: ctx.clientOrgId, system: "tally",
        total: 1, successCount: 1, failureCount: 0, requestedBy: TEST_USER_EMAIL,
        createdAt: new Date(), updatedAt: new Date()
      },
      {
        tenantId: ctx.tenantId, clientOrgId: otherClientOrgId, system: "tally",
        total: 5, successCount: 5, failureCount: 0, requestedBy: TEST_USER_EMAIL,
        createdAt: new Date(), updatedAt: new Date()
      }
    ]);

    const response = await request(ctx.app)
      .get(`/api/tenants/${ctx.tenantId}/clientOrgs/${ctx.clientOrgId}/exports/tally/history`)
      .set(REST_MOUNT_PROBE_HEADERS);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].total).toBe(1);
  });
});
