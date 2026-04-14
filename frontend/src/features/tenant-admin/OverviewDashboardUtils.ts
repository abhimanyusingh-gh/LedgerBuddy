import type { DailyStat, VendorStat } from "@/types";

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateOffset(mutate: (d: Date) => void): string {
  const d = new Date();
  mutate(d);
  return toLocalDateStr(d);
}

export const todayStr = (): string => toLocalDateStr(new Date());
export const firstOfMonthStr = (): string => dateOffset((d) => d.setDate(1));
const firstOfQuarterStr = (): string => dateOffset((d) => {
  d.setMonth(Math.floor(d.getMonth() / 3) * 3);
  d.setDate(1);
});
const nDaysAgoStr = (n: number): string => dateOffset((d) => d.setDate(d.getDate() - n + 1));

function lastMonthRange(): { from: string; to: string } {
  const first = new Date();
  first.setDate(1);
  const lastDay = new Date(first.getTime() - 1);
  return { from: toLocalDateStr(new Date(lastDay.getFullYear(), lastDay.getMonth(), 1)), to: toLocalDateStr(lastDay) };
}

export type PresetKey = "this-month" | "last-month" | "7d" | "30d" | "quarter" | null;

export function priorPeriodRange(from: string, to: string): { from: string; to: string } {
  const start = new Date(from);
  const end = new Date(to);
  const priorEnd = new Date(start.getTime() - 1);
  return {
    from: new Date(priorEnd.getTime() - (end.getTime() - start.getTime())).toISOString().slice(0, 10),
    to: priorEnd.toISOString().slice(0, 10)
  };
}

export function fmtInr(minor: number): string {
  return (minor / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

export function fmtInrShort(minor: number): string {
  const major = minor / 100;
  if (major >= 10_000_000) return `\u20B9${(major / 10_000_000).toFixed(1)}Cr`;
  if (major >= 100_000) return `\u20B9${(major / 100_000).toFixed(1)}L`;
  if (major >= 1_000) return `\u20B9${(major / 1_000).toFixed(1)}K`;
  return `\u20B9${major.toFixed(0)}`;
}

export function fmtDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function computeTrend(current: number, prior: number): { label: string; direction: "up" | "down" | "neutral" } {
  if (prior === 0 && current === 0) return { label: "\u2014", direction: "neutral" };
  if (prior === 0) return { label: "+100%", direction: "up" };
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) return { label: "0%", direction: "neutral" };
  return { label: pct > 0 ? `+${pct}%` : `${pct}%`, direction: pct > 0 ? "up" : "down" };
}

export const STATUS_COLORS: Record<string, string> = {
  APPROVED: "var(--status-approved)",
  EXPORTED: "var(--status-exported)",
  PARSED: "var(--status-parsed)",
  NEEDS_REVIEW: "var(--status-needs-review)",
  PENDING: "var(--status-pending)",
  FAILED_OCR: "var(--status-failed-ocr)",
  FAILED_PARSE: "var(--status-failed-ocr)"
};

export const VENDOR_COLORS = [
  "var(--chart-blue)",
  "var(--chart-emerald)",
  "var(--chart-amber)",
  "var(--chart-rose)",
  "var(--chart-violet)",
  "#94a3b8"
];

const TOP_VENDOR_COUNT = 5;

export function collapseVendors(vendors: VendorStat[]): VendorStat[] {
  if (vendors.length <= TOP_VENDOR_COUNT) return vendors;
  const top = vendors.slice(0, TOP_VENDOR_COUNT);
  const rest = vendors.slice(TOP_VENDOR_COUNT);
  return [
    ...top,
    {
      vendor: `Others (${rest.length})`,
      count: rest.reduce((s, v) => s + v.count, 0),
      amountMinor: rest.reduce((s, v) => s + v.amountMinor, 0)
    }
  ];
}

const KPI_ICONS: Record<string, string> = {
  total: "receipt_long",
  approved: "check_circle",
  pending: "schedule",
  exported: "upload",
  review: "flag"
};

export const PRESETS: Array<{ key: PresetKey; label: string; range: () => { from: string; to: string } }> = [
  { key: "this-month", label: "This Month", range: () => ({ from: firstOfMonthStr(), to: todayStr() }) },
  { key: "last-month", label: "Last Month", range: lastMonthRange },
  { key: "7d", label: "Last 7 Days", range: () => ({ from: nDaysAgoStr(7), to: todayStr() }) },
  { key: "30d", label: "Last 30 Days", range: () => ({ from: nDaysAgoStr(30), to: todayStr() }) },
  { key: "quarter", label: "This Quarter", range: () => ({ from: firstOfQuarterStr(), to: todayStr() }) }
];
