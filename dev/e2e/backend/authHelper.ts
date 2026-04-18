import axios from "axios";

const E2E_KC_BASE = process.env.E2E_KEYCLOAK_BASE_URL ?? "http://127.0.0.1:8280";
const E2E_KC_REALM = process.env.E2E_KC_REALM ?? "ledgerbuddy";
const E2E_KC_CLIENT_ID = process.env.E2E_OIDC_CLIENT_ID ?? "ledgerbuddy-app";
const E2E_KC_CLIENT_SECRET = process.env.E2E_OIDC_CLIENT_SECRET ?? "ledgerbuddy-local-secret";
export const E2E_TEST_PASSWORD = "E2eTestPass!1";

/**
 * Create a Keycloak user (if not exists) and return a session token via /api/auth/token ROPC proxy.
 */
export async function createE2EUserAndLogin(apiBaseUrl: string, email: string): Promise<string> {
  const token = await getKcAdminToken();
  // Create user in Keycloak
  const createResponse = await axios.post(
    `${E2E_KC_BASE}/admin/realms/${E2E_KC_REALM}/users`,
    {
      username: email,
      email,
      firstName: email.split("@")[0],
      lastName: "User",
      emailVerified: true,
      enabled: true,
      credentials: [{ type: "password", value: E2E_TEST_PASSWORD, temporary: false }]
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      validateStatus: () => true
    }
  );
  if (createResponse.status !== 201 && createResponse.status !== 409) {
    throw new Error(`Failed to create E2E Keycloak user '${email}': HTTP ${createResponse.status} — ${JSON.stringify(createResponse.data)}`);
  }

  // If user already exists (e.g. created by invite flow with empty password), reset password
  if (createResponse.status === 409) {
    const searchResp = await axios.get(
      `${E2E_KC_BASE}/admin/realms/${E2E_KC_REALM}/users?email=${encodeURIComponent(email)}&exact=true`,
      { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true }
    );
    if (searchResp.status === 200 && Array.isArray(searchResp.data) && searchResp.data.length > 0) {
      const userId = (searchResp.data as Array<{ id: string }>)[0].id;
      await axios.put(
        `${E2E_KC_BASE}/admin/realms/${E2E_KC_REALM}/users/${userId}/reset-password`,
        { type: "password", value: E2E_TEST_PASSWORD, temporary: false },
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, validateStatus: () => true }
      );
    }
  }

  return loginWithPassword(apiBaseUrl, email, E2E_TEST_PASSWORD);
}

/**
 * Login with a known password (seeded demo users or onboarded tenant admins).
 */
export async function loginWithPassword(apiBaseUrl: string, email: string, password: string): Promise<string> {
  const response = await axios.post(
    `${apiBaseUrl}/api/auth/token`,
    { email, password },
    { validateStatus: () => true }
  );
  if (response.status !== 200) {
    throw new Error(`Login failed for '${email}': HTTP ${response.status} — ${JSON.stringify(response.data)}`);
  }
  const sessionToken = response.data?.token;
  if (typeof sessionToken !== "string" || !sessionToken) {
    throw new Error(`Login for '${email}' returned no session token.`);
  }
  return sessionToken;
}

/**
 * Delete a Keycloak user by email (call in afterAll for cleanup).
 */
async function deleteE2EKeycloakUser(email: string): Promise<void> {
  try {
    const token = await getKcAdminToken();
    const searchResponse = await axios.get(
      `${E2E_KC_BASE}/admin/realms/${E2E_KC_REALM}/users`,
      {
        params: { email, exact: true },
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true
      }
    );
    if (searchResponse.status !== 200 || !Array.isArray(searchResponse.data) || searchResponse.data.length === 0) {
      return;
    }
    const userId = (searchResponse.data as Array<{ id: string }>)[0].id;
    await axios.delete(
      `${E2E_KC_BASE}/admin/realms/${E2E_KC_REALM}/users/${userId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true
      }
    );
  } catch {
    // Best-effort cleanup — ignore errors
  }
}

export async function completeE2ETenantOnboarding(apiBaseUrl: string, token: string): Promise<void> {
  const sessionResponse = await axios.get(`${apiBaseUrl}/api/session`, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true
  });
  if (sessionResponse.status !== 200) {
    throw new Error(`Failed to fetch session context for onboarding (HTTP ${sessionResponse.status}).`);
  }

  const onboardingStatus = String(sessionResponse.data?.tenant?.onboarding_status ?? "");
  if (onboardingStatus === "completed") {
    return;
  }

  const tenantName = String(sessionResponse.data?.tenant?.name ?? "").trim() || "local-tenant";
  const adminEmail = String(sessionResponse.data?.user?.email ?? "").trim() || "admin@local.test";
  const completeResponse = await axios.post(
    `${apiBaseUrl}/api/tenant/onboarding/complete`,
    {
      tenantName,
      adminEmail
    },
    {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: () => true
    }
  );
  if (completeResponse.status < 200 || completeResponse.status >= 300) {
    throw new Error(`Failed to complete tenant onboarding (HTTP ${completeResponse.status}).`);
  }
}

async function getKcAdminToken(): Promise<string> {
  const response = await axios.post(
    `${E2E_KC_BASE}/realms/${E2E_KC_REALM}/protocol/openid-connect/token`,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: E2E_KC_CLIENT_ID,
      client_secret: E2E_KC_CLIENT_SECRET
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      validateStatus: () => true
    }
  );
  if (response.status !== 200) {
    throw new Error(`Failed to get Keycloak admin token: HTTP ${response.status}`);
  }
  const token = response.data?.access_token;
  if (typeof token !== "string" || !token) {
    throw new Error("Keycloak admin token response missing access_token.");
  }
  return token;
}
