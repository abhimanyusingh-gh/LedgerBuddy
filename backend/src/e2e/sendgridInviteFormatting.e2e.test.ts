import axios from "axios";
import mongoose from "mongoose";
import { createE2ESessionTokenWithOptions, completeE2ETenantOnboarding } from "./authHelper.js";
import { pollForEmail } from "./mailhogHelper.js";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";
const mailhogApiBaseUrl = process.env.E2E_MAILHOG_API_BASE_URL ?? "http://127.0.0.1:8125";
const mongoUri = process.env.E2E_MONGO_URI ?? "mongodb://billforge_app:billforge_local_pass@127.0.0.1:27018/billforge?authSource=billforge";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 60_000,
  validateStatus: () => true
});

jest.setTimeout(3 * 60_000);

describe("sendgrid invite formatting e2e", () => {
  beforeAll(async () => {
    const health = await api.get("/health");
    expect(health.status).toBe(200);
    expect(health.data?.ready).toBe(true);
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("delivers invite email to MailHog with formatted invite details", async () => {
    const adminEmail = `sendgrid-admin-${Date.now()}@local.test`;
    const inviteeEmail = `sendgrid-invitee-${Date.now()}@local.test`;
    const adminToken = await createE2ESessionTokenWithOptions(apiBaseUrl, { loginHint: adminEmail });
    await completeE2ETenantOnboarding(apiBaseUrl, adminToken);

    const inviteStartMs = Date.now();
    const inviteResponse = await api.post(
      "/api/admin/users/invite",
      { email: inviteeEmail },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`
        }
      }
    );
    expect(inviteResponse.status).toBe(201);

    const inviteMessage = await pollForEmail(
      mailhogApiBaseUrl,
      inviteeEmail,
      inviteStartMs,
      (msg) => msg.decodedBody.includes("invite?token=")
    );
    expect(inviteMessage.subject).toContain("You were invited to BillForge");
    expect(inviteMessage.decodedBody).toContain("You were invited to join a tenant in BillForge.");
    expect(inviteMessage.decodedBody).toMatch(/Accept invite:\s+http:\/\/localhost:5177\/invite\?token=/i);
    expect(inviteMessage.decodedBody).toContain("Expires at:");
    expect(inviteMessage.decodedBody).toContain("<strong>Accept invite:</strong>");
  });
});
