
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

type MongoDBContainerClass = typeof import("@testcontainers/mongodb").MongoDBContainer;
type StartedMongoDBContainer = import("@testcontainers/mongodb").StartedMongoDBContainer;

const DEFAULT_IMAGE = "mongo:7.0";
const DEFAULT_START_TIMEOUT_MS = 60_000;

interface MongoHarnessOptions {
  image?: string;
  startTimeoutMs?: number;
  databaseName?: string;
}

interface MongoHarness {
  uri: string;
  databaseName: string;
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import("node:child_process");
    execSync("docker info", { stdio: "ignore", timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

async function startMongoHarness(
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

  const container: StartedMongoDBContainer = await new MongoDBContainer(image)
    .withStartupTimeout(startTimeoutMs)
    .start();

  const baseUri = container.getConnectionString();
  const uri = baseUri.includes("/?")
    ? baseUri.replace("/?", `/${databaseName}?`)
    : `${baseUri.replace(/\/$/, "")}/${databaseName}?directConnection=true`;

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

export function describeHarness(
  name: string,
  body: (ctx: { getHarness: () => MongoHarness }) => void,
  options: MongoHarnessOptions = {}
): void {
  const forced = process.env.MONGO_HARNESS === "1";

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
