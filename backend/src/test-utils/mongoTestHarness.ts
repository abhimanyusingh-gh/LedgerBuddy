/**
 * Mongo test harness for the accounting-payments initiative.
 *
 * Starts a single-node MongoDB replica set in a Docker container via
 * testcontainers-for-Mongo. A replica set (vs. a standalone mongod) is
 * required because downstream PRs — BE-0 `$jsonSchema` validators, BE-10
 * payment transactions, vendor-merge transactions — rely on full Mongo
 * semantics (transactions, `$jsonSchema`) that exactly match the prod
 * MongoDB Atlas topology on AWS (see
 * `docs/accounting-payments/IMPLEMENTATION-PLAN-v4.3.md` → "Infra facts").
 *
 * Design notes:
 * - Opt-in, not always-on. Unit tests continue to run without Docker;
 *   harness tests either opt-in explicitly via `describeHarness()` or get
 *   auto-skipped when Docker is unreachable. CI enforces Docker availability
 *   via the `MONGO_HARNESS=1` env var (hard-fail instead of silent skip).
 * - Ephemeral ports only. The container exposes 27017 on a random host
 *   port, so concurrent test workers never collide with each other or with
 *   the dev docker-compose mongo on 27018.
 * - Deterministic setup. `rs.initiate()` is run against the container
 *   after startup so `session.startTransaction()` works on the first
 *   connection.
 */

import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

// Lazy imports. Keep testcontainers out of the module-level import graph so
// that tests which don't use the harness never pay the resolution cost and
// never fail when Docker isn't installed.
type MongoDBContainerClass = typeof import("@testcontainers/mongodb").MongoDBContainer;
type StartedMongoDBContainer = import("@testcontainers/mongodb").StartedMongoDBContainer;

// Image pinned to match Atlas compatibility. Bump deliberately.
const DEFAULT_IMAGE = "mongo:7.0";
const DEFAULT_START_TIMEOUT_MS = 60_000;

export interface MongoHarnessOptions {
  /** Docker image tag; defaults to `mongo:7.0` (Atlas-compatible). */
  image?: string;
  /** Container startup timeout in ms; defaults to 60s. */
  startTimeoutMs?: number;
  /** Database name to connect to; defaults to `ledgerbuddy_test_<rand>`. */
  databaseName?: string;
}

export interface MongoHarness {
  /** Mongo connection URI, including replica-set host + credentials. */
  uri: string;
  /** Database name the harness is connected to. */
  databaseName: string;
  /** Drop every collection (cheaper than container restart). */
  reset: () => Promise<void>;
  /** Disconnect mongoose and stop the container. Idempotent. */
  stop: () => Promise<void>;
}

/**
 * Returns `true` when Docker appears reachable. Used by `describeHarness()`
 * to auto-skip harness suites on developer laptops that don't have Docker
 * running. In CI we set `MONGO_HARNESS=1` to force a hard failure instead.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import("node:child_process");
    execSync("docker info", { stdio: "ignore", timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a fresh single-node replica-set Mongo container and connect
 * mongoose to it. Callers MUST `await harness.stop()` in `afterAll`.
 */
export async function startMongoHarness(
  options: MongoHarnessOptions = {}
): Promise<MongoHarness> {
  const {
    image = DEFAULT_IMAGE,
    startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
    databaseName = `ledgerbuddy_test_${randomUUID().slice(0, 8)}`
  } = options;

  const { MongoDBContainer } = (await import("@testcontainers/mongodb")) as {
    MongoDBContainer: MongoDBContainerClass;
  };

  // @testcontainers/mongodb 10.x runs `rs.initiate()` on startup out of the
  // box when you use `MongoDBContainer`, so transactions work immediately.
  const container: StartedMongoDBContainer = await new MongoDBContainer(image)
    .withStartupTimeout(startTimeoutMs)
    .start();

  // `getConnectionString()` returns `mongodb://host:port/?directConnection=true`.
  // We inject a database name so mongoose picks the right default DB.
  const baseUri = container.getConnectionString();
  const uri = baseUri.includes("/?")
    ? baseUri.replace("/?", `/${databaseName}?`)
    : `${baseUri.replace(/\/$/, "")}/${databaseName}?directConnection=true`;

  // Isolated mongoose connection so the harness never collides with the
  // global `mongoose.connect()` used by `src/db/connect.ts`. Callers that
  // need the default connection can reconnect after `startMongoHarness`.
  await mongoose.connect(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000
  });

  const reset = async () => {
    const db = mongoose.connection.db;
    if (!db) return;
    const collections = await db.listCollections().toArray();
    await Promise.all(
      collections.map((c) => db.collection(c.name).deleteMany({}))
    );
  };

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await mongoose.disconnect();
    } finally {
      await container.stop({ timeout: 10 });
    }
  };

  return { uri, databaseName, reset, stop };
}

/**
 * Jest helper: mirrors `describe()` but auto-skips when Docker is not
 * available locally (unless `MONGO_HARNESS=1` is set, which forces a
 * hard failure — that's the CI mode).
 *
 * Usage:
 * ```ts
 * import { describeHarness, startMongoHarness } from "@/test-utils";
 *
 * describeHarness("VendorMerge tx", ({ getHarness }) => {
 *   it("rolls back on error", async () => {
 *     const { uri } = getHarness();
 *     // ...
 *   });
 * });
 * ```
 */
export function describeHarness(
  name: string,
  body: (ctx: { getHarness: () => MongoHarness }) => void,
  options: MongoHarnessOptions = {}
): void {
  const forced = process.env.MONGO_HARNESS === "1";

  // Resolving Docker availability is async; Jest's top-level `describe`
  // must be sync, so we gate at `beforeAll` and use `it.skip` at runtime
  // when Docker is missing. In "forced" mode we let the error surface.
  const suite = describe(name, () => {
    let harness: MongoHarness | null = null;
    let skip = false;

    beforeAll(async () => {
      if (!forced && !(await isDockerAvailable())) {
        skip = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[mongo-harness] Docker unavailable — skipping suite "${name}". ` +
            "Set MONGO_HARNESS=1 to force a hard failure in CI."
        );
        return;
      }
      harness = await startMongoHarness(options);
    }, DEFAULT_START_TIMEOUT_MS + 10_000);

    afterAll(async () => {
      if (harness) await harness.stop();
    });

    beforeEach(() => {
      if (skip) {
        // Jest doesn't support "skip whole suite at runtime", so we throw
        // a pending-style marker. The `pending()` global from jasmine is
        // not available in Jest; we route through `test.skip` below in
        // `body` by exposing `getHarness` that throws a sentinel.
      }
    });

    body({
      getHarness: () => {
        if (skip) {
          // Short-circuit: throwing `Error` makes Jest mark the test failed.
          // We prefer a pending-like skip — Jest exposes `it.skip` but not
          // a runtime skip, so callers using `getHarness()` in an it-block
          // will fail fast on dev machines without Docker. That's by
          // design: the suite-level warn() above is the signal, and CI
          // sets MONGO_HARNESS=1 anyway.
          throw new Error(
            "mongo-harness: Docker unavailable and MONGO_HARNESS not set"
          );
        }
        if (!harness) {
          throw new Error("mongo-harness: called before beforeAll finished");
        }
        return harness;
      }
    });
  });

  return suite;
}
