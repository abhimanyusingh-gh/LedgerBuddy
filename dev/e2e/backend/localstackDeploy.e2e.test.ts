import http from "node:http";
import { CreateBucketCommand, S3Client, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import mongoose from "mongoose";
import { createApp } from "@/app.js";
import { S3FileStore } from "@/storage/S3FileStore.js";
import { MockOcrProvider } from "@/ai/ocr/MockOcrProvider.js";
import { NoopFieldVerifier } from "@/ai/verifiers/NoopFieldVerifier.js";
import { InvoiceExtractionPipeline } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";
import { IngestionService } from "@/services/ingestion/ingestionService.js";
import { InvoiceService } from "@/services/invoice/invoiceService.js";
import { ExportService } from "@/services/export/exportService.js";
import { TallyExporter } from "@/services/export/tallyExporter.js";
import { EmailSimulationService } from "@/services/platform/emailSimulationService.js";
import { TenantGmailIntegrationService } from "@/services/tenant/tenantGmailIntegrationService.js";
import { MockBankConnectionService } from "@/services/bank/anumati/MockBankConnectionService.js";
import { HttpOidcProvider } from "@/sts/HttpOidcProvider.js";
import { AuthService } from "@/auth/AuthService.js";
import { TenantAdminService } from "@/services/tenant/tenantAdminService.js";
import { TenantInviteService } from "@/services/tenant/tenantInviteService.js";
import { PlatformAdminService } from "@/services/platform/platformAdminService.js";
import { KeycloakAdminClient } from "@/keycloak/KeycloakAdminClient.js";
import { createInviteEmailSenderProvider } from "@/providers/email/createInviteEmailSenderProvider.js";
import { MongoVendorTemplateStore } from "@/ai/extractors/invoice/learning/vendorTemplateStore.js";
import { MongoExtractionLearningStore } from "@/ai/extractors/invoice/learning/extractionLearningStore.js";
import { env } from "@/config/env.js";
import { ApprovalWorkflowService } from "@/services/invoice/approvalWorkflowService.js";

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT;
const MONGO_URI = process.env.MONGO_URI || env.MONGO_URI;
const TEST_BUCKET = "ledgerbuddy-localstack-e2e";
const TEST_REGION = "us-east-1";

const describeIf = LOCALSTACK_ENDPOINT ? describe : describe.skip;

jest.setTimeout(120_000);

function httpGet(server: http.Server, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    if (!addr || typeof addr === "string") return reject(new Error("Server not listening"));
    const req = http.get({ hostname: "127.0.0.1", port: addr.port, path }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: { raw: data } });
        }
      });
    });
    req.on("error", reject);
  });
}

describeIf("LocalStack deployment smoke test", () => {
  let s3Client: S3Client;
  let server: http.Server;

  beforeAll(async () => {
    s3Client = new S3Client({
      region: TEST_REGION,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" }
    });

    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
    } catch {}

    await mongoose.connect(MONGO_URI);

    const fileStore = new S3FileStore({
      bucket: TEST_BUCKET,
      region: TEST_REGION,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true
    });

    const ocrProvider = new MockOcrProvider({ text: "Invoice #TEST-001\nVendor: Test Corp\nAmount: 1000.00\nDate: 2026-01-15", confidence: 0.95 });
    const fieldVerifier = new NoopFieldVerifier();

    const pipeline = new InvoiceExtractionPipeline(
      {
        ocrProvider,
        fieldVerifier,
        templateStore: new MongoVendorTemplateStore(),
        learningStore: new MongoExtractionLearningStore()
      }
    );

    const approvalWorkflowService = new ApprovalWorkflowService();
    const ingestionService = new IngestionService([], ocrProvider, { pipeline, fileStore });
    const invoiceService = new InvoiceService({ fileStore, workflowService: approvalWorkflowService });
    const exporter = new TallyExporter({
      endpoint: "http://tally.example.local",
      companyName: "Test Company",
      purchaseLedgerName: "Purchase",
      gstLedgers: { cgstLedger: "Input CGST", sgstLedger: "Input SGST", igstLedger: "Input IGST", cessLedger: "Input Cess" }
    });
    const exportService = new ExportService(exporter, fileStore);
    const emailSimulationService = new EmailSimulationService();

    const oidcProvider = new HttpOidcProvider({
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      authUrl: env.OIDC_AUTH_URL,
      tokenUrl: env.OIDC_TOKEN_URL,
      validateUrl: env.OIDC_VALIDATE_URL,
      userInfoUrl: env.OIDC_USERINFO_URL,
      timeoutMs: 10_000
    });
    const keycloakAdmin = new KeycloakAdminClient(env.keycloakInternalBaseUrl, env.keycloakRealm, env.OIDC_CLIENT_ID, env.OIDC_CLIENT_SECRET);
    const authService = new AuthService(oidcProvider, keycloakAdmin);
    const tenantAdminService = new TenantAdminService();
    const inviteEmailSender = createInviteEmailSenderProvider();
    const tenantInviteService = new TenantInviteService(inviteEmailSender, keycloakAdmin);
    const platformAdminService = new PlatformAdminService(inviteEmailSender, keycloakAdmin);
    const gmailIntegrationService = new TenantGmailIntegrationService();
    const bankService = new MockBankConnectionService();

    const app = await createApp({
      ingestionService,
      invoiceService,
      exportService,
      emailSimulationService,
      authService,
      tenantAdminService,
      tenantInviteService,
      platformAdminService,
      gmailIntegrationService,
      bankService,
      fileStore,
      keycloakAdmin,
      approvalWorkflowService
    });

    server = app.listen(0);
    await new Promise<void>((resolve) => server.on("listening", resolve));
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    try {
      const listed = await s3Client.send(new ListObjectsV2Command({ Bucket: TEST_BUCKET }));
      if (listed.Contents && listed.Contents.length > 0) {
        await s3Client.send(new DeleteObjectsCommand({
          Bucket: TEST_BUCKET,
          Delete: { Objects: listed.Contents.map((obj) => ({ Key: obj.Key })) }
        }));
      }
    } catch {}

    await mongoose.disconnect();
  });

  it("GET /health returns ok", async () => {
    const result = await httpGet(server, "/health");
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
  });

  it("GET /health/ready returns ready with mongo check", async () => {
    const result = await httpGet(server, "/health/ready");
    expect(result.status).toBe(200);
    expect(result.body.ready).toBe(true);
    expect((result.body.checks as Record<string, string>).mongo).toBe("ok");
  });

  it("S3FileStore put/get/list round-trip via LocalStack", async () => {
    const store = new S3FileStore({
      bucket: TEST_BUCKET,
      region: TEST_REGION,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true
    });

    const testContent = Buffer.from("PDF test content for e2e");
    const ref = await store.putObject({
      key: "e2e-test/invoice-001.pdf",
      body: testContent,
      contentType: "application/pdf",
      metadata: { tenantId: "e2e-tenant" }
    });

    expect(ref.key).toBe("e2e-test/invoice-001.pdf");
    expect(ref.path).toBe(`s3://${TEST_BUCKET}/e2e-test/invoice-001.pdf`);
    expect(ref.contentType).toBe("application/pdf");

    const retrieved = await store.getObject("e2e-test/invoice-001.pdf");
    expect(Buffer.from(retrieved.body).toString()).toBe("PDF test content for e2e");
    expect(retrieved.contentType).toBe("application/pdf");

    const listed = await store.listObjects("e2e-test");
    expect(listed.some((item) => item.key === "e2e-test/invoice-001.pdf")).toBe(true);
  });

  it("S3FileStore deleteObject removes object", async () => {
    const store = new S3FileStore({
      bucket: TEST_BUCKET,
      region: TEST_REGION,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true
    });

    await store.putObject({
      key: "e2e-delete/to-remove.pdf",
      body: Buffer.from("to be deleted"),
      contentType: "application/pdf"
    });

    await store.deleteObject("e2e-delete/to-remove.pdf");

    await expect(store.getObject("e2e-delete/to-remove.pdf")).rejects.toThrow();

    const listed = await store.listObjects("e2e-delete");
    expect(listed.some((item) => item.key === "e2e-delete/to-remove.pdf")).toBe(false);
  });

  it("S3FileStore export output round-trip", async () => {
    const store = new S3FileStore({
      bucket: TEST_BUCKET,
      region: TEST_REGION,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true
    });

    const xmlContent = Buffer.from("<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER></ENVELOPE>");
    const ref = await store.putObject({
      key: "exports/e2e-tenant/batch-001.xml",
      body: xmlContent,
      contentType: "application/xml",
      metadata: { tenantId: "e2e-tenant", batchId: "batch-001" }
    });

    expect(ref.key).toBe("exports/e2e-tenant/batch-001.xml");
    expect(ref.contentType).toBe("application/xml");

    const retrieved = await store.getObject("exports/e2e-tenant/batch-001.xml");
    expect(Buffer.from(retrieved.body).toString()).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
  });
});

describe("OCR/SLM config wiring validation", () => {
  it("resolveOcrProvider returns MockOcrProvider when provider is mock", async () => {
    const { resolveOcrProvider } = await import("../core/dependencies.js");
    const { loadRuntimeManifest } = await import("../core/runtimeManifest.js");
    const manifest = loadRuntimeManifest();
    manifest.ocr.provider = "mock";
    manifest.ocr.mock.text = "Test OCR output";

    const provider = await resolveOcrProvider(manifest);
    expect(provider).toBeDefined();
    expect(provider.constructor.name).toBe("MockOcrProvider");
  });

  it("loadRuntimeManifest maps env vars to S3 file store config when S3_FILE_STORE_BUCKET is set", async () => {
    const { loadRuntimeManifest } = await import("../core/runtimeManifest.js");
    const manifest = loadRuntimeManifest();

    if (env.S3_FILE_STORE_BUCKET && env.S3_FILE_STORE_BUCKET.trim().length > 0) {
      expect(manifest.fileStore.provider).toBe("s3");
      expect(manifest.fileStore.s3.bucket).toBe(env.S3_FILE_STORE_BUCKET.trim());
    } else {
      expect(manifest.fileStore.provider).toBe("local");
    }
  });

  it("loadRuntimeManifest maps OCR_PROVIDER_BASE_URL to manifest ocr config", async () => {
    const { loadRuntimeManifest } = await import("../core/runtimeManifest.js");
    const manifest = loadRuntimeManifest();

    expect(manifest.ocr.deepseek.baseUrl).toBe(env.OCR_PROVIDER_BASE_URL);
    expect(manifest.verifier.http.baseUrl).toBe(env.FIELD_VERIFIER_BASE_URL);
    expect(manifest.ocr.deepseek.model).toBe(env.OCR_MODEL);
  });
});
