import axios from "axios";
import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import FormData from "form-data";
import { loginWithPassword } from "./authHelper.js";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";
const mongoUri = process.env.E2E_MONGO_URI ?? "mongodb://billforge_app:billforge_local_pass@127.0.0.1:27018/billforge?authSource=billforge";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 60_000,
  validateStatus: () => true
});

jest.setTimeout(5 * 60_000);

describe("tenant lifecycle e2e", () => {
  let platformAdminToken: string;

  beforeAll(async () => {
    const health = await api.get("/health");
    expect(health.status).toBe(200);
    expect(health.data?.ready).toBe(true);
    await mongoose.connect(mongoUri);

    platformAdminToken = await loginWithPassword(apiBaseUrl, "platform-admin@local.test", "DemoPass!1");
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("full lifecycle: create tenant, temp password, change password, upload, ingest, export", async () => {
    const uniqueSuffix = Date.now();
    const tenantName = `E2E Lifecycle ${uniqueSuffix}`;
    const adminEmail = `lifecycle-admin-${uniqueSuffix}@local.test`;

    // 1. Create tenant (mode: "live")
    const onboardResponse = await api.post(
      "/api/platform/tenants/onboard-admin",
      { tenantName, adminEmail, mode: "live" },
      { headers: { Authorization: `Bearer ${platformAdminToken}` } }
    );
    expect(onboardResponse.status).toBe(201);
    expect(onboardResponse.data.tempPassword).toBeTruthy();
    const tempPassword = onboardResponse.data.tempPassword;
    const tenantId = onboardResponse.data.tenantId;

    // 2. Verify usage shows adminTempPassword
    const usageResponse = await api.get("/api/platform/tenants/usage", {
      headers: { Authorization: `Bearer ${platformAdminToken}` }
    });
    expect(usageResponse.status).toBe(200);
    const tenantUsage = usageResponse.data.items.find(
      (item: { tenantId: string }) => item.tenantId === tenantId
    );
    expect(tenantUsage).toBeTruthy();
    expect(tenantUsage.adminTempPassword).toBe(tempPassword);

    // 3. Login with temp password
    const loginResponse = await api.post("/api/auth/token", {
      email: adminEmail,
      password: tempPassword
    });
    expect(loginResponse.status).toBe(200);
    const tempToken = loginResponse.data.token;

    // 4. Verify flags: must_change_password === true
    const sessionResponse = await api.get("/api/session", {
      headers: { Authorization: `Bearer ${tempToken}` }
    });
    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.data.flags.must_change_password).toBe(true);

    // 5. Change password
    const newPassword = `NewPass!${uniqueSuffix}`;
    const changeResponse = await api.post(
      "/api/auth/change-password",
      { currentPassword: tempPassword, newPassword },
      { headers: { Authorization: `Bearer ${tempToken}` } }
    );
    expect(changeResponse.status).toBe(200);
    expect(changeResponse.data.success).toBe(true);

    // 6. Login with OLD password should fail
    const oldLoginResponse = await api.post("/api/auth/token", {
      email: adminEmail,
      password: tempPassword
    });
    expect(oldLoginResponse.status).toBe(401);

    // 7. Login with NEW password
    const newLoginResponse = await api.post("/api/auth/token", {
      email: adminEmail,
      password: newPassword
    });
    expect(newLoginResponse.status).toBe(200);
    const newToken = newLoginResponse.data.token;

    // 8. Verify flags cleared
    const newSessionResponse = await api.get("/api/session", {
      headers: { Authorization: `Bearer ${newToken}` }
    });
    expect(newSessionResponse.status).toBe(200);
    expect(newSessionResponse.data.flags.must_change_password).toBe(false);

    // 9. Complete onboarding
    const completeResponse = await api.post(
      "/api/tenant/onboarding/complete",
      { tenantName, adminEmail },
      { headers: { Authorization: `Bearer ${newToken}` } }
    );
    expect(completeResponse.status).toBe(204);

    // 10. Upload file
    const samplePdfPath = path.resolve(__dirname, "../../../sample-invoices/e2e-inbox/e2e-sample.pdf");
    const pdfBuffer = readFileSync(samplePdfPath);
    const form = new FormData();
    form.append("files", pdfBuffer, { filename: "e2e-upload-test.pdf", contentType: "application/pdf" });

    const uploadResponse = await api.post("/api/jobs/upload", form, {
      headers: {
        Authorization: `Bearer ${newToken}`,
        ...form.getHeaders()
      }
    });
    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.data.count).toBe(1);

    // 10b. Verify uploaded file appears as PENDING invoice immediately
    const pendingInvoicesResponse = await api.get("/api/invoices", {
      headers: { Authorization: `Bearer ${newToken}` }
    });
    expect(pendingInvoicesResponse.status).toBe(200);
    const pendingInvoice = pendingInvoicesResponse.data.items.find(
      (item: { status: string; attachmentName: string }) =>
        item.status === "PENDING" && item.attachmentName === "e2e-upload-test.pdf"
    );
    expect(pendingInvoice).toBeTruthy();
    expect(pendingInvoice.sourceType).toBe("s3-upload");

    // 10c. Upload same file again — should succeed (unique fileId)
    const form2 = new FormData();
    form2.append("files", pdfBuffer, { filename: "e2e-upload-test.pdf", contentType: "application/pdf" });
    const reuploadResponse = await api.post("/api/jobs/upload", form2, {
      headers: { Authorization: `Bearer ${newToken}`, ...form2.getHeaders() }
    });
    expect(reuploadResponse.status).toBe(201);

    // 10d. Verify duplicate detection flag
    const afterReuploadResponse = await api.get("/api/invoices", {
      headers: { Authorization: `Bearer ${newToken}` }
    });
    expect(afterReuploadResponse.status).toBe(200);
    const dupeInvoices = afterReuploadResponse.data.items.filter(
      (item: { attachmentName: string; possibleDuplicate?: boolean }) =>
        item.attachmentName === "e2e-upload-test.pdf"
    );
    expect(dupeInvoices.length).toBeGreaterThanOrEqual(2);
    expect(dupeInvoices.every((d: { possibleDuplicate?: boolean }) => d.possibleDuplicate === true)).toBe(true);

    // 10e. Delete one duplicate
    const dupeToDelete = dupeInvoices[0]._id;
    const deleteResponse = await api.post(
      "/api/invoices/delete",
      { ids: [dupeToDelete] },
      { headers: { Authorization: `Bearer ${newToken}` } }
    );
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.data.deletedCount).toBe(1);

    // 10f. Verify deletion — only one copy remains
    const afterDeleteResponse = await api.get("/api/invoices", {
      headers: { Authorization: `Bearer ${newToken}` }
    });
    expect(afterDeleteResponse.status).toBe(200);
    const remainingUploads = afterDeleteResponse.data.items.filter(
      (item: { attachmentName: string }) => item.attachmentName === "e2e-upload-test.pdf"
    );
    expect(remainingUploads.length).toBe(dupeInvoices.length - 1);

    // 11. Ingest
    const ingestResponse = await api.post(
      "/api/jobs/ingest",
      {},
      { headers: { Authorization: `Bearer ${newToken}` } }
    );
    expect(ingestResponse.status).toBe(202);

    // Wait for ingestion to complete
    let ingestionDone = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const statusResponse = await api.get("/api/jobs/ingest/status", {
        headers: { Authorization: `Bearer ${newToken}` }
      });
      if (statusResponse.data.state === "completed" || statusResponse.data.state === "failed") {
        ingestionDone = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    expect(ingestionDone).toBe(true);

    // 12. Verify invoices
    const invoicesResponse = await api.get("/api/invoices", {
      headers: { Authorization: `Bearer ${newToken}` }
    });
    expect(invoicesResponse.status).toBe(200);
    expect(invoicesResponse.data.items.length).toBeGreaterThanOrEqual(1);

    // 13. Approve
    const invoiceIds = invoicesResponse.data.items.map((item: { _id: string }) => item._id);
    const approveResponse = await api.post(
      "/api/invoices/approve",
      { ids: invoiceIds, approvedBy: adminEmail },
      { headers: { Authorization: `Bearer ${newToken}` } }
    );
    expect(approveResponse.status).toBe(200);

    // 14. Export
    const exportResponse = await api.post(
      "/api/exports/tally/download",
      { ids: invoiceIds, requestedBy: "e2e" },
      { headers: { Authorization: `Bearer ${newToken}` } }
    );
    // Export may return 200 if Tally endpoint is configured, or 400/404 if not
    expect([200, 400, 404, 503]).toContain(exportResponse.status);
  });
});
