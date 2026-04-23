/**
 * Barrel export for the Mongo test harness (INFRA-1). Downstream PRs —
 * BE-0, BE-10, vendor-merge, INFRA-3 — import from here.
 */
export {
  startMongoHarness,
  describeHarness,
  isDockerAvailable,
  type MongoHarness,
  type MongoHarnessOptions
} from "./mongoTestHarness.js";

export {
  buildFixtures,
  FIXTURE_NOW,
  type FixtureSet,
  type FixtureTenant,
  type FixtureVendor,
  type FixtureInvoice,
  type FixtureOptions
} from "./fixtures.js";

export {
  generateDataset,
  dumpDataset,
  loadDatasetFromFile,
  type DatasetScale,
  type DatasetLoadResult
} from "./datasetLoader.js";
