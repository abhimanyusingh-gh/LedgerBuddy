import path from "path";

const ENV_MODULE_PATH = path.resolve(__dirname, "./env.ts");

type LoadResult = { ok: true } | { ok: false; exitCode: number; errors: string[] };

function loadEnvModule(overrides: Record<string, string | undefined>): LoadResult {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;
  const originalError = console.error;

  // Minimum required env for zod schema to parse successfully.
  const baseEnv: Record<string, string> = {
    ENV: "local",
    MONGO_URI: "mongodb://localhost:27017/test"
  };

  for (const key of Object.keys(baseEnv)) {
    process.env[key] = baseEnv[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const capturedErrors: string[] = [];
  console.error = (...args: unknown[]) => {
    capturedErrors.push(args.map(String).join(" "));
  };

  class ExitError extends Error {
    constructor(public readonly code: number) {
      super(`process.exit(${code})`);
    }
  }
  (process.exit as unknown) = ((code?: number) => {
    throw new ExitError(typeof code === "number" ? code : 0);
  }) as never;

  let result: LoadResult = { ok: true };
  try {
    jest.isolateModules(() => {
      // Clear require cache for the env module so top-level guards re-run.
      delete require.cache[ENV_MODULE_PATH];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("./env");
    });
  } catch (err) {
    if (err instanceof ExitError) {
      result = { ok: false, exitCode: err.code, errors: capturedErrors };
    } else {
      throw err;
    }
  } finally {
    process.exit = originalExit;
    console.error = originalError;
    process.env = originalEnv;
  }

  return result;
}

describe("env guard: OCR_PROVIDER=llamaparse requires LLAMA_CLOUD_API_KEY", () => {
  it("refuses to boot when OCR_PROVIDER=llamaparse and key is missing", () => {
    const result = loadEnvModule({
      OCR_PROVIDER: "llamaparse",
      LLAMA_CLOUD_API_KEY: undefined
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.exitCode).toBe(1);
    expect(result.errors.join("\n")).toMatch(
      /OCR_PROVIDER=llamaparse requires LLAMA_CLOUD_API_KEY to be set/
    );
  });

  it("boots when OCR_PROVIDER=llamaparse and LLAMA_CLOUD_API_KEY is present", () => {
    const result = loadEnvModule({
      OCR_PROVIDER: "llamaparse",
      LLAMA_CLOUD_API_KEY: "llx-test-key"
    });
    expect(result.ok).toBe(true);
  });

  it.each([["deepseek"], ["auto"]])(
    "does not fire the guard when OCR_PROVIDER=%s with no key",
    (provider) => {
      const result = loadEnvModule({
        OCR_PROVIDER: provider,
        LLAMA_CLOUD_API_KEY: undefined
      });
      expect(result.ok).toBe(true);
    }
  );
});
