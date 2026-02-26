const mockEnv = {
  ENV: "local" as "local" | "dev" | "stg" | "prod",
  isLocalMlEnv: true,
  NODE_ENV: "test",
  PORT: 4000,
  MONGO_URI: "mongodb://127.0.0.1:27017/test",
  APP_MANIFEST_PATH: undefined as string | undefined,
  INGESTION_SOURCES: "folder",
  ingestionSources: ["folder"],
  DEFAULT_TENANT_ID: "default",
  DEFAULT_WORKLOAD_TIER: "standard" as "standard" | "heavy",
  EMAIL_SOURCE_KEY: "email-inbox",
  EMAIL_HOST: undefined,
  EMAIL_PORT: 993,
  EMAIL_SECURE: true,
  EMAIL_USERNAME: undefined,
  EMAIL_PASSWORD: undefined,
  EMAIL_MAILBOX: "INBOX",
  EMAIL_FROM_FILTER: undefined,
  FOLDER_SOURCE_KEY: "folder-local",
  FOLDER_SOURCE_PATH: "/tmp",
  FOLDER_RECURSIVE: false,
  OCR_PROVIDER: "auto" as "auto" | "deepseek" | "mock",
  DEEPSEEK_API_KEY: undefined as string | undefined,
  DEEPSEEK_BASE_URL: "http://localhost:8000/v1",
  DEEPSEEK_OCR_MODEL: "deepseek-ai/DeepSeek-OCR",
  DEEPSEEK_TIMEOUT_MS: 45000,
  MOCK_OCR_TEXT: undefined as string | undefined,
  MOCK_OCR_CONFIDENCE: undefined as number | undefined,
  FIELD_VERIFIER_PROVIDER: "none" as "none" | "http",
  FIELD_VERIFIER_BASE_URL: "http://localhost:8100/v1",
  FIELD_VERIFIER_TIMEOUT_MS: 20000,
  FIELD_VERIFIER_API_KEY: undefined as string | undefined,
  LOCAL_FILE_STORE_ROOT: "/tmp/invoice-processor-artifacts",
  S3_FILE_STORE_BUCKET: undefined as string | undefined,
  S3_FILE_STORE_REGION: "us-east-1",
  S3_FILE_STORE_PREFIX: "invoice-processor",
  S3_FILE_STORE_ENDPOINT: undefined as string | undefined,
  S3_FILE_STORE_FORCE_PATH_STYLE: false,
  OCR_HIGH_CONFIDENCE_THRESHOLD: 0.92,
  CONFIDENCE_EXPECTED_MAX_TOTAL: 100000,
  CONFIDENCE_EXPECTED_MAX_DUE_DAYS: 90,
  CONFIDENCE_AUTO_SELECT_MIN: 91,
  TALLY_ENDPOINT: undefined as string | undefined,
  TALLY_COMPANY: undefined as string | undefined,
  TALLY_PURCHASE_LEDGER: "Purchase",
  DEFAULT_APPROVER: "system"
};

const axiosGetMock = jest.fn();

const mockProviderInstance = { name: "mock" };
const deepSeekProviderInstance = { name: "deepseek" };
const MockOcrProviderCtorMock = jest.fn(() => mockProviderInstance);
const DeepSeekOcrProviderCtorMock = jest.fn(() => deepSeekProviderInstance);

jest.mock("../config/env.js", () => ({
  env: mockEnv
}));

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => axiosGetMock(...args),
    isAxiosError: (value: unknown) =>
      typeof value === "object" && value !== null && (value as { isAxiosError?: unknown }).isAxiosError === true
  }
}));

jest.mock("../ocr/MockOcrProvider.js", () => ({
  MockOcrProvider: jest.fn().mockImplementation(() => MockOcrProviderCtorMock())
}));

jest.mock("../ocr/DeepSeekOcrProvider.js", () => ({
  DeepSeekOcrProvider: jest.fn().mockImplementation(() => DeepSeekOcrProviderCtorMock())
}));

jest.mock("../utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

import { resolveOcrProvider } from "./dependencies.ts";

describe("resolveOcrProvider", () => {
  beforeEach(() => {
    mockEnv.OCR_PROVIDER = "auto";
    mockEnv.DEEPSEEK_API_KEY = undefined;
    mockEnv.DEEPSEEK_OCR_MODEL = "deepseek-ai/DeepSeek-OCR";
    axiosGetMock.mockReset();
    axiosGetMock.mockImplementation((url: string) => {
      if (url.includes("/models")) {
        return Promise.resolve({
          data: { data: [{ id: "deepseek-ai/DeepSeek-OCR" }] }
        });
      }
      if (url.includes("/health")) {
        return Promise.resolve({
          data: { status: "ok", modelLoaded: true }
        });
      }
      return Promise.resolve({ data: {} });
    });
    MockOcrProviderCtorMock.mockClear();
    DeepSeekOcrProviderCtorMock.mockClear();
  });

  it("uses mock provider when explicitly configured", async () => {
    mockEnv.OCR_PROVIDER = "mock";

    const provider = await resolveOcrProvider();
    expect(provider).toBe(mockProviderInstance);
  });

  it("uses deepseek provider when explicitly configured and model validates", async () => {
    mockEnv.OCR_PROVIDER = "deepseek";
    mockEnv.DEEPSEEK_API_KEY = undefined;

    const provider = await resolveOcrProvider();

    expect(provider).toBe(deepSeekProviderInstance);
    expect(axiosGetMock).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error when deepseek model is not listed", async () => {
    mockEnv.OCR_PROVIDER = "deepseek";
    mockEnv.DEEPSEEK_API_KEY = undefined;
    axiosGetMock.mockImplementation((url: string) => {
      if (url.includes("/models")) {
        return Promise.resolve({
          data: { data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }
        });
      }
      if (url.includes("/health")) {
        return Promise.resolve({
          data: { status: "ok", modelLoaded: true }
        });
      }
      return Promise.resolve({ data: {} });
    });

    await expect(resolveOcrProvider()).rejects.toThrow(
      "Configured model 'deepseek-ai/DeepSeek-OCR' is not listed"
    );
    expect(DeepSeekOcrProviderCtorMock).not.toHaveBeenCalled();
  });

  it("uses deepseek in auto mode when key and model validate", async () => {
    mockEnv.OCR_PROVIDER = "auto";
    mockEnv.DEEPSEEK_API_KEY = undefined;

    const provider = await resolveOcrProvider();

    expect(provider).toBe(deepSeekProviderInstance);
    expect(axiosGetMock).toHaveBeenCalledTimes(2);
  });

  it("uses deepseek in auto mode without api key when model endpoint is open", async () => {
    mockEnv.OCR_PROVIDER = "auto";
    mockEnv.DEEPSEEK_API_KEY = undefined;

    const provider = await resolveOcrProvider();
    expect(provider).toBe(deepSeekProviderInstance);
  });

  it("sends authorization header during model bootstrap when api key is provided", async () => {
    mockEnv.OCR_PROVIDER = "deepseek";
    mockEnv.DEEPSEEK_API_KEY = "token-123";

    await resolveOcrProvider();

    expect(axiosGetMock).toHaveBeenCalledWith(
      expect.stringContaining("/models"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-123"
        })
      })
    );
  });

  it("accepts model id matches that differ only by case and :latest suffix", async () => {
    mockEnv.OCR_PROVIDER = "deepseek";
    mockEnv.DEEPSEEK_API_KEY = undefined;
    mockEnv.DEEPSEEK_OCR_MODEL = "deepseek-ai/deepseek-ocr:latest";

    const provider = await resolveOcrProvider();
    expect(provider).toBe(deepSeekProviderInstance);
  });
});
