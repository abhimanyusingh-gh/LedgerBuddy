import axios from "axios";
import { OCR_PROVIDER_NAME, type OcrProviderName } from "@/constants.js";
import type { AccountingExporter } from "@/core/interfaces/AccountingExporter.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import type { FieldVerifier } from "@/core/interfaces/FieldVerifier.js";
import type { OcrProvider } from "@/core/interfaces/OcrProvider.js";
import { MockOcrProvider } from "@/ai/ocr/MockOcrProvider.js";
import { DeepSeekOcrProvider } from "@/ai/ocr/DeepSeekOcrProvider.js";
import { LlamaParseOcrProvider } from "@/ai/ocr/LlamaParseOcrProvider.js";
import { buildIngestionSources } from "@/core/sourceRegistry.js";
import { IngestionService } from "@/services/ingestion/ingestionService.js";
import { InvoiceExtractionPipeline } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";
import { MongoVendorTemplateStore } from "@/ai/extractors/invoice/learning/vendorTemplateStore.js";
import { MongoExtractionLearningStore } from "@/ai/extractors/invoice/learning/extractionLearningStore.js";
import { ExtractionMappingService } from "@/ai/extractors/invoice/learning/extractionMappingService.js";
import { InvoiceService } from "@/services/invoice/invoiceService.js";
import { ExportService } from "@/services/export/exportService.js";
import { TallyExporter } from "@/services/export/tallyExporter.js";
import { logger } from "@/utils/logger.js";
import { loadRuntimeManifest, type RuntimeManifest, type LlamaParseTier } from "@/core/runtimeManifest.js";
import { NoopFieldVerifier } from "@/ai/verifiers/NoopFieldVerifier.js";
import { HttpFieldVerifier } from "@/ai/verifiers/HttpFieldVerifier.js";
import { S3FileStore } from "@/storage/S3FileStore.js";
import { EmailSimulationService } from "@/services/platform/emailSimulationService.js";
import { TenantGmailIntegrationService } from "@/services/tenant/tenantGmailIntegrationService.js";
import { MailboxNotificationService } from "@/services/platform/mailboxNotificationService.js";
import type { IBankConnectionService } from "@/services/bank/anumati/IBankConnectionService.js";
import { AnumatiBankConnectionService } from "@/services/bank/anumati/AnumatiBankConnectionService.js";
import { MockBankConnectionService } from "@/services/bank/anumati/MockBankConnectionService.js";
import { HttpOidcProvider } from "@/sts/HttpOidcProvider.js";
import { AuthService } from "@/auth/AuthService.js";
import { TenantAdminService } from "@/services/tenant/tenantAdminService.js";
import { TenantInviteService } from "@/services/tenant/tenantInviteService.js";
import { createInviteEmailSenderProvider } from "@/providers/email/createInviteEmailSenderProvider.js";
import { PlatformAdminService } from "@/services/platform/platformAdminService.js";
import { KeycloakAdminClient } from "@/keycloak/KeycloakAdminClient.js";
import { ApprovalWorkflowService } from "@/services/invoice/approvalWorkflowService.js";
import { ComplianceEnrichmentService } from "@/services/compliance/ComplianceEnrichmentService.js";
import { PanValidationService } from "@/services/compliance/PanValidationService.js";
import { VendorMasterService } from "@/services/compliance/VendorMasterService.js";
import { TdsCalculationService } from "@/services/compliance/TdsCalculationService.js";
import { GlCodeSuggestionService } from "@/services/compliance/GlCodeSuggestionService.js";
import { IrnValidationService } from "@/services/compliance/IrnValidationService.js";
import { MsmeTrackingService } from "@/services/compliance/MsmeTrackingService.js";
import { DuplicateInvoiceDetector } from "@/services/compliance/DuplicateInvoiceDetector.js";
import { CostCenterService } from "@/services/compliance/CostCenterService.js";
import { env } from "@/config/env.js";

import {
  OCR_BOOTSTRAP_TIMEOUT_MS,
  VERIFIER_BOOTSTRAP_TIMEOUT_MS
} from "@/constants.js";

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
  notificationService: MailboxNotificationService;
  bankService: IBankConnectionService;
  fileStore: FileStore;
  keycloakAdmin: KeycloakAdminClient;
  approvalWorkflowService: ApprovalWorkflowService;
  ocrProvider: OcrProvider;
  fieldVerifier: FieldVerifier;
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
  return { authService, keycloakAdmin, tenantAdminService, tenantInviteService, platformAdminService, inviteEmailSender };
}

async function buildExtractionPipeline(manifest: RuntimeManifest, learningStore: MongoExtractionLearningStore, mappingService: ExtractionMappingService) {
  const ocrProvider = await resolveOcrProvider(manifest);
  const fieldVerifier = await resolveFieldVerifier(manifest);
  const complianceEnricher = new ComplianceEnrichmentService({
    panValidation: new PanValidationService(),
    vendorMaster: new VendorMasterService(),
    tdsCalculation: new TdsCalculationService(),
    glCodeSuggestion: new GlCodeSuggestionService(),
    irnValidation: new IrnValidationService(),
    msmeTracking: new MsmeTrackingService(),
    duplicateDetector: new DuplicateInvoiceDetector(),
    costCenter: new CostCenterService()
  });

  const pipeline = new InvoiceExtractionPipeline(
    {
      ocrProvider,
      fieldVerifier,
      templateStore: new MongoVendorTemplateStore(),
      learningStore,
      complianceEnricher,
      mappingService
    },
    {
      learningMode: env.LEARNING_MODE,
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
  const learningStore = new MongoExtractionLearningStore();
  const mappingService = new ExtractionMappingService();
  const extraction = await buildExtractionPipeline(manifest, learningStore, mappingService);
  const storage = buildStorageAndExport(manifest);

  const notificationService = new MailboxNotificationService(auth.inviteEmailSender);
  const gmailIntegrationService = new TenantGmailIntegrationService(notificationService);
  const bankService: IBankConnectionService = env.ANUMATI_ENTITY_ID
    ? new AnumatiBankConnectionService()
    : new MockBankConnectionService();
  const sources = buildIngestionSources(manifest.sources, { gmailMailboxBoundary: gmailIntegrationService });
  const ingestionService = new IngestionService(sources, extraction.ocrProvider, {
    pipeline: extraction.pipeline,
    fileStore: storage.fileStore
  });
  const approvalWorkflowService = new ApprovalWorkflowService();

  return {
    ingestionService,
    invoiceService: new InvoiceService({ fileStore: storage.fileStore, workflowService: approvalWorkflowService, learningStore, mappingService }),
    exportService: storage.exportService,
    emailSimulationService: new EmailSimulationService(),
    ...auth,
    gmailIntegrationService,
    notificationService,
    bankService,
    fileStore: storage.fileStore,
    approvalWorkflowService,
    ocrProvider: extraction.ocrProvider,
    fieldVerifier: extraction.fieldVerifier
  };
}

export function resolveFileStore(runtimeManifest: RuntimeManifest): FileStore {
  logger.info("Using file store provider", {
    provider: "s3",
    bucket: runtimeManifest.fileStore.configuration.bucket,
    region: runtimeManifest.fileStore.configuration.region
  });
  return new S3FileStore({
    bucket: runtimeManifest.fileStore.configuration.bucket,
    region: runtimeManifest.fileStore.configuration.region,
    prefix: runtimeManifest.fileStore.configuration.prefix,
    endpoint: runtimeManifest.fileStore.configuration.endpoint,
    publicEndpoint: runtimeManifest.fileStore.configuration.publicEndpoint,
    forcePathStyle: runtimeManifest.fileStore.configuration.forcePathStyle
  });
}

export async function resolveFieldVerifier(runtimeManifest = loadRuntimeManifest()): Promise<FieldVerifier> {
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
  if (runtimeManifest.ocr.provider === OCR_PROVIDER_NAME.MOCK) {
    logger.info("Using OCR provider", { provider: OCR_PROVIDER_NAME.MOCK });
    return new MockOcrProvider({
      text: runtimeManifest.ocr.mock.text,
      confidence: runtimeManifest.ocr.mock.confidence
    });
  }

  if (runtimeManifest.ocr.provider === OCR_PROVIDER_NAME.LLAMAPARSE) {
    const cfg = runtimeManifest.ocr.llamaparse;
    if (!cfg.apiKey) throw new Error("LLAMA_CLOUD_API_KEY is not configured.");
    logger.info("Using OCR provider", { provider: OCR_PROVIDER_NAME.LLAMAPARSE, tier: cfg.tier });
    return new LlamaParseOcrProvider({ apiKey: cfg.apiKey, tier: cfg.tier as LlamaParseTier });
  }

  if (runtimeManifest.ocr.provider === OCR_PROVIDER_NAME.DEEPSEEK || runtimeManifest.ocr.provider === OCR_PROVIDER_NAME.AUTO) {
    return createHttpOcrProvider(runtimeManifest);
  }

  throw new Error(`Unsupported OCR provider '${runtimeManifest.ocr.provider}'.`);
}

async function createHttpOcrProvider(runtimeManifest: RuntimeManifest): Promise<OcrProvider> {
  await assertHttpOcrConfigIsValid(runtimeManifest);
  logger.info("Using OCR provider", {
    provider: "http",
    model: runtimeManifest.ocr.configuration.model,
    baseUrl: runtimeManifest.ocr.configuration.baseUrl
  });
  return new DeepSeekOcrProvider({
    apiKey: runtimeManifest.ocr.configuration.apiKey,
    baseUrl: runtimeManifest.ocr.configuration.baseUrl,
    model: runtimeManifest.ocr.configuration.model,
    timeoutMs: runtimeManifest.ocr.configuration.timeoutMs
  });
}

function buildExporter(runtimeManifest: RuntimeManifest): AccountingExporter | null {
  if (!runtimeManifest.export.tallyEndpoint || !runtimeManifest.export.tallyCompany) {
    return null;
  }

  return new TallyExporter({
    endpoint: runtimeManifest.export.tallyEndpoint,
    companyName: runtimeManifest.export.tallyCompany,
    purchaseLedgerName: runtimeManifest.export.tallyPurchaseLedger,
    gstLedgers: runtimeManifest.export.tallyGstLedgers,
    tdsLedgerPrefix: env.TALLY_TDS_LEDGER,
    tcsLedgerName: env.TALLY_TCS_LEDGER
  });
}

async function assertHttpOcrConfigIsValid(runtimeManifest: RuntimeManifest): Promise<void> {
  const baseUrl = runtimeManifest.ocr.configuration.baseUrl.replace(/\/+$/, "");
  const configuredModel = runtimeManifest.ocr.configuration.model;
  const apiKey = runtimeManifest.ocr.configuration.apiKey.trim();
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
      `OCR HTTP bootstrap validation failed. Configure an endpoint that serves '${configuredModel}' at '${baseUrl}'. Cause: ${describeDependencyError(error)}`
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
