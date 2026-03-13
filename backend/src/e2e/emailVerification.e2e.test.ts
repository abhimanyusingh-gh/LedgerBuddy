import axios from "axios";
import mongoose from "mongoose";
import { createE2ESessionTokenWithOptions } from "./authHelper.js";
import { pollForEmail } from "./mailhogHelper.js";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";
const mailhogApiBaseUrl = process.env.E2E_MAILHOG_API_BASE_URL ?? "http://127.0.0.1:8125";
const mongoUri = process.env.E2E_MONGO_URI ?? "mongodb://127.0.0.1:27018/billforge";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 60_000,
  validateStatus: () => true
});

jest.setTimeout(3 * 60_000);

describe("email verification e2e", () => {
  let platformAdminToken: string;

  beforeAll(async () => {
    const health = await api.get("/health");
    expect(health.status).toBe(200);
    expect(health.data?.ready).toBe(true);
    await mongoose.connect(mongoUri);

    platformAdminToken = await createE2ESessionTokenWithOptions(apiBaseUrl, {
      loginHint: "platform-admin@local.test"
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("sends verification email and verifies token flow", async () => {
    const uniqueSuffix = Date.now();
    const tenantName = `E2E Verify ${uniqueSuffix}`;
    const adminEmail = `verify-admin-${uniqueSuffix}@local.test`;
    const startMs = Date.now();

    // 1. Create tenant
    const onboardResponse = await api.post(
      "/api/platform/tenants/onboard-admin",
      { tenantName, adminEmail },
      { headers: { Authorization: `Bearer ${platformAdminToken}` } }
    );
    expect(onboardResponse.status).toBe(201);

    // 2. Poll MailHog for verification email
    const verificationEmail = await pollForEmail(
      mailhogApiBaseUrl,
      adminEmail,
      startMs,
      (msg) => msg.subject.includes("Welcome to BillForge") || msg.decodedBody.includes("verify-email?token=")
    );

    // 3. Verify email content
    expect(verificationEmail.subject).toContain("Welcome to BillForge");
    expect(verificationEmail.decodedBody).toMatch(/verify-email\?token=/);

    // 4. Extract verification link
    const tokenMatch = verificationEmail.decodedBody.match(/verify-email\?token=([A-Za-z0-9_-]+)/);
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1];

    // 5. Verify user is NOT verified in DB
    const UserModel = mongoose.model("User", new mongoose.Schema({}, { strict: false }), "users");
    const userBefore = await UserModel.findOne({ email: adminEmail }).lean();
    expect(userBefore).toBeTruthy();
    expect((userBefore as Record<string, unknown>).emailVerified).toBeFalsy();

    // 6. Call verification link
    const verifyResponse = await api.get(`/auth/verify-email?token=${token}`);
    // Should redirect (302) or follow to final URL
    expect([200, 302]).toContain(verifyResponse.status);
    if (verifyResponse.status === 302) {
      expect(verifyResponse.headers.location).toContain("verified=true");
    }

    // 7. Verify user IS verified in DB
    const userAfter = await UserModel.findOne({ email: adminEmail }).lean();
    expect(userAfter).toBeTruthy();
    expect((userAfter as Record<string, unknown>).emailVerified).toBeTruthy();

    // 8. Verify HTML template elements
    expect(verificationEmail.decodedBody).toContain("BillForge");
    expect(verificationEmail.decodedBody).toMatch(/Verify Email|verify-email/i);
  });
});
