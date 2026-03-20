import axios from "axios";
import type { AccountingExporter } from "./interfaces/AccountingExporter.js";
import type { FileStore } from "./interfaces/FileStore.js";
import type { FieldVerifier } from "./interfaces/FieldVerifier.js";
import type { OcrProvider } from "./interfaces/OcrProvider.js";
import { MockOcrProvider } from "../ocr/MockOcrProvider.js";
import { DeepSeekOcrProvider } from "../ocr/DeepSeekOcrProvider.js";
import { buildIngestionSources } from "./sourceRegistry.js";
import { IngestionService } from "../services/ingestionService.js";
import { InvoiceExtractionPipeline } from "../services/extraction/InvoiceExtractionPipeline.js";
import { MongoVendorTemplateStore } from "../services/extraction/vendorTemplateStore.js";
import { MongoExtractionLearningStore } from "../services/extraction/extractionLearningStore.js";
import { InvoiceService } from "../services/invoiceService.js";
import { ExportService } from "../services/exportService.js";
import { TallyExporter } from "../services/tallyExporter.js";
import { logger } from "../utils/logger.js";
import { loadRuntimeManifest, type RuntimeManifest } from "./runtimeManifest.js";
import { NoopFieldVerifier } from "../verifier/NoopFieldVerifier.js";
import { HttpFieldVerifier } from "../verifier/HttpFieldVerifier.js";
import { LocalDiskFileStore } from "../storage/LocalDiskFileStore.js";
import { S3FileStore } from "../storage/S3FileStore.js";
import { EmailSimulationService } from "../services/emailSimulationService.js";
import { TenantGmailIntegrationService } from "../services/tenantGmailIntegrationService.js";
import type { IBankConnectionService } from "../services/anumati/IBankConnectionService.js";
import { AnumatiBankConnectionService } from "../services/anumati/AnumatiBankConnectionService.js";
import { MockBankConnectionService } from "../services/anumati/MockBankConnectionService.js";
import { HttpOidcProvider } from "../sts/HttpOidcProvider.js";
import { AuthService } from "../auth/AuthService.js";
import { TenantAdminService } from "../services/tenantAdminService.js";
import { TenantInviteService } from "../services/tenantInviteService.js";
import { createInviteEmailSenderProvider } from "../providers/email/createInviteEmailSenderProvider.js";
import { PlatformAdminService } from "../services/platformAdminService.js";
import { KeycloakAdminClient } from "../keycloak/KeycloakAdminClient.js";
import { env } from "../config/env.js";

import {
  OCR_BOOTSTRAP_TIMEOUT_MS,
  VERIFIER_BOOTSTRAP_TIMEOUT_MS
} from "../constants.js";

interface Dependencies {
  ingestionService: IngestionService;
  invoiceService: InvoiceService;
  exportService: ExportService | null;
  emailSimulationService: EmailSimulationService;
  authService: AuthService;
  tenantAdminService: TenantAdminService;
  tenantInviteService: TenantInviteService;
  platformAdminService: PlatformAdminService;
  gmailIntegrationService: TenantGmailIntegrationService;
  bankService: IBankConnectionService;
  fileStore: FileStore;
  keycloakAdmin: KeycloakAdminClient;
}

function buildAuthServices(manifest: RuntimeManifest) {
  const keycloakAdmin = new KeycloakAdminClient(
    env.keycloakInternalBaseUrl,
    env.keycloakRealm,
    env.OIDC_CLIENT_ID,
    env.OIDC_CLIENT_SECRET
  );
  const oidcProvider = new HttpOidcProvider({
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    authUrl: env.OIDC_AUTH_URL,
    tokenUrl: env.OIDC_TOKEN_URL,
    validateUrl: env.OIDC_VALIDATE_URL,
    userInfoUrl: env.OIDC_USERINFO_URL,
    timeoutMs: 10_000
  });
  const authService = new AuthService(oidcProvider, keycloakAdmin);
  const tenantAdminService = new TenantAdminService();
  const inviteEmailSender = createInviteEmailSenderProvider();
  const tenantInviteService = new TenantInviteService(inviteEmailSender, keycloakAdmin);
  const platformAdminService = new PlatformAdminService(inviteEmailSender, keycloakAdmin);
  return { authService, keycloakAdmin, tenantAdminService, tenantInviteService, platformAdminService };
}

async function buildExtractionPipeline(manifest: RuntimeManifest) {
  const ocrProvider = await resolveOcrProvider(manifest);
  const fieldVerifier = await resolveFieldVerifier(manifest);
  const pipeline = new InvoiceExtractionPipeline(
    ocrProvider,
    fieldVerifier,
    new MongoVendorTemplateStore(),
    new MongoExtractionLearningStore(),
    {
      ocrHighConfidenceThreshold: manifest.extraction.ocrHighConfidenceThreshold,
      llmAssistConfidenceThreshold: manifest.extraction.llmAssistConfidenceThreshold
    }
  );
  return { ocrProvider, fieldVerifier, pipeline };
}

function buildStorageAndExport(manifest: RuntimeManifest) {
  const fileStore = resolveFileStore(manifest);
  const exporter = buildExporter(manifest);
  const exportService = exporter ? new ExportService(exporter, fileStore) : null;
  return { fileStore, exportService };
}

export async function buildDependencies(): Promise<Dependencies> {
  const manifest = loadRuntimeManifest();
  const auth = buildAuthServices(manifest);
  const extraction = await buildExtractionPipeline(manifest);
  const storage = buildStorageAndExport(manifest);

  const gmailIntegrationService = new TenantGmailIntegrationService();
  const bankService: IBankConnectionService = env.ANUMATI_ENTITY_ID
    ? new AnumatiBankConnectionService()
    : new MockBankConnectionService();
  const sources = buildIngestionSources(manifest.sources, { gmailMailboxBoundary: gmailIntegrationService });
  const ingestionService = new IngestionService(sources, extraction.ocrProvider, {
    pipeline: extraction.pipeline,
    fileStore: storage.fileStore
  });

  return {
    ingestionService,
    invoiceService: new InvoiceService({ fileStore: storage.fileStore }),
    exportService: storage.exportService,
    emailSimulationService: new EmailSimulationService(),
    ...auth,
    gmailIntegrationService,
    bankService,
    fileStore: storage.fileStore
  };
}

function resolveFileStore(runtimeManifest: RuntimeManifest): FileStore {
  if (runtimeManifest.fileStore.provider === "local") {
    logger.info("Using file store provider", {
      provider: "local",
      rootPath: runtimeManifest.fileStore.local.rootPath
    });
    return new LocalDiskFileStore({
      rootPath: runtimeManifest.fileStore.local.rootPath
    });
  }

  if (runtimeManifest.fileStore.provider === "s3") {
    logger.info("Using file store provider", {
      provider: "s3",
      bucket: runtimeManifest.fileStore.s3.bucket,
      region: runtimeManifest.fileStore.s3.region
    });
    return new S3FileStore({
      bucket: runtimeManifest.fileStore.s3.bucket,
      region: runtimeManifest.fileStore.s3.region,
      prefix: runtimeManifest.fileStore.s3.prefix,
      endpoint: runtimeManifest.fileStore.s3.endpoint,
      forcePathStyle: runtimeManifest.fileStore.s3.forcePathStyle
    });
  }

  throw new Error(`Unsupported file store provider '${runtimeManifest.fileStore.provider}'.`);
}

async function resolveFieldVerifier(runtimeManifest = loadRuntimeManifest()): Promise<FieldVerifier> {
  if (runtimeManifest.verifier.provider === "none") {
    logger.info("Using field verifier", { provider: "none" });
    return new NoopFieldVerifier();
  }

  await assertFieldVerifierConfigIsValid(runtimeManifest);
  logger.info("Using field verifier", {
    provider: "http",
    baseUrl: runtimeManifest.verifier.http.baseUrl
  });
  return new HttpFieldVerifier({
    baseUrl: runtimeManifest.verifier.http.baseUrl,
    timeoutMs: runtimeManifest.verifier.http.timeoutMs,
    apiKey: runtimeManifest.verifier.http.apiKey
  });
}

export async function resolveOcrProvider(runtimeManifest = loadRuntimeManifest()): Promise<OcrProvider> {
  if (runtimeManifest.ocr.provider === "mock") {
    logger.info("Using OCR provider", { provider: "mock" });
    return new MockOcrProvider({
      text: runtimeManifest.ocr.mock.text,
      confidence: runtimeManifest.ocr.mock.confidence
    });
  }
  if (runtimeManifest.ocr.provider === "deepseek") {
    await assertDeepSeekConfigIsValid(runtimeManifest);
    logger.info("Using OCR provider", { provider: "deepseek", model: runtimeManifest.ocr.deepseek.model });
    return new DeepSeekOcrProvider({
      apiKey: runtimeManifest.ocr.deepseek.apiKey,
      baseUrl: runtimeManifest.ocr.deepseek.baseUrl,
      model: runtimeManifest.ocr.deepseek.model,
      timeoutMs: runtimeManifest.ocr.deepseek.timeoutMs
    });
  }

  if (runtimeManifest.ocr.provider === "auto") {
    await assertDeepSeekConfigIsValid(runtimeManifest);
    logger.info("Using OCR provider", { provider: "deepseek", model: runtimeManifest.ocr.deepseek.model });
    return new DeepSeekOcrProvider({
      apiKey: runtimeManifest.ocr.deepseek.apiKey,
      baseUrl: runtimeManifest.ocr.deepseek.baseUrl,
      model: runtimeManifest.ocr.deepseek.model,
      timeoutMs: runtimeManifest.ocr.deepseek.timeoutMs
    });
  }

  throw new Error(`Unsupported OCR provider '${runtimeManifest.ocr.provider}'.`);
}

function buildExporter(runtimeManifest: RuntimeManifest): AccountingExporter | null {
  if (!runtimeManifest.export.tallyEndpoint || !runtimeManifest.export.tallyCompany) {
    return null;
  }

  return new TallyExporter({
    endpoint: runtimeManifest.export.tallyEndpoint,
    companyName: runtimeManifest.export.tallyCompany,
    purchaseLedgerName: runtimeManifest.export.tallyPurchaseLedger,
    gstLedgers: runtimeManifest.export.tallyGstLedgers
  });
}

async function assertDeepSeekConfigIsValid(runtimeManifest: RuntimeManifest): Promise<void> {
  const baseUrl = runtimeManifest.ocr.deepseek.baseUrl.replace(/\/+$/, "");
  const configuredModel = runtimeManifest.ocr.deepseek.model;
  const apiKey = runtimeManifest.ocr.deepseek.apiKey.trim();
  try {
    const headers = buildAuthHeaders(apiKey);
    const response = await withTimeout(
      axios.get(`${baseUrl}/models`, { headers, timeout: OCR_BOOTSTRAP_TIMEOUT_MS }),
      OCR_BOOTSTRAP_TIMEOUT_MS
    );

    const modelIds: string[] = Array.isArray(response?.data?.data)
      ? response.data.data
          .map((model: unknown) => (typeof model === "object" && model !== null ? (model as { id?: unknown }).id : ""))
          .filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0)
      : [];

    const configuredModelId = configuredModel.trim().toLowerCase().replace(/:latest$/, "");
    if (modelIds.length > 0 && !modelIds.some((id) => id.trim().toLowerCase().replace(/:latest$/, "") === configuredModelId)) {
      throw new Error(
        `Configured model '${configuredModel}' is not listed by '${baseUrl}/models'. Available models: ${modelIds.join(", ")}. Start local OCR with 'yarn ocr:dev' or configure an endpoint that serves this model.`
      );
    }

    await assertServiceHealth(baseUrl, headers, OCR_BOOTSTRAP_TIMEOUT_MS, "OCR service");
  } catch (error) {
    throw new Error(
      `DeepSeek OCR bootstrap validation failed. Configure an endpoint that serves '${configuredModel}' at '${baseUrl}'. Cause: ${describeDependencyError(error)}`
    );
  }
}

async function assertFieldVerifierConfigIsValid(runtimeManifest: RuntimeManifest): Promise<void> {
  const baseUrl = runtimeManifest.verifier.http.baseUrl.replace(/\/+$/, "");
  try {
    await assertServiceHealth(baseUrl, buildAuthHeaders(runtimeManifest.verifier.http.apiKey.trim()), VERIFIER_BOOTSTRAP_TIMEOUT_MS, "Field verifier");
  } catch (error) {
    throw new Error(`Field verifier bootstrap validation failed at '${baseUrl}'. Cause: ${describeDependencyError(error)}`);
  }
}

async function assertServiceHealth(baseUrl: string, headers: Record<string, string>, timeoutMs: number, label: string): Promise<void> {
  const origin = new URL(baseUrl).origin;
  const response = await withTimeout(axios.get(`${origin}/health`, { headers, timeout: timeoutMs }), timeoutMs);
  const payload = response?.data;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    if (typeof p.status === "string" && !["ok", "healthy", "ready"].includes((p.status as string).toLowerCase())) {
      throw new Error(`${label} health status '${p.status}' is not ready.`);
    }
    if (p.modelLoaded === false) {
      throw new Error(`${label} reported modelLoaded=false.`);
    }
  }
}

function buildAuthHeaders(apiKey: string): Record<string, string> {
  return apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {};
}

function describeDependencyError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as Record<string, unknown> | undefined;
    const msg = (data?.error as { message?: string })?.message ?? (data?.message as string | undefined);
    if (typeof msg === "string" && msg.trim()) return status ? `${msg} (status ${status})` : msg;
    if (status) return error.message ? `${error.message} (status ${status})` : `Request failed with status ${status}`;
    if (error.code) return error.message ? `${error.message} (${error.code})` : error.code;
    return error.message || "Unknown HTTP client error";
  }
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then((v) => { clearTimeout(timer); resolve(v); }).catch((e) => { clearTimeout(timer); reject(e); });
  });
}
