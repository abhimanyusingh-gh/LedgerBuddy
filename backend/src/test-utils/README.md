# `test-utils/` — Mongo test harness (INFRA-1)

Backend test harness for the accounting-payments initiative. Spins up a
**single-node MongoDB replica set** in a Docker container via
`@testcontainers/mongodb`, so downstream PRs (BE-0 `$jsonSchema`, BE-10
payment transactions, vendor-merge transactions, INFRA-3 perf gates) can
exercise the same semantics the prod MongoDB Atlas cluster provides.

## When to use it

Reach for this harness **only** when your test needs real Mongo behaviour
that the existing unit-test pattern can't fake:

- `$jsonSchema` collection validators
- `session.withTransaction(...)` / multi-document transactions
- Aggregation pipeline stages that mongoose's model isn't enough to cover
- Realistic index behaviour under load

Regular services/controllers unit tests should keep using the current
mocked approach — see `src/routes/testHelpers.ts` and the existing
`src/testSetup.ts` jest setup file.

## Quick start

```ts
import {
  describeHarness,
  buildFixtures
} from "@/test-utils";
import { InvoiceModel } from "@/models/invoice/Invoice.js";

describeHarness("VendorMerge tx (BE-10)", ({ getHarness }) => {
  afterEach(async () => {
    await getHarness().reset();
  });

  it("rolls back on error inside a transaction", async () => {
    await buildFixtures({ persist: true, seed: 42 });
    // ...exercise tx path...
    const count = await InvoiceModel.countDocuments({});
    expect(count).toBe(15); // seed=42, 1 tenant × 3 vendors × 5 invoices
  });
});
```

One-liner: swap `describe(...)` → `describeHarness(...)`. The harness
boots before the suite's `beforeAll`, the mongoose default connection is
wired up to the container, and `reset()` drops all collections between
tests without restarting the container.

## Environment variables

| Var                     | Meaning                                              |
| ----------------------- | ---------------------------------------------------- |
| `MONGO_HARNESS=1`       | Force CI mode — hard-fail instead of skip when Docker is missing. Not needed locally. |

## Docker availability

- **Local (no Docker):** `describeHarness(...)` auto-skips and prints a
  warning. Every other unit test runs normally.
- **Local (Docker running):** suite runs. First run pulls `mongo:7.0`
  (~150 MB); subsequent runs use the cached image and the container
  starts in **~8 s** on an M-series Mac (measured). Budget up to 30 s on
  cold CI runners.
- **CI:** set `MONGO_HARNESS=1` in the job env. Missing Docker becomes
  a hard failure.

Run harness tests only:

```bash
yarn workspace ledgerbuddy-backend run test:harness
```

## Fixture determinism

`buildFixtures({ seed, tenants, vendorsPerTenant, invoicesPerVendor })`
uses a seeded LCG PRNG and derives ObjectIds from `(prefix, index)`, so
the same seed always yields the same tenants / vendors / invoices /
GSTIN / PAN / totalAmountMinor values. `FIXTURE_NOW` is pinned at
`2026-04-23T00:00:00Z` — never use `new Date()` in tests, use
`FIXTURE_NOW` so assertions stay reproducible across timezones.

## Prod-scale dataset (INFRA-3 perf)

```ts
import { generateDataset } from "@/test-utils";

const result = await generateDataset({
  tenants: 10,
  vendorsPerTenant: 50,
  invoicesPerVendor: 200   // 100_000 invoices total
});
console.log(`loaded ${result.invoiceCount} invoices in ${result.elapsedMs} ms`);
```

Large datasets are **not** committed. To produce a JSON dump locally:

```ts
import { buildFixtures, dumpDataset } from "@/test-utils";
const set = await buildFixtures({
  tenants: 10,
  vendorsPerTenant: 50,
  invoicesPerVendor: 200
});
dumpDataset(set, "/tmp/ledgerbuddy-perf-dataset.json");
```

Then `loadDatasetFromFile("/tmp/...")` in the perf suite. The file is
~30 MB per 10 k invoices.

## File map

| File                        | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `mongoTestHarness.ts`       | `startMongoHarness()` + `describeHarness()` Jest integration, Docker probe, replica-set boot |
| `fixtures.ts`               | `buildFixtures()` deterministic tenant/vendor/invoice generator (reuses existing mongoose models — no schema duplication) |
| `datasetLoader.ts`          | `generateDataset()` / `dumpDataset()` / `loadDatasetFromFile()` for INFRA-3 perf benchmarks |
| `index.ts`                  | Barrel re-export                                     |
| `mongoTestHarness.test.ts`  | Dual-layer self-test (pure helpers + containerised)  |

## Downstream consumers

PRs that depend on this harness:

- **BE-0** — `$jsonSchema` DB-level validators on `*Minor` fields (Phase 0.4)
- **BE-10** — payment transactions (Phase 2)
- **Vendor-merge** — cross-collection transaction (Phase 3)
- **INFRA-3** — CI perf gates (p95 TDS < 200 ms, payment < 500 ms)
