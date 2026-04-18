import { expect, type Page, type APIRequestContext } from "@playwright/test";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import FormData from "form-data";

export const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";
export const frontendBaseUrl = process.env.E2E_FRONTEND_BASE_URL ?? "http://127.0.0.1:5177";
export const loginPassword = process.env.E2E_LOGIN_PASSWORD ?? "DemoPass!1";

export const PERSONAS = {
  firmPartner: { email: "firm-partner@local.test", role: "firm_partner" },
  opsAdmin: { email: "ops-admin@local.test", role: "ops_admin" },
  seniorAccountant: { email: "senior-accountant@local.test", role: "senior_accountant" },
  apClerk1: { email: "ap-clerk-1@local.test", role: "ap_clerk" },
  apClerk2: { email: "ap-clerk-2@local.test", role: "ap_clerk" },
  ca: { email: "ca@local.test", role: "ca" },
  taxSpecialist: { email: "tax-specialist@local.test", role: "tax_specialist" },
  auditClerk: { email: "audit-clerk@local.test", role: "audit_clerk" },
  tenantAdmin: { email: "tenant-admin-1@local.test", role: "TENANT_ADMIN" },
  tenantMember: { email: "tenant-user-1@local.test", role: "ap_clerk" },
  viewer: { email: "viewer-1@local.test", role: "audit_clerk" },
  platformAdmin: { email: "platform-admin@local.test", role: "PLATFORM_ADMIN" }
} as const;

export const tenantAdminEmail = PERSONAS.tenantAdmin.email;
export const tenantMemberEmail = PERSONAS.tenantMember.email;
export const viewerEmail = PERSONAS.viewer.email;

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function expectBackendReady(request: APIRequestContext): Promise<void> {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const res = await request.get(`${apiBaseUrl}/health`);
      if (res.ok()) return;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("Backend not ready after 30 seconds.");
}

export async function loginViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto(frontendBaseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel("Email Address").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByRole("heading", { name: "LedgerBuddy" })).toBeVisible({ timeout: 20_000 });
}

export async function logoutViaUI(page: Page): Promise<void> {
  const logoutButton = page.getByRole("button", { name: "Logout" });
  await expect(logoutButton).toBeVisible({ timeout: 10_000 });
  await logoutButton.click();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible({ timeout: 15_000 });
}

export async function clickTab(page: Page, tabName: string): Promise<void> {
  const tab = page.getByRole("button", { name: tabName, exact: true });
  await expect(tab).toBeVisible({ timeout: 5_000 });
  await tab.click();
  await page.waitForTimeout(500);
}

export async function waitForInvoiceTable(page: Page): Promise<void> {
  await page.locator("table tbody tr").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

export async function setInvoicePageSize(page: Page, size: 10 | 20 | 50 | 100): Promise<void> {
  const select = page.locator(".pagination-size select").first();
  if (await select.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await select.selectOption(String(size));
    await page.waitForTimeout(500);
  }
}

export async function uploadFilesViaUI(page: Page, filePaths: string[]): Promise<void> {
  const fileInput = page.locator('input[type="file"]').first();
  await expect(fileInput).toBeAttached({ timeout: 10_000 });
  await fileInput.setInputFiles(filePaths);
}

export function invoiceRowByFile(page: Page, fileName: string) {
  return page.locator("table tbody tr").filter({ has: page.getByRole("button", { name: fileName, exact: true }) }).first();
}

export async function waitForInvoiceStatusByFile(
  page: Page,
  fileName: string,
  statusPattern: RegExp,
  timeoutMs = 180_000
): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = invoiceRowByFile(page, fileName);
    if (await row.count()) {
      const statusText = (await row.locator(".status").first().textContent())?.trim() ?? "";
      if (statusPattern.test(statusText)) {
        return statusText;
      }
    }
    await page.waitForTimeout(2_000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await clickTab(page, "Invoices");
    await setInvoicePageSize(page, 100);
  }
  throw new Error(`Timed out waiting for invoice '${fileName}' to match ${statusPattern}`);
}

export async function openInvoiceDetailsByFile(page: Page, fileName: string): Promise<void> {
  const row = invoiceRowByFile(page, fileName);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.locator("section.panel.detail-panel")).toBeVisible({ timeout: 10_000 });
}

export async function clickFirstInvoiceRow(page: Page): Promise<void> {
  const row = page.locator("table tbody tr").first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  await page.waitForTimeout(1000);
}

export async function selectInvoiceCheckbox(page: Page, rowIndex = 0): Promise<void> {
  const checkbox = page.locator("table tbody tr").nth(rowIndex).locator("input[type=checkbox]");
  await expect(checkbox).toBeVisible({ timeout: 5_000 });
  await checkbox.check();
}

export async function clickApproveSelected(page: Page): Promise<void> {
  const approveBtn = page.getByRole("button", { name: /Approve/i }).first();
  await expect(approveBtn).toBeVisible({ timeout: 5_000 });
  await approveBtn.click();

  const confirmBtn = page.getByRole("button", { name: /Confirm|Yes|Approve/i }).first();
  if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await confirmBtn.click();
  }
  await page.waitForTimeout(2000);
}

export async function getInvoiceStatusFromRow(page: Page, rowIndex = 0): Promise<string> {
  const row = page.locator("table tbody tr").nth(rowIndex);
  const statusCell = row.locator(".status").first();
  return (await statusCell.textContent())?.trim() ?? "";
}

export async function getInvoiceStatusViaApi(token: string, invoiceId: string): Promise<string> {
  const res = await axios.get(`${apiBaseUrl}/api/invoices/${invoiceId}`, {
    headers: authHeaders(token), timeout: 10_000
  });
  return res.data.status;
}

export async function getInvoiceViaApi(token: string, invoiceId: string): Promise<Record<string, unknown>> {
  const res = await axios.get(`${apiBaseUrl}/api/invoices/${invoiceId}`, {
    headers: authHeaders(token), timeout: 10_000
  });
  return res.data;
}

export async function getSessionToken(email: string): Promise<string> {
  const res = await axios.post(`${apiBaseUrl}/api/auth/token`, { email, password: loginPassword }, {
    timeout: 30_000, validateStatus: () => true
  });
  if (res.status !== 200 || !res.data?.token) throw new Error(`Login failed for ${email} (HTTP ${res.status})`);
  return res.data.token;
}

export async function fetchInvoicesByStatus(token: string, status: string): Promise<Array<{ _id: string; status: string }>> {
  const res = await axios.get(`${apiBaseUrl}/api/invoices`, {
    headers: authHeaders(token), params: { status, limit: 5 }, timeout: 10_000
  });
  return res.data.items ?? [];
}

export async function ensureTenantOnboarded(request: APIRequestContext, token: string): Promise<void> {
  const session = await request.get(`${apiBaseUrl}/api/session`, { headers: authHeaders(token) });
  const payload = (await session.json()) as { tenant?: { onboarding_status?: string; name?: string }; user?: { email?: string } };
  if (payload.tenant?.onboarding_status === "completed") return;
  await request.post(`${apiBaseUrl}/api/tenant/onboarding/complete`, {
    headers: authHeaders(token),
    data: { tenantName: payload.tenant?.name ?? "local-tenant", adminEmail: payload.user?.email ?? "admin@local.test" }
  });
}

export async function seedComplianceConfig(token: string): Promise<void> {
  await axios.put(`${apiBaseUrl}/api/admin/compliance-config`,
    { complianceEnabled: true, autoSuggestGlCodes: true, autoDetectTds: true },
    { headers: authHeaders(token), timeout: 10_000 }
  );
  const codes = [
    { code: "5010", name: "Office Supplies", category: "Office Expenses" },
    { code: "5020", name: "Professional Fees", category: "Professional Services", linkedTdsSection: "194J" },
    { code: "5030", name: "Rent - Building", category: "Rent", linkedTdsSection: "194I(b)" }
  ];
  for (const gl of codes) {
    await axios.post(`${apiBaseUrl}/api/admin/gl-codes`, gl, {
      headers: authHeaders(token), timeout: 10_000, validateStatus: () => true
    });
  }
}

export async function enableWorkflow(token: string): Promise<void> {
  await axios.put(`${apiBaseUrl}/api/admin/approval-workflow`, {
    enabled: true, mode: "advanced",
    simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
    steps: [
      { order: 1, name: "Member approval", approverType: "any_member", rule: "any" },
      { order: 2, name: "Partner review", approverType: "persona", approverPersona: "firm_partner", rule: "any" }
    ]
  }, { headers: authHeaders(token), timeout: 10_000 });
}

export async function uploadTestInvoiceAndWait(token: string, testLabel: string): Promise<string> {
  const pdfPath = path.resolve(import.meta.dirname, "../../sample-invoices/inbox/INV-FY2526-939.pdf");
  if (!fs.existsSync(pdfPath)) throw new Error(`Test PDF not found at ${pdfPath}`);

  const form = new FormData();
  const fileBuffer = fs.readFileSync(pdfPath);
  form.append("files", fileBuffer, { filename: `test-${testLabel}-${Date.now()}.pdf`, contentType: "application/pdf" });

  const uploadRes = await axios.post(`${apiBaseUrl}/api/jobs/upload`, form, {
    headers: { ...authHeaders(token), ...form.getHeaders() },
    timeout: 30_000
  });
  expect(uploadRes.status).toBeLessThan(300);

  await axios.post(`${apiBaseUrl}/api/jobs/ingest`, {}, { headers: authHeaders(token), timeout: 30_000 }).catch(() => {});

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3_000));
    const res = await axios.get(`${apiBaseUrl}/api/invoices`, {
      headers: authHeaders(token), params: { status: "NEEDS_REVIEW", limit: 5 }
    });
    const items = (res.data as { items: Array<{ _id: string }> }).items;
    if (items.length > 0) return items[items.length - 1]._id;

    const parsed = await axios.get(`${apiBaseUrl}/api/invoices`, {
      headers: authHeaders(token), params: { status: "PARSED", limit: 5 }
    });
    const parsedItems = (parsed.data as { items: Array<{ _id: string }> }).items;
    if (parsedItems.length > 0) return parsedItems[parsedItems.length - 1]._id;
  }

  throw new Error(`Invoice from upload "${testLabel}" did not reach PARSED/NEEDS_REVIEW within 90 seconds`);
}

export async function disableWorkflow(token: string): Promise<void> {
  await axios.put(`${apiBaseUrl}/api/admin/approval-workflow`, {
    enabled: false, mode: "simple",
    simpleConfig: { requireManagerReview: false, requireFinalSignoff: false }, steps: []
  }, { headers: authHeaders(token), timeout: 10_000 });
}
