import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { fetchAnalyticsOverview } from "../api";
import { EmptyState } from "./EmptyState";
import type { AnalyticsOverview, DailyStat, VendorStat } from "../types";
import { STATUS_LABELS } from "../invoiceView";
import { computeBurndown } from "../burndown";

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateOffset(mutate: (d: Date) => void): string {
  const d = new Date();
  mutate(d);
  return toLocalDateStr(d);
}

const todayStr = () => toLocalDateStr(new Date());
const firstOfMonthStr = () => dateOffset(d => d.setDate(1));
const firstOfQuarterStr = () => dateOffset(d => { d.setMonth(Math.floor(d.getMonth() / 3) * 3); d.setDate(1); });
const nDaysAgoStr = (n: number) => dateOffset(d => d.setDate(d.getDate() - n + 1));

function lastMonthRange(): { from: string; to: string } {
  const first = new Date();
  first.setDate(1);
  const lastDay = new Date(first.getTime() - 1);
  return { from: toLocalDateStr(new Date(lastDay.getFullYear(), lastDay.getMonth(), 1)), to: toLocalDateStr(lastDay) };
}

type PresetKey = "this-month" | "last-month" | "7d" | "30d" | "quarter" | null;

function priorPeriodRange(from: string, to: string): { from: string; to: string } {
  const start = new Date(from), end = new Date(to);
  const priorEnd = new Date(start.getTime() - 1);
  return { from: new Date(priorEnd.getTime() - (end.getTime() - start.getTime())).toISOString().slice(0, 10), to: priorEnd.toISOString().slice(0, 10) };
}

function fmtInr(minor: number): string {
  return (minor / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function fmtInrShort(minor: number): string {
  const major = minor / 100;
  if (major >= 10_000_000) return `\u20B9${(major / 10_000_000).toFixed(1)}Cr`;
  if (major >= 100_000) return `\u20B9${(major / 100_000).toFixed(1)}L`;
  if (major >= 1_000) return `\u20B9${(major / 1_000).toFixed(1)}K`;
  return `\u20B9${major.toFixed(0)}`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function computeTrend(current: number, prior: number): { label: string; direction: "up" | "down" | "neutral" } {
  if (prior === 0 && current === 0) return { label: "\u2014", direction: "neutral" };
  if (prior === 0) return { label: "+100%", direction: "up" };
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) return { label: "0%", direction: "neutral" };
  return { label: pct > 0 ? `+${pct}%` : `${pct}%`, direction: pct > 0 ? "up" : "down" };
}

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "var(--status-approved)", EXPORTED: "var(--status-exported)", PARSED: "var(--status-parsed)",
  NEEDS_REVIEW: "var(--status-needs-review)", PENDING: "var(--status-pending)",
  FAILED_OCR: "var(--status-failed-ocr)", FAILED_PARSE: "var(--status-failed-parse)"
};

const VENDOR_COLORS = ["var(--chart-blue)", "var(--chart-emerald)", "var(--chart-amber)", "var(--chart-rose)", "var(--chart-violet)", "#94a3b8"];
const TOP_VENDOR_COUNT = 5;

function collapseVendors(vendors: VendorStat[]): VendorStat[] {
  if (vendors.length <= TOP_VENDOR_COUNT) return vendors;
  const top = vendors.slice(0, TOP_VENDOR_COUNT);
  const rest = vendors.slice(TOP_VENDOR_COUNT);
  return [...top, { vendor: `Others (${rest.length})`, count: rest.reduce((s, v) => s + v.count, 0), amountMinor: rest.reduce((s, v) => s + v.amountMinor, 0) }];
}

const KPI_ICONS: Record<string, string> = { total: "receipt_long", approved: "check_circle", pending: "schedule", exported: "upload", review: "flag" };

interface KpiCardProps {
  label: string; value: string | number; sub?: string; accent?: boolean; warn?: boolean;
  icon?: string; trend?: { label: string; direction: "up" | "down" | "neutral" }; sparkData?: DailyStat[];
}

function KpiCard({ label, value, sub, accent, warn, icon, trend, sparkData }: KpiCardProps) {
  const border = accent ? "3px solid var(--accent)" : warn ? "3px solid var(--warn)" : undefined;
  return (
    <div className="platform-stat-tile" style={border ? { borderTop: border } : {}}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        {icon ? <span className="material-symbols-outlined" style={{ fontSize: "1.1rem", color: "var(--ink-soft)" }}>{icon}</span> : null}
        <span className="platform-stat-label">{label}</span>
      </div>
      <span className="platform-stat-value">{value}</span>
      {trend ? <span className={`kpi-trend kpi-trend-${trend.direction}`}>{trend.direction === "up" ? "\u2191" : trend.direction === "down" ? "\u2193" : "\u2014"} {trend.label}</span> : null}
      {sub ? <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)", marginTop: 2 }}>{sub}</span> : null}
      {sparkData && sparkData.length > 1 ? (
        <div className="kpi-sparkline">
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={sparkData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
              <defs>
                <linearGradient id={`spark-${label.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="count" stroke="var(--accent)" fill={`url(#spark-${label.replace(/\s/g, "")})`} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const isAmount = entry.name === "amountMinor";
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{label ? fmtDate(label) : ""}</div>
      <div className="chart-tooltip-value">{isAmount ? fmtInr(entry.value) : entry.value}</div>
      <div className="chart-tooltip-label">{isAmount ? "Amount" : entry.name === "count" ? "Count" : entry.name}</div>
    </div>
  );
}

function ChartCard({ title, subtitle, children, style }: { title: string; subtitle: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="overview-chart-card" style={style}>
      <h4>{title}<span className="chart-subtitle">{subtitle}</span></h4>
      {children}
    </div>
  );
}

function ChartOrEmpty({ hasData, children }: { hasData: boolean; children: React.ReactNode }) {
  if (!hasData) return <div className="chart-empty-state"><span className="material-symbols-outlined">bar_chart</span><p>No data for this period</p></div>;
  return <>{children}</>;
}

function TimeSeriesBarChart({ data, dataKey, fill, yWidth = 32, yFormatter }: { data: DailyStat[]; dataKey: string; fill: string; yWidth?: number; yFormatter?: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={!yFormatter} width={yWidth} tickFormatter={yFormatter} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey={dataKey} name={dataKey} fill={fill} radius={[3, 3, 0, 0]} animationDuration={800} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function VendorBarChart({ vendors, tooltipLabel }: { vendors: VendorStat[]; tooltipLabel: string }) {
  const collapsed = collapseVendors(vendors);
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, collapsed.length * 36)}>
      <BarChart data={collapsed} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtInrShort(v)} />
        <YAxis type="category" dataKey="vendor" width={120} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => [fmtInr(v), tooltipLabel]} />
        <Bar dataKey="amountMinor" radius={[0, 3, 3, 0]} animationDuration={800}>
          {collapsed.map((_, i) => <Cell key={i} fill={VENDOR_COLORS[i % VENDOR_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const PRESETS: Array<{ key: PresetKey; label: string; range: () => { from: string; to: string } }> = [
  { key: "this-month", label: "This Month", range: () => ({ from: firstOfMonthStr(), to: todayStr() }) },
  { key: "last-month", label: "Last Month", range: lastMonthRange },
  { key: "7d", label: "Last 7 Days", range: () => ({ from: nDaysAgoStr(7), to: todayStr() }) },
  { key: "30d", label: "Last 30 Days", range: () => ({ from: nDaysAgoStr(30), to: todayStr() }) },
  { key: "quarter", label: "This Quarter", range: () => ({ from: firstOfQuarterStr(), to: todayStr() }) },
];

const scopeStyle = (active: boolean): React.CSSProperties => ({
  padding: "0.3rem 0.8rem", fontSize: "0.8rem", fontWeight: active ? 700 : 400,
  background: active ? "var(--accent)" : "var(--bg)", color: active ? "#fff" : "var(--ink)", border: "none", cursor: "pointer"
});

export function OverviewDashboard() {
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [activePreset, setActivePreset] = useState<PresetKey>("this-month");
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [priorData, setPriorData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (from && to && from > to) { setError("Start date must be before end date"); return; }
    if (to) {
      const max = new Date();
      max.setFullYear(max.getFullYear() + 1);
      if (to > max.toISOString().slice(0, 10)) { setError("End date cannot be more than one year from today"); return; }
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const prior = priorPeriodRange(from, to);
    Promise.all([fetchAnalyticsOverview(from, to, scope), fetchAnalyticsOverview(prior.from, prior.to, scope).catch(() => null)])
      .then(([current, priorResult]) => { if (!cancelled) { setData(current); setPriorData(priorResult); } })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load analytics."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to, scope]);

  function applyPreset(f: string, t: string, key: PresetKey) { setFrom(f); setTo(t); setActivePreset(key); }

  const kpis = data?.kpis;
  const priorKpis = priorData?.kpis;

  const trends = useMemo(() => {
    if (!kpis || !priorKpis) return null;
    return {
      total: computeTrend(kpis.totalInvoices, priorKpis.totalInvoices),
      approved: computeTrend(kpis.approvedAmountMinor, priorKpis.approvedAmountMinor),
      pending: computeTrend(kpis.pendingAmountMinor, priorKpis.pendingAmountMinor),
      exported: computeTrend(kpis.exportedCount, priorKpis.exportedCount),
      review: computeTrend(kpis.needsReviewCount, priorKpis.needsReviewCount)
    };
  }, [kpis, priorKpis]);

  const donutTotal = useMemo(() => data?.statusBreakdown.reduce((sum, e) => sum + e.count, 0) ?? 0, [data]);

  return (
    <div className="overview-dashboard">
      <div className="overview-date-bar">
        <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--ink-soft)" }}>Date range:</span>
        <input type="date" value={from} max={to} onChange={e => { setFrom(e.target.value); setActivePreset(null); }} />
        <span style={{ color: "var(--ink-soft)" }}>{"\u2013"}</span>
        <input type="date" value={to} min={from} onChange={e => { setTo(e.target.value); setActivePreset(null); }} />
        {PRESETS.map(p => (
          <button key={p.key} className={`overview-preset-btn${activePreset === p.key ? " overview-preset-btn-active" : ""}`}
            onClick={() => { const r = p.range(); applyPreset(r.from, r.to, p.key); }}>{p.label}</button>
        ))}
        {loading ? <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>Refreshing\u2026</span> : null}
        <div style={{ marginLeft: "auto", display: "flex", gap: 0, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
          {(["mine", "all"] as const).map(s => (
            <button key={s} style={scopeStyle(scope === s)} onClick={() => setScope(s)}>
              {s === "mine" ? "My Approvals" : "All Users"}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {loading && !data ? (
        <>
          <div className="platform-stats-grid">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="platform-stat-tile">
                <div className="skeleton skeleton-text" style={{ width: "50%" }} />
                <div className="skeleton skeleton-value" style={{ marginTop: 6 }} />
                <div className="skeleton skeleton-text" style={{ width: "35%", marginTop: 4 }} />
              </div>
            ))}
          </div>
          <div className="overview-charts-grid">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="overview-chart-card">
                <div className="skeleton skeleton-text" style={{ width: "40%", height: "0.9rem", marginBottom: "0.75rem" }} />
                <div className="skeleton skeleton-chart" />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {data ? (
        <>
          <div className="platform-stats-grid">
            <KpiCard label="Total Invoices" value={kpis?.totalInvoices ?? "\u2014"} icon={KPI_ICONS.total} trend={trends?.total} sparkData={data.dailyIngestion} />
            <KpiCard label="Approved Amount" value={kpis != null ? fmtInr(kpis.approvedAmountMinor) : "\u2014"} sub={kpis != null ? `${kpis.approvedCount} invoices` : undefined} accent icon={KPI_ICONS.approved} trend={trends?.approved} sparkData={data.dailyApprovals} />
            <KpiCard label="Pending Amount" value={kpis != null ? fmtInr(kpis.pendingAmountMinor) : "\u2014"} warn icon={KPI_ICONS.pending} trend={trends?.pending} />
            <KpiCard label="Exported" value={kpis?.exportedCount ?? "\u2014"} icon={KPI_ICONS.exported} trend={trends?.exported} sparkData={data.dailyExports} />
            <KpiCard label="Needs Review" value={kpis?.needsReviewCount ?? "\u2014"} warn={!!kpis && kpis.needsReviewCount > 0} icon={KPI_ICONS.review} trend={trends?.review} />
          </div>

          <div className="overview-charts-grid">
            <ChartCard title="Daily Approvals" subtitle="Number of invoices approved per day">
              <ChartOrEmpty hasData={data.dailyApprovals.length > 0}>
                <TimeSeriesBarChart data={data.dailyApprovals} dataKey="count" fill="var(--accent)" />
              </ChartOrEmpty>
            </ChartCard>

            <ChartCard title="Daily Approved Amount" subtitle="Total approved value in INR per day">
              <ChartOrEmpty hasData={data.dailyApprovals.length > 0}>
                <TimeSeriesBarChart data={data.dailyApprovals} dataKey="amountMinor" fill="var(--chart-emerald)" yWidth={52} yFormatter={(v: number) => fmtInrShort(v)} />
              </ChartOrEmpty>
            </ChartCard>

            <ChartCard title="Daily Ingestion Volume" subtitle="New invoices received per day">
              <ChartOrEmpty hasData={data.dailyIngestion.length > 0}>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={data.dailyIngestion} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="ingestionGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="count" name="count" stroke="var(--accent)" fill="url(#ingestionGrad)" strokeWidth={2} animationDuration={800} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartOrEmpty>
            </ChartCard>

            <ChartCard title="Status Breakdown" subtitle="Current distribution by status" style={{ position: "relative" }}>
              <ChartOrEmpty hasData={data.statusBreakdown.length > 0}>
                <div style={{ position: "relative" }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={data.statusBreakdown} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} animationDuration={800}>
                        {data.statusBreakdown.map(entry => <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />)}
                      </Pie>
                      <Tooltip formatter={(v: number, name: string) => [v, STATUS_LABELS[name] ?? name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="donut-center-label"><strong>{donutTotal}</strong><span>Total</span></div>
                </div>
                <div className="donut-legend">
                  {data.statusBreakdown.map(entry => (
                    <div key={entry.status} className="donut-legend-item">
                      <span className="donut-legend-dot" style={{ background: STATUS_COLORS[entry.status] ?? "#94a3b8" }} />
                      <span>{STATUS_LABELS[entry.status] ?? entry.status}</span>
                      <span className="donut-legend-count">{entry.count}</span>
                      <span className="donut-legend-pct">({donutTotal > 0 ? Math.round((entry.count / donutTotal) * 100) : 0}%)</span>
                    </div>
                  ))}
                </div>
              </ChartOrEmpty>
            </ChartCard>

            <ChartCard title="Daily Exports" subtitle="Invoices exported to Tally per day">
              <ChartOrEmpty hasData={data.dailyExports.length > 0}>
                <TimeSeriesBarChart data={data.dailyExports} dataKey="count" fill="var(--chart-violet)" />
              </ChartOrEmpty>
            </ChartCard>

            <ChartCard title="Pending Burndown" subtitle="Remaining unapproved value (\u20B9)">
              {(() => {
                const burndown = computeBurndown((kpis?.approvedAmountMinor ?? 0) + (kpis?.pendingAmountMinor ?? 0), data.dailyApprovals);
                return (
                  <ChartOrEmpty hasData={burndown.length > 0}>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={burndown} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtInrShort(v)} width={52} />
                        <Tooltip formatter={(v: number) => [fmtInr(v), "Remaining"]} labelFormatter={fmtDate} />
                        <Line type="monotone" dataKey="remainingMinor" stroke="var(--chart-rose)" strokeWidth={2} dot={false} animationDuration={800} />
                      </LineChart>
                    </ResponsiveContainer>
                  </ChartOrEmpty>
                );
              })()}
            </ChartCard>
          </div>

          <div className="overview-vendors-grid">
            <ChartCard title="Top Vendors by Approved Amount" subtitle="Highest-value approved vendors">
              <ChartOrEmpty hasData={data.topVendorsByApproved.length > 0}>
                <VendorBarChart vendors={data.topVendorsByApproved} tooltipLabel="Approved" />
              </ChartOrEmpty>
            </ChartCard>
            <ChartCard title="Top Vendors by Pending Amount" subtitle="Vendors with highest pending value">
              <ChartOrEmpty hasData={data.topVendorsByPending.length > 0}>
                <VendorBarChart vendors={data.topVendorsByPending} tooltipLabel="Pending" />
              </ChartOrEmpty>
            </ChartCard>
          </div>
        </>
      ) : !loading ? (
        <EmptyState
          icon="insights"
          heading="No data for this period"
          description="Try adjusting the date range or check back after some invoices are processed."
          action={<button type="button" className="app-button app-button-primary" onClick={() => applyPreset(firstOfMonthStr(), todayStr(), "this-month")}>Reset to This Month</button>}
        />
      ) : null}
    </div>
  );
}
