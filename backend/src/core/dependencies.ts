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

const OCR_BOOTSTRAP_TIMEOUT_MS = 5_000;
const VERIFIER_BOOTSTRAP_TIMEOUT_MS = 5_000;

interface Dependencies {
  ingestionService: IngestionService;
  invoiceService: InvoiceService;
  exportService: ExportService | null;
  emailSimulationService: EmailSimulationService;
}

export async function buildDependencies(): Promise<Dependencies> {
  const manifest = loadRuntimeManifest();
  const ocrProvider = await resolveOcrProvider(manifest);
  const fieldVerifier = await resolveFieldVerifier(manifest);
  const fileStore = resolveFileStore(manifest);
  const extractionPipeline = new InvoiceExtractionPipeline(
    ocrProvider,
    fieldVerifier,
    new MongoVendorTemplateStore(),
    {
      ocrHighConfidenceThreshold: manifest.extraction.ocrHighConfidenceThreshold
    }
  );
  const sources = buildIngestionSources(manifest.sources);
  const ingestionService = new IngestionService(sources, ocrProvider, {
    pipeline: extractionPipeline,
    fileStore
  });
  const invoiceService = new InvoiceService();
  const emailSimulationService = new EmailSimulationService();

  const exporter = buildExporter(manifest);
  const exportService = exporter ? new ExportService(exporter) : null;

  return {
    ingestionService,
    invoiceService,
    exportService,
    emailSimulationService
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
    purchaseLedgerName: runtimeManifest.export.tallyPurchaseLedger
  });
}

async function assertDeepSeekConfigIsValid(runtimeManifest: RuntimeManifest): Promise<void> {
  const baseUrl = runtimeManifest.ocr.deepseek.baseUrl.replace(/\/+$/, "");
  const configuredModel = runtimeManifest.ocr.deepseek.model;
  const apiKey = runtimeManifest.ocr.deepseek.apiKey.trim();
  try {
    const headers: Record<string, string> = {};
    if (apiKey.length > 0) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await withTimeout(
      axios.get(`${baseUrl}/models`, {
        headers,
        timeout: OCR_BOOTSTRAP_TIMEOUT_MS
      }),
      OCR_BOOTSTRAP_TIMEOUT_MS
    );

    const modelIds: string[] = Array.isArray(response?.data?.data)
      ? response.data.data
          .map((model: unknown) => (typeof model === "object" && model !== null ? (model as { id?: unknown }).id : ""))
          .filter((modelId: unknown): modelId is string => typeof modelId === "string" && modelId.trim().length > 0)
      : [];

    const configuredModelId = normalizeModelIdentifier(configuredModel);
    const hasConfiguredModel =
      modelIds.length === 0 ||
      modelIds.some((modelId) => normalizeModelIdentifier(modelId) === configuredModelId);

    if (!hasConfiguredModel) {
      throw new Error(
        `Configured model '${configuredModel}' is not listed by '${baseUrl}/models'. Available models: ${modelIds.join(
          ", "
        )}. Start local OCR with 'yarn ocr:dev' or configure an endpoint that serves this model.`
      );
    }

    const healthResponse = await withTimeout(
      axios.get(`${baseUrl}/health`, {
        headers,
        timeout: OCR_BOOTSTRAP_TIMEOUT_MS
      }),
      OCR_BOOTSTRAP_TIMEOUT_MS
    );
    const payload = healthResponse?.data;
    if (isRecord(payload)) {
      const statusValue = payload.status;
      if (typeof statusValue === "string" && !["ok", "healthy", "ready"].includes(statusValue.toLowerCase())) {
        throw new Error(`OCR service health status '${statusValue}' is not ready.`);
      }
      if (typeof payload.modelLoaded === "boolean" && !payload.modelLoaded) {
        throw new Error("OCR service reported modelLoaded=false.");
      }
    }
  } catch (error) {
    const reason = describeDependencyError(error);
    throw new Error(
      `DeepSeek OCR bootstrap validation failed. Configure an endpoint that serves '${configuredModel}' at '${baseUrl}'. Cause: ${reason}`
    );
  }
}

async function assertFieldVerifierConfigIsValid(runtimeManifest: RuntimeManifest): Promise<void> {
  const baseUrl = runtimeManifest.verifier.http.baseUrl.replace(/\/+$/, "");
  const apiKey = runtimeManifest.verifier.http.apiKey.trim();
  try {
    const headers: Record<string, string> = {};
    if (apiKey.length > 0) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await withTimeout(
      axios.get(`${baseUrl}/health`, {
        headers,
        timeout: VERIFIER_BOOTSTRAP_TIMEOUT_MS
      }),
      VERIFIER_BOOTSTRAP_TIMEOUT_MS
    );
    const payload = response?.data;
    if (isRecord(payload)) {
      const statusValue = payload.status;
      if (typeof statusValue === "string" && !["ok", "healthy", "ready"].includes(statusValue.toLowerCase())) {
        throw new Error(`Field verifier health status '${statusValue}' is not ready.`);
      }
      if (typeof payload.modelLoaded === "boolean" && !payload.modelLoaded) {
        throw new Error("Field verifier reported modelLoaded=false.");
      }
    }
  } catch (error) {
    const reason = describeDependencyError(error);
    throw new Error(`Field verifier bootstrap validation failed at '${baseUrl}'. Cause: ${reason}`);
  }
}

function normalizeModelIdentifier(value: string): string {
  const normalizedValue = value.trim().toLowerCase();
  return normalizedValue.endsWith(":latest") ? normalizedValue.slice(0, -7) : normalizedValue;
}

function describeDependencyError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    if (typeof data === "object" && data !== null) {
      const message = (data as { error?: { message?: string }; message?: string }).error?.message;
      const fallbackMessage = (data as { message?: string }).message;
      if (typeof message === "string" && message.trim().length > 0) {
        return status ? `${message} (status ${status})` : message;
      }
      if (typeof fallbackMessage === "string" && fallbackMessage.trim().length > 0) {
        return status ? `${fallbackMessage} (status ${status})` : fallbackMessage;
      }
    }
    if (status) {
      return error.message ? `${error.message} (status ${status})` : `Request failed with status ${status}`;
    }
    if (error.code) {
      return error.message ? `${error.message} (${error.code})` : error.code;
    }
    return error.message || "Unknown HTTP client error";
  }

  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
