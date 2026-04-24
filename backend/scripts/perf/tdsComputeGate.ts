import { IMPLEMENTATION_STATUS, runAndReportPerfGate } from "./perfGate.js";

const TDS_P95_BUDGET_MS = 200;
const ITERATIONS = Number(process.env.PERF_ITERATIONS ?? 100);
const WARMUP = Number(process.env.PERF_WARMUP ?? 10);

function placeholderTdsCompute(): void {
  const cumulativeInvoices = 64;
  let sumMinor = 0;
  for (let i = 0; i < cumulativeInvoices; i += 1) {
    const gross = 100_000 + i * 137;
    const rateBps = i % 3 === 0 ? 1000 : 200;
    const tds = Math.floor((gross * rateBps) / 10_000);
    sumMinor += gross - tds;
  }
  if (sumMinor < 0) throw new Error("unreachable");
}

async function main(): Promise<void> {
  const code = await runAndReportPerfGate({
    id: "tds_compute",
    nfr: "NFR-001",
    budgetMs: TDS_P95_BUDGET_MS,
    iterations: ITERATIONS,
    warmup: WARMUP,
    implementation: IMPLEMENTATION_STATUS.PLACEHOLDER,
    compute: placeholderTdsCompute
  });
  process.exit(code);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("tds_compute gate crashed:", err);
  process.exit(2);
});
