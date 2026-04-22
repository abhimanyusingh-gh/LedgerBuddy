import path from "path";

const ENV_MODULE_PATH = path.resolve(__dirname, "./env.ts");

type LoadResult =
  | { ok: true; env: typeof import("./env").env; infos: string[] }
  | { ok: false; exitCode: number; errors: string[] };

function loadEnvModule(overrides: Record<string, string | undefined>): LoadResult {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;
  const originalError = console.error;
  const originalInfo = console.info;

  // Minimum required env for zod schema to parse successfully.
  const baseEnv: Record<string, string> = {
    ENV: "local",
    MONGO_URI: "mongodb://localhost:27017/test"
  };

  // Explicitly clear keys the auto-coercion guard reads so each test starts
  // from a clean slate rather than inheriting from the shell/jest environment.
  delete process.env.FIELD_VERIFIER_PROVIDER;
  delete process.env.OCR_PROVIDER;
  delete process.env.LLAMA_CLOUD_API_KEY;

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
  const capturedInfos: string[] = [];
  console.info = (...args: unknown[]) => {
    capturedInfos.push(args.map(String).join(" "));
  };

  class ExitError extends Error {
    constructor(public readonly code: number) {
      super(`process.exit(${code})`);
    }
  }
  (process.exit as unknown) = ((code?: number) => {
    throw new ExitError(typeof code === "number" ? code : 0);
  }) as never;

  let result: LoadResult = {
    ok: true,
    env: undefined as unknown as typeof import("./env").env,
    infos: capturedInfos
  };
  try {
    jest.isolateModules(() => {
      // Clear require cache for the env module so top-level guards re-run.
      delete require.cache[ENV_MODULE_PATH];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("./env") as typeof import("./env");
      result = { ok: true, env: mod.env, infos: capturedInfos };
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
    console.info = originalInfo;
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

describe("env coercion: FIELD_VERIFIER_PROVIDER auto-coerces with OCR_PROVIDER=llamaparse", () => {
  it("coerces to 'none' when OCR_PROVIDER=llamaparse and FIELD_VERIFIER_PROVIDER is unset", () => {
    const result = loadEnvModule({
      OCR_PROVIDER: "llamaparse",
      LLAMA_CLOUD_API_KEY: "llx-test-key",
      FIELD_VERIFIER_PROVIDER: undefined
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.FIELD_VERIFIER_PROVIDER).toBe("none");
    expect(result.infos.join("\n")).toMatch(/auto-coerced to 'none'/);
  });

  it("does NOT coerce when FIELD_VERIFIER_PROVIDER is explicitly set to 'http'", () => {
    const result = loadEnvModule({
      OCR_PROVIDER: "llamaparse",
      LLAMA_CLOUD_API_KEY: "llx-test-key",
      FIELD_VERIFIER_PROVIDER: "http"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.FIELD_VERIFIER_PROVIDER).toBe("http");
    expect(result.infos.join("\n")).not.toMatch(/auto-coerced/);
  });

  it("does NOT coerce when FIELD_VERIFIER_PROVIDER is explicitly set to 'none'", () => {
    const result = loadEnvModule({
      OCR_PROVIDER: "llamaparse",
      LLAMA_CLOUD_API_KEY: "llx-test-key",
      FIELD_VERIFIER_PROVIDER: "none"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.FIELD_VERIFIER_PROVIDER).toBe("none");
    // Explicit setting — no coercion message.
    expect(result.infos.join("\n")).not.toMatch(/auto-coerced/);
  });

  it.each([["deepseek"], ["auto"]])(
    "does NOT coerce when OCR_PROVIDER=%s and FIELD_VERIFIER_PROVIDER is unset",
    (provider) => {
      const result = loadEnvModule({
        OCR_PROVIDER: provider,
        FIELD_VERIFIER_PROVIDER: undefined
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // zod default is 'http' — unchanged.
      expect(result.env.FIELD_VERIFIER_PROVIDER).toBe("http");
      expect(result.infos.join("\n")).not.toMatch(/auto-coerced/);
    }
  );
});
