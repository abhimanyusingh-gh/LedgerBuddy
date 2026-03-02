import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import axios from "axios";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const tenantAdminEmail = process.env.E2E_TENANT_ADMIN_EMAIL ?? "tenant-admin-1@local.test";
const tenantMemberEmail = process.env.E2E_TENANT_MEMBER_EMAIL ?? "tenant-user-1@local.test";
const platformAdminEmail = process.env.E2E_PLATFORM_ADMIN_EMAIL ?? "platform-admin@local.test";
const loginPassword = process.env.E2E_LOGIN_PASSWORD ?? "DemoPass!1";

test.describe("tenant admin visibility", () => {
  let adminToken = "";
  let memberToken = "";
  let platformToken = "";

  test.beforeAll(async ({ request }) => {
    await expectBackendReady(request);

    adminToken = await createE2ESessionToken(apiBaseUrl, tenantAdminEmail);
    await completeE2ETenantOnboarding(request, adminToken);
    memberToken = await createE2ESessionToken(apiBaseUrl, tenantMemberEmail);
    platformToken = await createE2ESessionToken(apiBaseUrl, platformAdminEmail);

    await connectGmail(adminToken);
  });

  test("admin sees tenant settings and gmail action controls", async ({ page }) => {
    await seedAuthToken(page, adminToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Invoice Workspace" })).toBeVisible();
    await page.getByRole("button", { name: "Tenant Config" }).click();
    await expect(page.getByRole("heading", { name: "Tenant Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send Invite" })).toBeVisible();
    await expect(page.getByText("Mailbox Connected")).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect Gmail|Reconnect Gmail/ })).toHaveCount(0);
  });

  test("member does not see tenant settings or gmail action controls", async ({ page }) => {
    await seedAuthToken(page, memberToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Invoice Workspace" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tenant Config" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Tenant Settings" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send Invite" })).toHaveCount(0);
    await expect(page.getByText("Mailbox Connected")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Connect Gmail|Reconnect Gmail/ })).toHaveCount(0);
  });

  test("member is denied gmail connect-url api while admin is allowed", async ({ request }) => {
    const adminConnectUrl = await request.get(`${apiBaseUrl}/api/integrations/gmail/connect-url`, {
      headers: authHeaders(adminToken)
    });
    expect(adminConnectUrl.status()).toBe(200);
    const payload = (await adminConnectUrl.json()) as { connectUrl?: string };
    expect(typeof payload.connectUrl).toBe("string");

    const memberConnectUrl = await request.get(`${apiBaseUrl}/api/integrations/gmail/connect-url`, {
      headers: authHeaders(memberToken)
    });
    expect(memberConnectUrl.status()).toBe(403);
  });

  test("platform admin sees tenant usage overview panel", async ({ page }) => {
    await seedAuthToken(page, platformToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Platform Statistics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Onboard Tenant Admin" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Platform Tenant Usage Overview" })).toBeVisible();
    await expect(
      page.getByText("This view is usage-only. Invoice content is not exposed at platform scope.")
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Tenant" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Documents" })).toBeVisible();
  });

  test("platform admin can onboard a tenant admin from UI", async ({ page }) => {
    await seedAuthToken(page, platformToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const tenantName = `Playwright Tenant ${Date.now()}`;
    const adminEmail = `pw-admin-${Date.now()}@local.test`;

    await page.getByLabel("Tenant Name").fill(tenantName);
    await page.getByLabel("Tenant Admin Email").fill(adminEmail);
    await page.getByLabel("Admin Name (optional)").fill("Playwright Admin");
    await page.getByRole("button", { name: "Create Tenant Admin" }).click();

    await expect(
      page.locator("tbody tr").filter({ has: page.getByRole("cell", { name: tenantName }) }).first()
    ).toBeVisible();
  });

  test("platform admin collapses sections and loads activity by tenant click", async ({ page }) => {
    await seedAuthToken(page, platformToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("platform-stats-grid")).toBeVisible();
    await page.getByRole("button", { name: "Toggle Platform Statistics section" }).click();
    await expect(page.getByTestId("platform-stats-grid")).toHaveCount(0);
    await page.getByRole("button", { name: "Toggle Platform Statistics section" }).click();
    await expect(page.getByTestId("platform-stats-grid")).toBeVisible();

    await page.getByRole("button", { name: "Toggle Onboard Tenant Admin section" }).click();
    await expect(page.getByLabel("Tenant Name")).toHaveCount(0);
    await page.getByRole("button", { name: "Toggle Onboard Tenant Admin section" }).click();
    await expect(page.getByLabel("Tenant Name")).toBeVisible();

    const usageRows = page.locator("[data-testid='platform-usage-table'] tbody tr");
    await expect(usageRows.first()).toBeVisible();
    const rowCount = await usageRows.count();
    const targetRowIndex = rowCount > 1 ? 1 : 0;
    const selectedTenantName = (await usageRows.nth(targetRowIndex).locator("td").first().innerText()).trim();
    await usageRows.nth(targetRowIndex).click();
    await expect(page.getByTestId("platform-activity-tenant")).toContainText(selectedTenantName);

    await page.getByRole("button", { name: "Toggle Platform Tenant Usage Overview section" }).click();
    await expect(page.locator("[data-testid='platform-usage-table']")).toHaveCount(0);
    await page.getByRole("button", { name: "Toggle Platform Tenant Usage Overview section" }).click();
    await expect(page.locator("[data-testid='platform-usage-table']")).toBeVisible();

  });
});

async function expectBackendReady(request: APIRequestContext): Promise<void> {
  const health = await request.get(`${apiBaseUrl}/health`);
  expect(health.ok()).toBeTruthy();
  const payload = (await health.json()) as { ready?: boolean };
  expect(payload.ready).toBe(true);
}

async function createE2ESessionToken(apiRoot: string, email: string): Promise<string> {
  const response = await axios.post<{ token?: string }>(
    `${apiRoot}/auth/token`,
    {
      email,
      password: loginPassword
    },
    {
      timeout: 30_000,
      validateStatus: () => true
    }
  );
  if (response.status !== 200) {
    throw new Error(`Failed to login with credentials for '${email}' (HTTP ${response.status}).`);
  }
  const token = typeof response.data?.token === "string" ? response.data.token.trim() : "";
  if (!token) {
    throw new Error(`Credential login did not return a session token for '${email}'.`);
  }
  return token;
}

async function completeE2ETenantOnboarding(request: APIRequestContext, token: string): Promise<void> {
  const session = await request.get(`${apiBaseUrl}/api/session`, {
    headers: authHeaders(token)
  });
  expect(session.ok()).toBeTruthy();
  const payload = (await session.json()) as {
    tenant?: { onboarding_status?: string; name?: string };
    user?: { email?: string };
  };

  if (payload.tenant?.onboarding_status === "completed") {
    return;
  }

  const complete = await request.post(`${apiBaseUrl}/api/tenant/onboarding/complete`, {
    headers: authHeaders(token),
    data: {
      tenantName: payload.tenant?.name ?? "local-tenant",
      adminEmail: payload.user?.email ?? "admin@local.test"
    }
  });
  expect(complete.ok()).toBeTruthy();
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function seedAuthToken(page: Page, token: string): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("invoice_processor_session_token", value);
  }, token);
}

async function connectGmail(token: string): Promise<void> {
  const connectUrlResponse = await axios.get(`${apiBaseUrl}/api/integrations/gmail/connect-url`, {
    headers: authHeaders(token),
    timeout: 30_000,
    validateStatus: () => true
  });
  if (connectUrlResponse.status !== 200) {
    throw new Error(`Failed to resolve Gmail connect URL (HTTP ${connectUrlResponse.status}).`);
  }

  const connectUrl = String(connectUrlResponse.data?.connectUrl ?? "");
  if (!connectUrl) {
    throw new Error("Gmail connect URL was empty.");
  }

  const finalRedirect = await followRedirectChain(connectUrl);
  const parsed = new URL(finalRedirect);
  if (parsed.searchParams.get("gmail") !== "connected") {
    throw new Error(`Expected gmail=connected redirect, got '${finalRedirect}'.`);
  }
}

async function followRedirectChain(startUrl: string, maxHops = 6): Promise<string> {
  let currentUrl = startUrl;
  for (let hop = 0; hop < maxHops; hop += 1) {
    const response = await axios.get(currentUrl, {
      timeout: 30_000,
      maxRedirects: 0,
      validateStatus: () => true
    });
    if (response.status < 300 || response.status >= 400) {
      return currentUrl;
    }
    const location = response.headers.location;
    if (typeof location !== "string" || location.trim().length === 0) {
      throw new Error(`Redirect from '${currentUrl}' did not include a location header.`);
    }
    currentUrl = new URL(location, currentUrl).toString();
  }

  return currentUrl;
}
