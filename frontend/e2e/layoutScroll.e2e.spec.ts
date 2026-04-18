import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import axios from "axios";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";
const tenantAdminEmail = process.env.E2E_TENANT_ADMIN_EMAIL ?? "tenant-admin-1@local.test";
const platformAdminEmail = process.env.E2E_PLATFORM_ADMIN_EMAIL ?? "platform-admin@local.test";
const loginPassword = process.env.E2E_LOGIN_PASSWORD ?? "DemoPass!1";

test.describe("layout scroll guardrails", () => {
  test.use({
    viewport: { width: 1280, height: 620 }
  });

  let tenantToken = "";
  let platformToken = "";

  test.beforeAll(async ({ request }) => {
    await expectBackendReady(request);
    tenantToken = await createE2ESessionToken(apiBaseUrl, tenantAdminEmail);
    platformToken = await createE2ESessionToken(apiBaseUrl, platformAdminEmail);
    await completeE2ETenantOnboarding(request, tenantToken);
  });

  test("login page keeps page-level scroll enabled", async ({ page }) => {
    await clearAuthToken(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    const result = await assertPageCanScroll(page);
    expect(result.afterY).toBeGreaterThan(result.beforeY);
  });

  test("tenant admin screens keep page-level scroll enabled", async ({ page }) => {
    await seedAuthToken(page, tenantToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Invoice Workspace" })).toBeVisible();

    let result = await assertPageCanScroll(page);
    expect(result.afterY).toBeGreaterThan(result.beforeY);

    await page.getByRole("button", { name: "Tenant Config" }).click();
    await expect(page.getByRole("heading", { name: "Tenant Settings" })).toBeVisible();
    result = await assertPageCanScroll(page);
    expect(result.afterY).toBeGreaterThan(result.beforeY);
  });

  test("platform admin keeps expanded sections reachable with page scroll", async ({ page }) => {
    await seedAuthToken(page, platformToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Platform Overview" }).first()).toBeVisible();

    await expandPlatformSectionIfCollapsed(page, "Platform Statistics", "platform-stats-grid");
    await expandPlatformSectionIfCollapsed(page, "Onboard Tenant Admin", "Tenant Name");
    await expandPlatformSectionIfCollapsed(page, "Platform Tenant Usage Overview", "platform-usage-table");
    await expandPlatformSectionIfCollapsed(page, "Activity Monitor", "platform-activity-tenant");

    const result = await assertPageCanScroll(page);
    expect(result.afterY).toBeGreaterThan(result.beforeY);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.getByRole("heading", { name: "Activity Monitor" })).toBeVisible();
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
    window.localStorage.setItem("ledgerbuddy_session_token", value);
  }, token);
}

async function clearAuthToken(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.removeItem("ledgerbuddy_session_token");
  });
}

async function assertPageCanScroll(page: Page): Promise<{
  beforeY: number;
  afterY: number;
}> {
  await page.evaluate(() => {
    const existing = document.getElementById("__scroll_probe__");
    if (existing) {
      existing.remove();
    }
    const probe = document.createElement("div");
    probe.id = "__scroll_probe__";
    probe.style.height = "1800px";
    probe.style.pointerEvents = "none";
    document.body.appendChild(probe);
  });

  const beforeY = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(25);
  const afterY = await page.evaluate(() => window.scrollY);

  await page.evaluate(() => {
    document.getElementById("__scroll_probe__")?.remove();
    window.scrollTo(0, 0);
  });

  return {
    beforeY,
    afterY
  };
}

async function expandPlatformSectionIfCollapsed(page: Page, sectionTitle: string, marker: string): Promise<void> {
  const markerLocator =
    marker.includes("-")
      ? page.getByTestId(marker)
      : page.getByLabel(marker, { exact: true });

  if ((await markerLocator.count()) > 0) {
    return;
  }

  await page.getByRole("button", { name: `Toggle ${sectionTitle} section` }).click();
}
