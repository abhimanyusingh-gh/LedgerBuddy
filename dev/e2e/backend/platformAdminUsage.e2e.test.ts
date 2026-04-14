import axios from "axios";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { loginWithPassword, createE2EUserAndLogin, completeE2ETenantOnboarding } from "./authHelper.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { TenantIntegrationModel } from "@/models/integration/TenantIntegration.js";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";
const mongoUri = process.env.E2E_MONGO_URI ?? "mongodb://billforge_app:billforge_local_pass@127.0.0.1:27018/billforge?authSource=billforge";
const platformAdminEmail = process.env.E2E_PLATFORM_ADMIN_EMAIL ?? "platform-admin@local.test";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 60_000,
  validateStatus: () => true
});

jest.setTimeout(5 * 60_000);

describe("platform admin tenant usage e2e", () => {
  beforeAll(async () => {
    const health = await api.get("/health");
    expect(health.status).toBe(200);
    expect(health.data?.ready).toBe(true);
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("returns usage-only tenant overview for platform admin and blocks non-platform users", async () => {
    const platformToken = await loginWithPassword(apiBaseUrl, platformAdminEmail, "DemoPass!1");
    const platformSession = await fetchSession(platformToken);
    expect(platformSession.user.isPlatformAdmin).toBe(true);

    const onboardedTenantAdminEmail = `onboarded-${Date.now()}@local.test`;
    const onboardedTenantName = `Onboarded Tenant ${Date.now()}`;
    const onboardResponse = await api.post(
      "/api/platform/tenants/onboard-admin",
      {
        tenantName: onboardedTenantName,
        adminEmail: onboardedTenantAdminEmail
      },
      {
        headers: authHeaders(platformToken)
      }
    );
    expect(onboardResponse.status).toBe(201);
    expect(onboardResponse.data?.tenantName).toBe(onboardedTenantName);
    expect(onboardResponse.data?.adminEmail).toBe(onboardedTenantAdminEmail);

    const onboardedAdminTempPassword = onboardResponse.data?.tempPassword as string;
    const onboardedAdminToken = await loginWithPassword(apiBaseUrl, onboardedTenantAdminEmail, onboardedAdminTempPassword);
    const onboardedAdminSession = await fetchSession(onboardedAdminToken);
    expect(onboardedAdminSession.user.isPlatformAdmin).toBe(false);
    expect(onboardedAdminSession.user.role).toBe("TENANT_ADMIN");
    expect(onboardedAdminSession.tenant.name).toBe(onboardedTenantName);
    expect(onboardedAdminSession.tenant.onboarding_status).toBe("pending");

    const forbiddenOnboard = await api.post(
      "/api/platform/tenants/onboard-admin",
      {
        tenantName: "forbidden",
        adminEmail: `forbidden-${Date.now()}@local.test`
      },
      {
        headers: authHeaders(onboardedAdminToken)
      }
    );
    expect(forbiddenOnboard.status).toBe(403);

    const platformIngest = await api.post(
      "/api/jobs/ingest",
      {},
      {
        headers: authHeaders(platformToken)
      }
    );
    expect(platformIngest.status).toBe(403);

    const platformInvoices = await api.get("/api/invoices?page=1&limit=5", {
      headers: authHeaders(platformToken)
    });
    expect(platformInvoices.status).toBe(403);

    const tenantAEmail = `usage-a-${Date.now()}@local.test`;
    const tenantBEmail = `usage-b-${Date.now()}@local.test`;
    const tenantAName = `Usage Tenant A ${Date.now()}`;
    const tenantBName = `Usage Tenant B ${Date.now()}`;
    const tenantAOnboard = await api.post(
      "/api/platform/tenants/onboard-admin",
      {
        tenantName: tenantAName,
        adminEmail: tenantAEmail
      },
      {
        headers: authHeaders(platformToken)
      }
    );
    expect(tenantAOnboard.status).toBe(201);
    const tenantBOnboard = await api.post(
      "/api/platform/tenants/onboard-admin",
      {
        tenantName: tenantBName,
        adminEmail: tenantBEmail
      },
      {
        headers: authHeaders(platformToken)
      }
    );
    expect(tenantBOnboard.status).toBe(201);
    const tenantATempPassword = tenantAOnboard.data?.tempPassword as string;
    const tenantBTempPassword = tenantBOnboard.data?.tempPassword as string;
    const tenantAToken = await loginWithPassword(apiBaseUrl, tenantAEmail, tenantATempPassword);
    const tenantBToken = await loginWithPassword(apiBaseUrl, tenantBEmail, tenantBTempPassword);
    await completeE2ETenantOnboarding(apiBaseUrl, tenantAToken);
    await completeE2ETenantOnboarding(apiBaseUrl, tenantBToken);

    const tenantASession = await fetchSession(tenantAToken);
    const tenantBSession = await fetchSession(tenantBToken);

    await seedInvoice(tenantASession.tenant.id, "PARSED");
    await seedInvoice(tenantASession.tenant.id, "FAILED_PARSE");
    await seedInvoice(tenantASession.tenant.id, "EXPORTED");
    await seedInvoice(tenantBSession.tenant.id, "APPROVED");
    await seedInvoice(tenantBSession.tenant.id, "NEEDS_REVIEW");

    await TenantIntegrationModel.findOneAndUpdate(
      {
        tenantId: tenantASession.tenant.id,
        provider: "gmail"
      },
      {
        tenantId: tenantASession.tenant.id,
        provider: "gmail",
        status: "connected",
        emailAddress: tenantAEmail,
        encryptedRefreshToken: "encrypted-token",
        createdByUserId: tenantASession.user.id
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const usageResponse = await api.get("/api/platform/tenants/usage", {
      headers: authHeaders(platformToken)
    });
    expect(usageResponse.status).toBe(200);
    const items: Array<{
      tenantId: string;
      totalDocuments: number;
      parsedDocuments: number;
      failedDocuments: number;
      exportedDocuments: number;
      approvedDocuments: number;
      needsReviewDocuments: number;
      gmailConnectionState: string;
    }> = Array.isArray(usageResponse.data?.items) ? usageResponse.data.items : [];
    const tenantAUsage = items.find((entry) => entry.tenantId === tenantASession.tenant.id);
    const tenantBUsage = items.find((entry) => entry.tenantId === tenantBSession.tenant.id);

    expect(tenantAUsage).toBeDefined();
    if (!tenantAUsage) {
      throw new Error("Missing tenant A usage row.");
    }
    expect(tenantAUsage.totalDocuments).toBe(3);
    expect(tenantAUsage.parsedDocuments).toBe(1);
    expect(tenantAUsage.failedDocuments).toBe(1);
    expect(tenantAUsage.exportedDocuments).toBe(1);
    expect(tenantAUsage.gmailConnectionState).toBe("CONNECTED");
    expect(tenantAUsage).not.toHaveProperty("invoices");
    expect(tenantAUsage).not.toHaveProperty("ocrText");

    expect(tenantBUsage).toBeDefined();
    if (!tenantBUsage) {
      throw new Error("Missing tenant B usage row.");
    }
    expect(tenantBUsage.totalDocuments).toBe(2);
    expect(tenantBUsage.approvedDocuments).toBe(1);
    expect(tenantBUsage.needsReviewDocuments).toBe(1);

    const forbidden = await api.get("/api/platform/tenants/usage", {
      headers: authHeaders(tenantAToken)
    });
    expect(forbidden.status).toBe(403);
  });
});

async function fetchSession(token: string): Promise<{
  user: { id: string; email: string; role: string; isPlatformAdmin: boolean };
  tenant: { id: string; name: string; onboarding_status: "pending" | "completed" };
}> {
  const response = await api.get("/api/session", {
    headers: authHeaders(token)
  });
  expect(response.status).toBe(200);
  return response.data;
}

async function seedInvoice(tenantId: string, status: "PARSED" | "FAILED_PARSE" | "EXPORTED" | "APPROVED" | "NEEDS_REVIEW"): Promise<void> {
  const id = randomUUID();
  await InvoiceModel.create({
    tenantId,
    workloadTier: "standard",
    sourceType: "folder",
    sourceKey: "platform-usage-test",
    sourceDocumentId: `platform-usage-${id}.pdf`,
    attachmentName: `platform-usage-${id}.pdf`,
    mimeType: "application/pdf",
    receivedAt: new Date(),
    status,
    parsed: {
      invoiceNumber: `USAGE-${id.slice(0, 8)}`,
      vendorName: "Usage Vendor",
      invoiceDate: "2026-03-01",
      dueDate: "2026-03-08",
      currency: "USD",
      totalAmountMinor: 1000
    }
  });
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}
