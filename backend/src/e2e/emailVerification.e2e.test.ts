import axios from "axios";
import mongoose from "mongoose";
import { loginWithPassword } from "./authHelper.js";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";
const mongoUri = process.env.E2E_MONGO_URI ?? "mongodb://billforge_app:billforge_local_pass@127.0.0.1:27018/billforge?authSource=billforge";

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

    platformAdminToken = await loginWithPassword(apiBaseUrl, "platform-admin@local.test", "DemoPass!1");
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("platform-onboarded admin can log in with temp password (Keycloak owns credentials)", async () => {
    const uniqueSuffix = Date.now();
    const tenantName = `E2E Verify ${uniqueSuffix}`;
    const adminEmail = `verify-admin-${uniqueSuffix}@local.test`;

    // 1. Create tenant — Keycloak creates user with temporary=true password
    const onboardResponse = await api.post(
      "/api/platform/tenants/onboard-admin",
      { tenantName, adminEmail },
      { headers: { Authorization: `Bearer ${platformAdminToken}` } }
    );
    expect(onboardResponse.status).toBe(201);
    const tempPassword = onboardResponse.data?.tempPassword as string;
    expect(tempPassword).toBeTruthy();

    // 2. Log in with temp password — must_change_password should be true
    const loginResponse = await api.post("/api/auth/token", {
      email: adminEmail,
      password: tempPassword
    });
    expect(loginResponse.status).toBe(200);
    const adminToken = loginResponse.data?.token as string;
    expect(adminToken).toBeTruthy();

    // 3. Verify session flags
    const sessionResponse = await api.get("/api/session", {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    expect(sessionResponse.status).toBe(200);
    expect(sessionResponse.data?.flags?.must_change_password).toBe(true);
  });
});
