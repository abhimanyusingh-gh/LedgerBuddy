import axios from "axios";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildXoauth2AuthorizationHeader } from "../sources/email/xoauth2.js";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const wrapperBaseUrl = process.env.E2E_MAILHOG_WRAPPER_URL ?? "http://127.0.0.1:8026";
const oauthClientId = process.env.E2E_EMAIL_OAUTH_CLIENT_ID ?? "mailhog-client";
const oauthClientSecret = process.env.E2E_EMAIL_OAUTH_CLIENT_SECRET ?? "mailhog-secret";
const oauthRefreshToken = process.env.E2E_EMAIL_OAUTH_REFRESH_TOKEN ?? "mailhog-refresh";
const emailUsername = process.env.E2E_EMAIL_USERNAME ?? "ap@example.com";
const seedFrom = process.env.E2E_EMAIL_FROM ?? "billing@example.com";
const seedTo = process.env.E2E_EMAIL_TO ?? "ap@example.com";
const sampleDir = process.env.E2E_EMAIL_SAMPLE_DIR ?? path.resolve(process.cwd(), "..", "sample-invoices", "inbox");

jest.setTimeout(10 * 60_000);

interface IngestStatus {
  state: "idle" | "running" | "completed" | "failed";
  running: boolean;
  totalFiles: number;
  processedFiles: number;
  newInvoices: number;
  duplicates: number;
  failures: number;
  error?: string;
}

interface SeedAttachmentPayload {
  filename: string;
  contentType: string;
  contentBase64: string;
}

describe("email XOAUTH2 ingestion e2e", () => {
  const api = axios.create({
    baseURL: apiBaseUrl,
    timeout: 60_000,
    validateStatus: () => true
  });

  let xoauth2HeaderValue = "";
  let expectedAttachmentNames: string[] = [];

  beforeAll(async () => {
    const health = await api.get("/health");
    expect(health.status).toBe(200);
    expect(health.data?.ready).toBe(true);

    const accessToken = await fetchAccessToken();
    xoauth2HeaderValue = buildXoauth2AuthorizationHeader(emailUsername, accessToken);

    const attachments = await loadSampleAttachments(sampleDir);
    expectedAttachmentNames = attachments.map((attachment) => attachment.filename).sort((left, right) =>
      left.localeCompare(right)
    );

    const batches = [attachments.slice(0, 2), attachments.slice(2, 3)].filter((batch) => batch.length > 0);
    expect(batches.length).toBe(2);
    expect(batches[0]?.length).toBeLessThanOrEqual(2);
    expect(batches[1]?.length).toBeLessThanOrEqual(2);

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index] ?? [];
      const seedResponse = await axios.post(
        `${wrapperBaseUrl}/seed`,
        {
          from: seedFrom,
          to: seedTo,
          subject: `E2E XOAUTH2 Invoice Batch ${index + 1}`,
          text: "Invoice attachments for ingestion e2e.",
          attachments: batch
        },
        {
          headers: {
            Authorization: xoauth2HeaderValue
          },
          timeout: 30_000
        }
      );
      expect(seedResponse.status).toBe(202);
    }
  });

  it("ingests seeded XOAUTH2 emails and checkpoints processed messages", async () => {
    const trigger = await api.post("/api/jobs/ingest");
    expect(trigger.status).toBe(202);

    const completed = await waitForIngestionCompletion(api);
    expect(completed.state).toBe("completed");
    expect(completed.totalFiles).toBe(3);
    expect(completed.processedFiles).toBe(3);
    expect(completed.newInvoices).toBe(3);
    expect(completed.failures).toBe(0);
    expect(completed.duplicates).toBe(0);

    const invoices = await api.get("/api/invoices?page=1&limit=50");
    expect(invoices.status).toBe(200);
    expect(Array.isArray(invoices.data?.items)).toBe(true);
    expect(invoices.data.items).toHaveLength(3);

    const attachmentNames = invoices.data.items
      .map((invoice: { attachmentName: string }) => invoice.attachmentName)
      .sort((left: string, right: string) => left.localeCompare(right));
    expect(attachmentNames).toEqual(expectedAttachmentNames);

    const rerunTrigger = await api.post("/api/jobs/ingest");
    expect(rerunTrigger.status).toBe(202);

    const rerun = await waitForIngestionCompletion(api);
    expect(rerun.state).toBe("completed");
    expect(rerun.totalFiles).toBe(0);
    expect(rerun.processedFiles).toBe(0);
    expect(rerun.newInvoices).toBe(0);
    expect(rerun.failures).toBe(0);
  });
});

async function fetchAccessToken(): Promise<string> {
  const response = await axios.post(
    `${wrapperBaseUrl}/oauth/token`,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: oauthRefreshToken,
      client_id: oauthClientId,
      client_secret: oauthClientSecret
    }).toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 15_000
    }
  );
  expect(response.status).toBe(200);
  expect(typeof response.data?.access_token).toBe("string");
  return response.data.access_token;
}

async function loadSampleAttachments(directory: string): Promise<SeedAttachmentPayload[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  const pdf = files.find((name) => name.toLowerCase().endsWith(".pdf"));
  const png = files.find((name) => name.toLowerCase().endsWith(".png"));
  const jpg = files.find((name) => name.toLowerCase().endsWith(".jpg") || name.toLowerCase().endsWith(".jpeg"));
  if (!pdf || !png || !jpg) {
    throw new Error(`Sample directory '${directory}' must include one .pdf, one .png and one .jpg/.jpeg file.`);
  }

  const selected = [pdf, png, jpg];
  const attachments: SeedAttachmentPayload[] = [];

  for (const fileName of selected) {
    const filePath = path.join(directory, fileName);
    const content = await fs.readFile(filePath);
    attachments.push({
      filename: fileName,
      contentType: resolveMimeType(fileName),
      contentBase64: content.toString("base64")
    });
  }

  return attachments;
}

function resolveMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  return "image/jpeg";
}

async function waitForIngestionCompletion(apiClient: ReturnType<typeof axios.create>): Promise<IngestStatus> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10 * 60_000) {
    const response = await apiClient.get<IngestStatus>("/api/jobs/ingest/status");
    if (response.status !== 200) {
      throw new Error(`Status endpoint failed with HTTP ${response.status}.`);
    }
    if (response.data.state === "failed") {
      throw new Error(`Ingestion job failed: ${response.data.error ?? "unknown error"}`);
    }
    if (response.data.state === "completed") {
      return response.data;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error("Timed out waiting for ingestion completion.");
}
