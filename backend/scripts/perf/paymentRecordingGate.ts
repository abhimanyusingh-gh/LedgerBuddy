import { IMPLEMENTATION_STATUS, runAndReportPerfGate } from "./perfGate.js";

const PAYMENT_P95_BUDGET_MS = 500;
const ITERATIONS = Number(process.env.PERF_ITERATIONS ?? 100);
const WARMUP = Number(process.env.PERF_WARMUP ?? 10);

function placeholderPaymentRecording(): void {
  const allocationCount = 32;
  let remaining = 2_500_000;
  const ledger: Array<{ invoice: number; appliedMinor: number }> = [];
  for (let i = 0; i < allocationCount && remaining > 0; i += 1) {
    const outstandingMinor = 60_000 + (i * 2_137) % 120_000;
    const applied = Math.min(remaining, outstandingMinor);
    ledger.push({ invoice: i, appliedMinor: applied });
    remaining -= applied;
  }
  const total = ledger.reduce((a, b) => a + b.appliedMinor, 0);
  if (total < 0) throw new Error("unreachable");
}

async function main(): Promise<void> {
  const code = await runAndReportPerfGate({
    id: "payment_recording",
    nfr: "NFR-002",
    budgetMs: PAYMENT_P95_BUDGET_MS,
    iterations: ITERATIONS,
    warmup: WARMUP,
    implementation: IMPLEMENTATION_STATUS.PLACEHOLDER,
    compute: placeholderPaymentRecording
  });
  process.exit(code);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("payment_recording gate crashed:", err);
  process.exit(2);
});
