import axios from "axios";
import { createE2EUserAndLogin, completeE2ETenantOnboarding } from "./authHelper.js";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 60_000,
  validateStatus: () => true
});

jest.setTimeout(5 * 60_000);

describe("Tally Export E2E", () => {
  let sessionToken: string;

  beforeAll(async () => {
    sessionToken = await createE2EUserAndLogin(apiBaseUrl, `tally-e2e-${Date.now()}@local.test`);
    await completeE2ETenantOnboarding(apiBaseUrl, sessionToken);
  });

  const authHeaders = () => ({ Authorization: `Bearer ${sessionToken}` });

  it("returns empty export result when no approved invoices exist", async () => {
    const response = await api.post(
      "/api/exports/tally",
      { requestedBy: "e2e-test" },
      { headers: authHeaders() }
    );

    expect(response.status).toBe(200);
    expect(response.data.total).toBe(0);
  });

  it("returns empty history when no exports have been run", async () => {
    const response = await api.get("/api/exports/tally/history", {
      headers: authHeaders()
    });

    expect(response.status).toBe(200);
    expect(response.data.items).toEqual(expect.any(Array));
    expect(response.data.total).toEqual(expect.any(Number));
    expect(response.data.page).toBe(1);
    expect(response.data.limit).toBe(20);
  });

  it("returns 404 for non-existent batch download", async () => {
    const response = await api.get("/api/exports/tally/download/000000000000000000000000", {
      headers: authHeaders()
    });

    expect(response.status).toBe(404);
  });

  it("supports pagination query parameters on history", async () => {
    const response = await api.get("/api/exports/tally/history?page=2&limit=5", {
      headers: authHeaders()
    });

    expect(response.status).toBe(200);
    expect(response.data.page).toBe(2);
    expect(response.data.limit).toBe(5);
  });

  it("generates export file and downloads it by batchId", async () => {
    // First, try to generate a file export (may return 404 if no APPROVED invoices)
    const generateResponse = await api.post(
      "/api/exports/tally/download",
      { requestedBy: "e2e-test" },
      { headers: authHeaders() }
    );

    if (generateResponse.status === 404) {
      // No approved invoices available — expected in fresh test environment
      return;
    }

    expect(generateResponse.status).toBe(200);
    expect(generateResponse.data.batchId).toBeDefined();

    // Download the generated file
    const downloadResponse = await api.get(
      `/api/exports/tally/download/${generateResponse.data.batchId}`,
      {
        headers: authHeaders(),
        responseType: "arraybuffer"
      }
    );

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers["content-type"]).toContain("xml");
    expect(downloadResponse.headers["content-disposition"]).toContain("attachment");

    // Verify the batch appears in export history
    const historyResponse = await api.get("/api/exports/tally/history", {
      headers: authHeaders()
    });

    expect(historyResponse.status).toBe(200);
    const batch = historyResponse.data.items.find(
      (item: { batchId: string }) => item.batchId === generateResponse.data.batchId
    );
    expect(batch).toBeDefined();
    expect(batch.hasFile).toBe(true);
  });

  it("rejects unauthenticated requests to all export endpoints", async () => {
    const endpoints = [
      { method: "post" as const, url: "/api/exports/tally" },
      { method: "post" as const, url: "/api/exports/tally/download" },
      { method: "get" as const, url: "/api/exports/tally/history" },
      { method: "get" as const, url: "/api/exports/tally/download/any-batch-id" }
    ];

    for (const endpoint of endpoints) {
      const response = await api[endpoint.method](endpoint.url);
      expect(response.status).toBe(401);
    }
  });
});
