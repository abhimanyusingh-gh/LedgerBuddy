import type { DailyStat } from "./types";

export function computeBurndown(
  totalAmountMinor: number,
  approvals: DailyStat[]
): Array<{ date: string; remainingMinor: number }> {
  if (approvals.length === 0 || totalAmountMinor <= 0) return [];

  const sorted = [...approvals].sort((a, b) => a.date.localeCompare(b.date));
  let remaining = totalAmountMinor;

  return sorted.map((entry) => {
    remaining = Math.max(0, remaining - (entry.amountMinor ?? 0));
    return { date: entry.date, remainingMinor: remaining };
  });
}
