import axios from "axios";

export async function createE2ESessionToken(apiBaseUrl: string): Promise<string> {
  return createE2ESessionTokenWithOptions(apiBaseUrl, {});
}

export async function createE2ESessionTokenWithOptions(
  apiBaseUrl: string,
  options: {
    nextPath?: string;
    loginHint?: string;
  }
): Promise<string> {
  const loginUrl = new URL("/api/auth/login", apiBaseUrl);
  loginUrl.searchParams.set("next", options.nextPath ?? "/");
  if (options.loginHint?.trim()) {
    loginUrl.searchParams.set("login_hint", options.loginHint.trim());
  }

  const authorizeRedirect = await requestRedirect(loginUrl.toString());
  const callbackRedirect = await requestRedirect(authorizeRedirect);
  const frontendRedirect = await requestRedirect(callbackRedirect);
  const token = new URL(frontendRedirect).searchParams.get("token");
  if (!token) {
    throw new Error("OAuth callback did not return a session token.");
  }

  return token;
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

async function requestRedirect(url: string): Promise<string> {
  const response = await axios.get(url, {
    maxRedirects: 0,
    validateStatus: () => true
  });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`Expected redirect from ${url}, received HTTP ${response.status}.`);
  }
  const location = response.headers.location;
  if (typeof location !== "string" || location.trim().length === 0) {
    throw new Error(`Redirect from ${url} did not include location header.`);
  }
  return new URL(location, url).toString();
}
