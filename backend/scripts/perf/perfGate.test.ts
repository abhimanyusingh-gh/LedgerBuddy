import { test } from "node:test";
import assert from "node:assert/strict";
import { IMPLEMENTATION_STATUS, runPerfGate } from "./perfGate.js";

test("runPerfGate returns PASS when compute stays well under budget", async () => {
  const outcome = await runPerfGate({
    id: "pass_case",
    nfr: "TEST",
    budgetMs: 50,
    iterations: 30,
    warmup: 2,
    implementation: IMPLEMENTATION_STATUS.PLACEHOLDER,
    compute: () => {
      let x = 0;
      for (let i = 0; i < 100; i += 1) x += i;
      if (x < 0) throw new Error("unreachable");
    }
  });
  assert.equal(outcome.status, "PASS");
  assert.ok(outcome.p95Ms <= outcome.budgetMs, `p95=${outcome.p95Ms} > budget=${outcome.budgetMs}`);
});

test("runPerfGate returns FAIL when compute exceeds budget", async () => {
  const outcome = await runPerfGate({
    id: "fail_case",
    nfr: "TEST",
    budgetMs: 1,
    iterations: 25,
    warmup: 1,
    implementation: IMPLEMENTATION_STATUS.PLACEHOLDER,
    compute: () => {
      let acc = 0;
      for (let i = 0; i < 5_000_000; i += 1) acc += i;
      if (acc < 0) throw new Error("unreachable");
    }
  });
  assert.equal(outcome.status, "FAIL");
  assert.ok(outcome.p95Ms > outcome.budgetMs, `p95=${outcome.p95Ms} <= budget=${outcome.budgetMs}`);
});

test("runPerfGate throws when iterations below minSamples", async () => {
  await assert.rejects(
    () =>
      runPerfGate({
        id: "too_few",
        nfr: "TEST",
        budgetMs: 10,
        iterations: 5,
        warmup: 0,
        implementation: IMPLEMENTATION_STATUS.PLACEHOLDER,
        compute: () => {}
      }),
    /minSamples/
  );
});
