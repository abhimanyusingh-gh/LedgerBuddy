import axios from "axios";
import mongoose from "mongoose";
import { randomUUID, createHash } from "node:crypto";
import { createSessionToken } from "@/auth/sessionToken.js";
import { UserModel } from "@/models/core/User.js";
import { TenantModel } from "@/models/core/Tenant.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { TenantInviteModel } from "@/models/integration/TenantInvite.js";
import { TenantIntegrationModel } from "@/models/integration/TenantIntegration.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { MailboxNotificationEventModel } from "@/models/integration/MailboxNotificationEvent.js";
import { decryptSecret, encryptSecret } from "@/utils/secretCrypto.js";
import { createE2EUserAndLogin, E2E_TEST_PASSWORD } from "./authHelper.js";
import { buildXoauth2AuthorizationHeader } from "@/sources/email/xoauth2.js";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";
const mailhogApiBaseUrl = process.env.E2E_MAILHOG_API_BASE_URL ?? "http://127.0.0.1:8125";
const mongoUri = process.env.E2E_MONGO_URI ?? "mongodb://billforge_app:billforge_local_pass@127.0.0.1:27018/billforge?authSource=billforge";

const sessionSecret = process.env.APP_SESSION_SIGNING_SECRET ?? "local-dev-session-signing-secret-change-me";
const refreshTokenSecret = process.env.REFRESH_TOKEN_ENCRYPTION_SECRET ?? "local-dev-refresh-token-secret-32-chars";
const localOauthClientId = process.env.OIDC_CLIENT_ID ?? "billforge-app";
const localOauthClientSecret = process.env.OIDC_CLIENT_SECRET ?? "billforge-local-secret";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 60_000,
  validateStatus: () => true
});

jest.setTimeout(15 * 60_000);

describe("saas lifecycle e2e", () => {
  beforeAll(async () => {
    const health = await api.get("/health");
    expect(health.status).toBe(200);
    expect(health.data?.ready).toBe(true);
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("phase 1: OAuth login, state validation, JWT authn guard, and encrypted refresh token persistence", async () => {
    const email = uniqueEmail("phase1-admin");
    const tokenA = await loginAs(email);
    const tokenB = await loginAs(email);

    expect(typeof tokenA).toBe("string");
    expect(tokenA.length).toBeGreaterThan(0);
    expect(typeof tokenB).toBe("string");
    expect(tokenB.length).toBeGreaterThan(0);

    const session = await api.get("/api/session", {
      headers: authHeaders(tokenA)
    });
    expect(session.status).toBe(200);
    expect(session.data?.user?.email).toBe(email);

    const unauthenticated = await api.get("/api/session");
    expect(unauthenticated.status).toBe(401);

    const tampered = await api.get("/api/session", {
      headers: authHeaders(`${tokenA.slice(0, -3)}abc`)
    });
    expect(tampered.status).toBe(401);

    const invalidState = await api.get("/api/auth/callback?code=fake-code&state=invalid-state-token");
    expect(invalidState.status).toBe(400);
    expect(String(invalidState.data?.message ?? "")).toContain("OAuth state");

    const users = await UserModel.find({ email }).lean();
    expect(users).toHaveLength(1);
    const user = users[0];
    expect(typeof user?.encryptedRefreshToken).toBe("string");
    expect((user?.encryptedRefreshToken ?? "").length).toBeGreaterThan(10);

    const decrypted = decryptSecret(String(user?.encryptedRefreshToken ?? ""), refreshTokenSecret);
    expect(decrypted.length).toBeGreaterThan(10);
    expect(decrypted).not.toEqual(user?.encryptedRefreshToken);
  });

  it("phase 2/3: creates tenant on first login, scopes data by tenant, and enforces onboarding lifecycle", async () => {
    const adminEmail = uniqueEmail("phase23-admin");
    const adminToken = await loginAs(adminEmail);
    const adminSession = await getSession(adminToken);

    expect(adminSession.tenant.onboarding_status).toBe("pending");
    expect(adminSession.flags.requires_tenant_setup).toBe(true);
    expect(adminSession.user.role).toBe("TENANT_ADMIN");

    const adminUser = await UserModel.findOne({ email: adminEmail }).lean();
    expect(adminUser).not.toBeNull();
    const adminTenant = await TenantModel.findById(adminUser!.tenantId).lean();
    expect(adminTenant).not.toBeNull();
    expect(adminTenant?.onboardingStatus).toBe("pending");

    const blockedInvoices = await api.get("/api/invoices?page=1&limit=5", {
      headers: authHeaders(adminToken)
    });
    expect(blockedInvoices.status).toBe(403);
    expect(blockedInvoices.data?.requires_tenant_setup).toBe(true);

    const memberEmail = uniqueEmail("phase23-member");
    await UserModel.create({
      email: memberEmail,
      externalSubject: `seed-${memberEmail}`,
      tenantId: adminUser!.tenantId,
      displayName: "Seed Member",
      encryptedRefreshToken: "seed",
      lastLoginAt: new Date()
    });
    const seededMember = await UserModel.findOne({ email: memberEmail }).lean();
    await TenantUserRoleModel.findOneAndUpdate(
      {
        tenantId: adminUser!.tenantId,
        userId: String(seededMember!._id)
      },
      {
        tenantId: adminUser!.tenantId,
        userId: String(seededMember!._id),
        role: "ap_clerk"
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const memberToken = await loginAs(memberEmail);

    const nonAdminComplete = await api.post(
      "/api/tenant/onboarding/complete",
      {
        tenantName: "blocked",
        adminEmail: memberEmail
      },
      {
        headers: authHeaders(memberToken)
      }
    );
    expect(nonAdminComplete.status).toBe(403);

    await completeOnboarding(adminToken, "phase23-tenant", adminEmail);

    const repeatOnboarding = await api.post(
      "/api/tenant/onboarding/complete",
      {
        tenantName: "phase23-tenant",
        adminEmail
      },
      {
        headers: authHeaders(adminToken)
      }
    );
    expect(repeatOnboarding.status).toBe(409);

    const completeSession = await getSession(adminToken);
    expect(completeSession.flags.requires_tenant_setup).toBe(false);
    expect(completeSession.tenant.onboarding_status).toBe("completed");

    const invoice = await InvoiceModel.create({
      tenantId: adminUser!.tenantId,
      workloadTier: "standard",
      sourceType: "folder",
      sourceKey: "local-folder",
      sourceDocumentId: `phase23-${randomUUID()}.pdf`,
      attachmentName: `phase23-${randomUUID()}.pdf`,
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      parsed: {
        vendorName: "Phase23 Vendor",
        invoiceNumber: "P23-1",
        invoiceDate: "2026-02-27",
        currency: "USD",
        totalAmountMinor: 12500
      }
    });

    const otherTenantToken = await loginAs(uniqueEmail("phase23-other"));
    await completeOnboarding(otherTenantToken, "other-tenant", uniqueEmail("phase23-other-admin"));
    const crossTenant = await api.get(`/api/invoices/${String(invoice._id)}`, {
      headers: authHeaders(otherTenantToken)
    });
    expect(crossTenant.status).toBe(404);

    const forgedToken = createSessionToken({
      userId: "000000000000000000000000",
      email: "ghost@local.test",
      tenantId: "ghost-tenant",
      role: "TENANT_ADMIN",
      isPlatformAdmin: false,
      ttlSeconds: 3600,
      secret: sessionSecret
    });
    const missingTenantContext = await api.get("/api/session", {
      headers: authHeaders(forgedToken)
    });
    expect(missingTenantContext.status).toBe(401);
  });

  it("phase 4/5: enforces RBAC, invite lifecycle, single-use tokens, expiry, and MailHog delivery", async () => {
    const adminEmail = uniqueEmail("phase45-admin");
    const adminToken = await loginAs(adminEmail);
    await completeOnboarding(adminToken, "phase45-tenant", adminEmail);
    const adminSession = await getSession(adminToken);
    const tenantId = String(adminSession.tenant.id);

    const candidateEmail = uniqueEmail("phase45-candidate");
    const inviteStartMs = Date.now();
    const inviteOne = await api.post(
      "/api/admin/users/invite",
      { email: candidateEmail },
      { headers: authHeaders(adminToken) }
    );
    expect(inviteOne.status).toBe(201);
    const inviteTwo = await api.post(
      "/api/admin/users/invite",
      { email: candidateEmail },
      { headers: authHeaders(adminToken) }
    );
    expect(inviteTwo.status).toBe(201);

    const activeInviteCount = await TenantInviteModel.countDocuments({
      tenantId,
      email: candidateEmail,
      acceptedAt: { $exists: false }
    });
    expect(activeInviteCount).toBe(1);

    const candidateToken = await pollInviteTokenFromMailhog(candidateEmail, inviteStartMs);
    expect(candidateToken.length).toBeGreaterThan(10);

    const candidateUserToken = await loginAs(candidateEmail);
    const acceptInvite = await api.post(
      "/api/tenant/invites/accept",
      { token: candidateToken },
      { headers: authHeaders(candidateUserToken) }
    );
    expect(acceptInvite.status).toBe(204);

    // After acceptance the user's tenantId in MongoDB changes — re-login to get a fresh token
    // with the correct tenantId so subsequent authenticated requests succeed.
    const freshCandidateToken = await loginAs(candidateEmail);

    const reuseInvite = await api.post(
      "/api/tenant/invites/accept",
      { token: candidateToken },
      { headers: authHeaders(freshCandidateToken) }
    );
    expect(reuseInvite.status).toBe(409);

    const candidateUser = await UserModel.findOne({ email: candidateEmail }).lean();
    expect(candidateUser?.tenantId).toBe(tenantId);
    const candidateRole = await TenantUserRoleModel.findOne({
      tenantId,
      userId: String(candidateUser?._id)
    }).lean();
    expect(candidateRole?.role).toBe("ap_clerk");

    const nonAdminInvite = await api.post(
      "/api/admin/users/invite",
      { email: uniqueEmail("phase45-denied") },
      { headers: authHeaders(freshCandidateToken) }
    );
    expect(nonAdminInvite.status).toBe(403);

    const nonAdminEscalate = await api.post(
      `/api/admin/users/${String(candidateUser?._id)}/role`,
      { role: "TENANT_ADMIN" },
      { headers: authHeaders(freshCandidateToken) }
    );
    expect(nonAdminEscalate.status).toBe(403);

    const rolePromote = await api.post(
      `/api/admin/users/${String(candidateUser?._id)}/role`,
      { role: "TENANT_ADMIN" },
      { headers: authHeaders(adminToken) }
    );
    expect(rolePromote.status).toBe(204);

    const expiringEmail = uniqueEmail("phase45-expire");
    const expireStart = Date.now();
    const expiringInvite = await api.post(
      "/api/admin/users/invite",
      { email: expiringEmail },
      { headers: authHeaders(adminToken) }
    );
    expect(expiringInvite.status).toBe(201);
    const expiringToken = await pollInviteTokenFromMailhog(expiringEmail, expireStart);
    const tokenHash = createHash("sha256").update(expiringToken).digest("base64url");
    await TenantInviteModel.updateOne(
      { tokenHash },
      {
        $set: {
          expiresAt: new Date(Date.now() - 60_000)
        }
      }
    );

    const expiringUserToken = await loginAs(expiringEmail);
    const expiredAccept = await api.post(
      "/api/tenant/invites/accept",
      { token: expiringToken },
      { headers: authHeaders(expiringUserToken) }
    );
    expect(expiredAccept.status).toBe(410);
  });

  it("phase 7/8: enforces tenant-owned Gmail admin setup, encrypted refresh token, XOAUTH2 shape, and reauth flags", async () => {
    const adminEmail = uniqueEmail("phase78-admin");
    const adminToken = await loginAs(adminEmail);
    await completeOnboarding(adminToken, "phase78-tenant", adminEmail);
    const session = await getSession(adminToken);
    const tenantId = String(session.tenant.id);

    const connectUrlResponse = await api.get("/api/integrations/gmail/connect-url", {
      headers: authHeaders(adminToken)
    });
    expect(connectUrlResponse.status).toBe(200);
    expect(typeof connectUrlResponse.data?.connectUrl).toBe("string");

    const finalRedirect = await completeKcOAuthRedirectChain(
      String(connectUrlResponse.data.connectUrl),
      adminEmail,
      E2E_TEST_PASSWORD
    );
    expect(finalRedirect).toContain("gmail=connected");

    const integration = await TenantIntegrationModel.findOne({
      tenantId,
      provider: "gmail"
    }).lean();
    expect(integration).not.toBeNull();
    expect(integration?.status).toBe("connected");
    expect(typeof integration?.encryptedRefreshToken).toBe("string");
    expect((integration?.encryptedRefreshToken ?? "").length).toBeGreaterThan(10);

    const refreshToken = decryptSecret(String(integration?.encryptedRefreshToken ?? ""), refreshTokenSecret);
    expect(refreshToken.length).toBeGreaterThan(10);

    const kcTokenUrl = process.env.E2E_KEYCLOAK_BASE_URL
      ? `${process.env.E2E_KEYCLOAK_BASE_URL}/realms/${process.env.E2E_KC_REALM ?? "billforge"}/protocol/openid-connect/token`
      : "http://127.0.0.1:8280/realms/billforge/protocol/openid-connect/token";
    const tokenResponse = await axios.post(
      kcTokenUrl,
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: localOauthClientId,
        client_secret: localOauthClientSecret,
        refresh_token: refreshToken
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 20_000,
        validateStatus: () => true
      }
    );
    expect(tokenResponse.status).toBe(200);
    expect(typeof tokenResponse.data?.access_token).toBe("string");
    const accessToken = String(tokenResponse.data.access_token);

    const xoauthHeader = buildXoauth2AuthorizationHeader(String(integration?.emailAddress ?? ""), accessToken);
    const encoded = xoauthHeader.replace(/^XOAUTH2\s+/i, "").trim();
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    expect(decoded).toContain(`user=${integration?.emailAddress}`);
    expect(decoded).toContain(`auth=Bearer ${accessToken}`);

    const memberEmail = uniqueEmail("phase78-member");
    const inviteStartMs = Date.now();
    const invite = await api.post(
      "/api/admin/users/invite",
      { email: memberEmail },
      { headers: authHeaders(adminToken) }
    );
    expect(invite.status).toBe(201);
    const memberInviteToken = await pollInviteTokenFromMailhog(memberEmail, inviteStartMs);
    const memberToken = await loginAs(memberEmail);
    const accept = await api.post(
      "/api/tenant/invites/accept",
      { token: memberInviteToken },
      { headers: authHeaders(memberToken) }
    );
    expect(accept.status).toBe(204);

    // Re-login after acceptance — tenantId in MongoDB changed, old token is stale
    const freshMemberToken = await loginAs(memberEmail);

    const nonAdminConnect = await api.get("/api/integrations/gmail/connect-url", {
      headers: authHeaders(freshMemberToken)
    });
    expect(nonAdminConnect.status).toBe(403);

    await TenantIntegrationModel.updateOne(
      { tenantId, provider: "gmail" },
      {
        $set: {
          status: "requires_reauth",
          encryptedRefreshToken: encryptSecret("invalid-refresh-token", refreshTokenSecret),
          lastErrorReason: "OAuth refresh token rejected: invalid_grant"
        }
      }
    );

    const notificationBefore = await MailboxNotificationEventModel.countDocuments({
      userId: String(session.user.id),
      provider: "gmail"
    });
    expect(notificationBefore).toBeGreaterThanOrEqual(0);

    const adminFlags = await getSession(adminToken);
    expect(adminFlags.flags.requires_reauth).toBe(true);
    expect(adminFlags.flags.requires_admin_action).toBe(true);

    const memberFlags = await getSession(freshMemberToken);
    expect(memberFlags.flags.requires_reauth).toBe(true);
    expect(memberFlags.flags.requires_admin_action).toBe(false);
  });
});

async function loginAs(email: string): Promise<string> {
  return createE2EUserAndLogin(apiBaseUrl, email);
}

async function getSession(token: string): Promise<{
  user: { id: string; email: string; role: string };
  tenant: { id: string; name: string; onboarding_status: "pending" | "completed" };
  flags: {
    requires_tenant_setup: boolean;
    requires_reauth: boolean;
    requires_admin_action: boolean;
    requires_email_confirmation: boolean;
  };
}> {
  const response = await api.get("/api/session", {
    headers: authHeaders(token)
  });
  expect(response.status).toBe(200);
  return response.data;
}

async function completeOnboarding(token: string, tenantName: string, adminEmail: string): Promise<void> {
  const response = await api.post(
    "/api/tenant/onboarding/complete",
    {
      tenantName,
      adminEmail
    },
    {
      headers: authHeaders(token)
    }
  );
  expect(response.status).toBe(204);
}

async function pollInviteTokenFromMailhog(recipient: string, startedAfterMs: number): Promise<string> {
  const timeoutAt = Date.now() + 30_000;
  while (Date.now() < timeoutAt) {
    const messages = await fetchMailMessages();
    const token = extractInviteToken(messages, recipient, startedAfterMs);
    if (token) {
      return token;
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for invite email token for recipient '${recipient}'.`);
}

async function fetchMailMessages(): Promise<unknown[]> {
  const v2 = await axios.get(`${mailhogApiBaseUrl}/api/v2/messages`, {
    timeout: 15_000,
    validateStatus: () => true
  });
  if (v2.status === 200 && Array.isArray(v2.data?.items)) {
    return v2.data.items;
  }

  const v1 = await axios.get(`${mailhogApiBaseUrl}/api/v1/messages`, {
    timeout: 15_000,
    validateStatus: () => true
  });
  if (v1.status !== 200) {
    return [];
  }

  const messages: unknown[] = Array.isArray(v1.data)
    ? v1.data
    : Array.isArray(v1.data?.messages)
      ? v1.data.messages
      : [];

  // Mailpit returns summary list without body — enrich with full message details
  if (messages.length > 0 && isMailpitFormat(messages[0])) {
    const enriched = await Promise.all(
      messages.map(async (m) => {
        const id = (m as { ID?: string }).ID;
        if (!id) return m;
        const detail = await axios.get(`${mailhogApiBaseUrl}/api/v1/message/${id}`, {
          timeout: 10_000,
          validateStatus: () => true
        });
        if (detail.status !== 200) return m;
        // Preserve Created from list entry (millisecond precision) since individual message
        // only provides Date at second precision, causing timestamp filter false-negatives
        const listCreated = (m as { Created?: string }).Created;
        return listCreated ? { ...detail.data, Created: listCreated } : detail.data;
      })
    );
    return enriched;
  }

  return messages;
}

function isMailpitFormat(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as Record<string, unknown>;
  return typeof m.ID === "string" && !m.Content;
}

function extractInviteToken(messages: unknown[], recipient: string, startedAfterMs: number): string {
  const target = recipient.toLowerCase();
  const sorted = [...messages].sort((left, right) => {
    const leftTs = parseCreatedAt(left);
    const rightTs = parseCreatedAt(right);
    return rightTs - leftTs;
  });

  for (const message of sorted) {
    const createdAt = parseCreatedAt(message);
    if (createdAt > 0 && createdAt < startedAfterMs) {
      continue;
    }
    if (!containsRecipient(message, target)) {
      continue;
    }

    for (const candidate of getMessageTextCandidates(message)) {
      const decoded = decodeQuotedPrintable(candidate);
      const tokenMatch = decoded.match(/invite\?token=([A-Za-z0-9._~-]+)/i);
      if (tokenMatch?.[1]) {
        return decodeURIComponent(tokenMatch[1]);
      }
    }
  }

  return "";
}

function containsRecipient(message: unknown, recipient: string): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }

  const toEntries = (message as { To?: Array<{ Mailbox?: unknown; Domain?: unknown }> }).To;
  if (!Array.isArray(toEntries)) {
    return JSON.stringify(message).toLowerCase().includes(recipient);
  }

  return toEntries.some((entry) => {
    const mailbox = typeof entry?.Mailbox === "string" ? entry.Mailbox.toLowerCase() : "";
    const domain = typeof entry?.Domain === "string" ? entry.Domain.toLowerCase() : "";
    const address = typeof (entry as { Address?: unknown }).Address === "string" ? (entry as { Address: string }).Address.toLowerCase() : "";
    if (address) {
      return address === recipient;
    }
    const combined = mailbox && domain ? `${mailbox}@${domain}` : "";
    return combined === recipient;
  });
}

function getMessageTextCandidates(message: unknown): string[] {
  if (!message || typeof message !== "object") {
    return [];
  }

  const contentBody =
    typeof (message as { Content?: { Body?: unknown } }).Content?.Body === "string"
      ? (message as { Content: { Body: string } }).Content.Body
      : "";
  const rawData =
    typeof (message as { Raw?: { Data?: unknown } }).Raw?.Data === "string"
      ? (message as { Raw: { Data: string } }).Raw.Data
      : "";
  const textBody = typeof (message as { Text?: unknown }).Text === "string" ? String((message as { Text: string }).Text) : "";
  const htmlBody = typeof (message as { HTML?: unknown }).HTML === "string" ? String((message as { HTML: string }).HTML) : "";

  return [contentBody, rawData, textBody, htmlBody].filter((value) => value.length > 0);
}

function decodeQuotedPrintable(value: string): string {
  const unfolded = value.replace(/=\r?\n/g, "");
  return unfolded.replace(/=([A-Fa-f0-9]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

function parseCreatedAt(message: unknown): number {
  if (!message || typeof message !== "object") {
    return 0;
  }
  const created = (message as { Created?: unknown; Date?: unknown }).Created ?? (message as { Date?: unknown }).Date;
  if (typeof created !== "string") {
    return 0;
  }
  const parsed = Date.parse(created);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Follows a redirect chain that may include a Keycloak login form.
 * When a KC HTML login page is encountered, it automatically submits the provided credentials
 * and continues following redirects — simulating a headless browser OAuth flow.
 */
async function completeKcOAuthRedirectChain(
  startUrl: string,
  email: string,
  password: string,
  maxHops = 15
): Promise<string> {
  const cookieStore = new Map<string, string>();
  let currentUrl = startUrl;

  function getCookieHeader(): string {
    return Array.from(cookieStore.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  function updateCookies(headers: Record<string, unknown>): void {
    const setCookies = headers["set-cookie"];
    const list = Array.isArray(setCookies) ? setCookies : setCookies ? [String(setCookies)] : [];
    for (const c of list) {
      const [pair] = c.split(";");
      const [k, ...vParts] = (pair ?? "").split("=");
      if (k?.trim()) cookieStore.set(k.trim(), vParts.join("=").trim());
    }
  }

  for (let hop = 0; hop < maxHops; hop++) {
    const response = await axios.get(currentUrl, {
      timeout: 30_000,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: { Cookie: getCookieHeader() }
    });
    updateCookies(response.headers as Record<string, unknown>);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) break;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (response.status === 200) {
      const body = String(response.data ?? "");
      const formActionMatch = body.match(/action="([^"]+)"/);
      if (formActionMatch && body.includes("password") && body.includes("username")) {
        // Decode HTML entities in form action (KC encodes & as &amp;)
        const formAction = (formActionMatch[1] ?? "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"');
        const formUrl = new URL(formAction, currentUrl).toString();

        const postResp = await axios.post(
          formUrl,
          new URLSearchParams({ username: email, password, credentialId: "" }).toString(),
          {
            maxRedirects: 0,
            validateStatus: () => true,
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Cookie: getCookieHeader()
            }
          }
        );
        updateCookies(postResp.headers as Record<string, unknown>);

        if (postResp.status >= 300 && postResp.status < 400) {
          const loc = postResp.headers.location;
          if (loc) {
            currentUrl = new URL(loc, formUrl).toString();
            continue;
          }
        }
      }
      return currentUrl;
    }
    break;
  }
  return currentUrl;
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

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@local.test`;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
