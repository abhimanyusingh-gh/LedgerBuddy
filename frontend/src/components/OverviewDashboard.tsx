import { useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import { fetchAnalyticsOverview } from "../api";
import { EmptyState } from "./EmptyState";
import type { AnalyticsOverview, DailyStat, VendorStat } from "../types";
import { STATUS_LABELS } from "../invoiceView";
import { computeBurndown } from "../burndown";

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return toLocalDateStr(new Date());
}

function firstOfMonthStr(): string {
  const now = new Date();
  return toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
}

function firstOfQuarterStr(): string {
  const now = new Date();
  const quarterStart = Math.floor(now.getMonth() / 3) * 3;
  return toLocalDateStr(new Date(now.getFullYear(), quarterStart, 1));
}

function nDaysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n + 1);
  return toLocalDateStr(d);
}

function lastMonthRange(): { from: string; to: string } {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfLastMonth = new Date(firstOfThisMonth.getTime() - 1);
  const firstOfLastMonth = new Date(lastOfLastMonth.getFullYear(), lastOfLastMonth.getMonth(), 1);
  return {
    from: toLocalDateStr(firstOfLastMonth),
    to: toLocalDateStr(lastOfLastMonth)
  };
}

type PresetKey = "this-month" | "last-month" | "7d" | "30d" | "quarter" | null;

function priorPeriodRange(from: string, to: string): { from: string; to: string } {
  const start = new Date(from);
  const end = new Date(to);
  const durationMs = end.getTime() - start.getTime();
  const priorEnd = new Date(start.getTime() - 1);
  const priorStart = new Date(priorEnd.getTime() - durationMs);
  return {
    from: priorStart.toISOString().slice(0, 10),
    to: priorEnd.toISOString().slice(0, 10)
  };
}

function fmtInr(minor: number): string {
  return (minor / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function fmtInrShort(minor: number): string {
  const major = minor / 100;
  if (major >= 10_000_000) return `₹${(major / 10_000_000).toFixed(1)}Cr`;
  if (major >= 100_000) return `₹${(major / 100_000).toFixed(1)}L`;
  if (major >= 1_000) return `₹${(major / 1_000).toFixed(1)}K`;
  return `₹${major.toFixed(0)}`;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function computeTrend(current: number, prior: number): { label: string; direction: "up" | "down" | "neutral" } {
  if (prior === 0 && current === 0) return { label: "—", direction: "neutral" };
  if (prior === 0) return { label: "+100%", direction: "up" };
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) return { label: "0%", direction: "neutral" };
  return {
    label: pct > 0 ? `+${pct}%` : `${pct}%`,
    direction: pct > 0 ? "up" : "down"
  };
}

const STATUS_COLORS: Record<string, string> = {
  APPROVED: "var(--status-approved)",
  EXPORTED: "var(--status-exported)",
  PARSED: "var(--status-parsed)",
  NEEDS_REVIEW: "var(--status-needs-review)",
  PENDING: "var(--status-pending)",
  FAILED_OCR: "var(--status-failed-ocr)",
  FAILED_PARSE: "var(--status-failed-parse)"
};

const VENDOR_COLORS = ["var(--chart-blue)", "var(--chart-emerald)", "var(--chart-amber)", "var(--chart-rose)", "var(--chart-violet)", "#94a3b8"];
const TOP_VENDOR_COUNT = 5;

function collapseVendors(vendors: VendorStat[]): VendorStat[] {
  if (vendors.length <= TOP_VENDOR_COUNT) return vendors;
  const top = vendors.slice(0, TOP_VENDOR_COUNT);
  const rest = vendors.slice(TOP_VENDOR_COUNT);
  const others: VendorStat = {
    vendor: `Others (${rest.length})`,
    count: rest.reduce((s, v) => s + v.count, 0),
    amountMinor: rest.reduce((s, v) => s + v.amountMinor, 0)
  };
  return [...top, others];
}

const KPI_ICONS: Record<string, string> = {
  total: "receipt_long",
  approved: "check_circle",
  pending: "schedule",
  exported: "upload",
  review: "flag"
};

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  warn?: boolean;
  icon?: string;
  trend?: { label: string; direction: "up" | "down" | "neutral" };
  sparkData?: DailyStat[];
}

function KpiCard({ label, value, sub, accent, warn, icon, trend, sparkData }: KpiCardProps) {
  return (
    <div className="platform-stat-tile" style={accent ? { borderTop: "3px solid var(--accent)" } : warn ? { borderTop: "3px solid var(--warn)" } : {}}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        {icon ? <span className="material-symbols-outlined" style={{ fontSize: "1.1rem", color: "var(--ink-soft)" }}>{icon}</span> : null}
        <span className="platform-stat-label">{label}</span>
      </div>
      <span className="platform-stat-value">{value}</span>
      {trend ? (
        <span className={`kpi-trend kpi-trend-${trend.direction}`}>
          {trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "—"} {trend.label}
        </span>
      ) : null}
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

function KpiSkeleton() {
  return (
    <div className="platform-stat-tile">
      <div className="skeleton skeleton-text" style={{ width: "50%" }} />
      <div className="skeleton skeleton-value" style={{ marginTop: 6 }} />
      <div className="skeleton skeleton-text" style={{ width: "35%", marginTop: 4 }} />
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="overview-chart-card">
      <div className="skeleton skeleton-text" style={{ width: "40%", height: "0.9rem", marginBottom: "0.75rem" }} />
      <div className="skeleton skeleton-chart" />
    </div>
  );
}

function ChartEmptyState() {
  return (
    <div className="chart-empty-state">
      <span className="material-symbols-outlined">bar_chart</span>
      <p>No data for this period</p>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const formattedDate = label ? fmtDate(label) : "";
  const isAmount = entry.name === "amountMinor";
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{formattedDate}</div>
      <div className="chart-tooltip-value">{isAmount ? fmtInr(entry.value) : entry.value}</div>
      <div className="chart-tooltip-label">{isAmount ? "Amount" : entry.name === "count" ? "Count" : entry.name}</div>
    </div>
  );
}

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
    let cancelled = false;
    setLoading(true);
    setError(null);
    const prior = priorPeriodRange(from, to);
    Promise.all([
      fetchAnalyticsOverview(from, to, scope),
      fetchAnalyticsOverview(prior.from, prior.to, scope).catch(() => null)
    ])
      .then(([current, priorResult]) => {
        if (!cancelled) {
          setData(current);
          setPriorData(priorResult);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load analytics.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [from, to, scope]);

  function applyPreset(f: string, t: string, key: PresetKey) {
    setFrom(f);
    setTo(t);
    setActivePreset(key);
  }

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

  const donutTotal = useMemo(() => {
    if (!data) return 0;
    return data.statusBreakdown.reduce((sum, entry) => sum + entry.count, 0);
  }, [data]);

  return (
    <div className="overview-dashboard">
      <div className="overview-date-bar">
        <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--ink-soft)" }}>Date range:</span>
        <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setActivePreset(null); }} />
        <span style={{ color: "var(--ink-soft)" }}>–</span>
        <input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setActivePreset(null); }} />
        <button className={`overview-preset-btn${activePreset === "this-month" ? " overview-preset-btn-active" : ""}`} onClick={() => applyPreset(firstOfMonthStr(), todayStr(), "this-month")}>This Month</button>
        <button className={`overview-preset-btn${activePreset === "last-month" ? " overview-preset-btn-active" : ""}`} onClick={() => { const r = lastMonthRange(); applyPreset(r.from, r.to, "last-month"); }}>Last Month</button>
        <button className={`overview-preset-btn${activePreset === "7d" ? " overview-preset-btn-active" : ""}`} onClick={() => applyPreset(nDaysAgoStr(7), todayStr(), "7d")}>Last 7 Days</button>
        <button className={`overview-preset-btn${activePreset === "30d" ? " overview-preset-btn-active" : ""}`} onClick={() => applyPreset(nDaysAgoStr(30), todayStr(), "30d")}>Last 30 Days</button>
        <button className={`overview-preset-btn${activePreset === "quarter" ? " overview-preset-btn-active" : ""}`} onClick={() => applyPreset(firstOfQuarterStr(), todayStr(), "quarter")}>This Quarter</button>
        {loading ? <span style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>Refreshing…</span> : null}
        <div style={{ marginLeft: "auto", display: "flex", gap: 0, borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)" }}>
          <button
            style={{ padding: "0.3rem 0.8rem", fontSize: "0.8rem", fontWeight: scope === "mine" ? 700 : 400, background: scope === "mine" ? "var(--accent)" : "var(--bg)", color: scope === "mine" ? "#fff" : "var(--ink)", border: "none", cursor: "pointer" }}
            onClick={() => setScope("mine")}
          >My Approvals</button>
          <button
            style={{ padding: "0.3rem 0.8rem", fontSize: "0.8rem", fontWeight: scope === "all" ? 700 : 400, background: scope === "all" ? "var(--accent)" : "var(--bg)", color: scope === "all" ? "#fff" : "var(--ink)", border: "none", cursor: "pointer" }}
            onClick={() => setScope("all")}
          >All Users</button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {loading && !data ? (
        <>
          <div className="platform-stats-grid">
            {Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)}
          </div>
          <div className="overview-charts-grid">
            {Array.from({ length: 4 }).map((_, i) => <ChartSkeleton key={i} />)}
          </div>
        </>
      ) : null}

      {data ? (
        <>
          <div className="platform-stats-grid">
            <KpiCard label="Total Invoices" value={kpis?.totalInvoices ?? "—"} icon={KPI_ICONS.total} trend={trends?.total} sparkData={data.dailyIngestion} />
            <KpiCard label="Approved Amount" value={kpis != null ? fmtInr(kpis.approvedAmountMinor) : "—"} sub={kpis != null ? `${kpis.approvedCount} invoices` : undefined} accent icon={KPI_ICONS.approved} trend={trends?.approved} sparkData={data.dailyApprovals} />
            <KpiCard label="Pending Amount" value={kpis != null ? fmtInr(kpis.pendingAmountMinor) : "—"} warn icon={KPI_ICONS.pending} trend={trends?.pending} />
            <KpiCard label="Exported" value={kpis?.exportedCount ?? "—"} icon={KPI_ICONS.exported} trend={trends?.exported} sparkData={data.dailyExports} />
            <KpiCard label="Needs Review" value={kpis?.needsReviewCount ?? "—"} warn={!!kpis && kpis.needsReviewCount > 0} icon={KPI_ICONS.review} trend={trends?.review} />
          </div>

          <div className="overview-charts-grid">
            <div className="overview-chart-card">
              <h4>
                Daily Approvals
                <span className="chart-subtitle">Number of invoices approved per day</span>
              </h4>
              {data.dailyApprovals.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.dailyApprovals} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="count" fill="var(--accent)" radius={[3, 3, 0, 0]} animationDuration={800} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <ChartEmptyState />}
            </div>

            <div className="overview-chart-card">
              <h4>
                Daily Approved Amount
                <span className="chart-subtitle">Total approved value in INR per day</span>
              </h4>
              {data.dailyApprovals.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.dailyApprovals} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtInrShort(v)} width={52} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="amountMinor" name="amountMinor" fill="var(--chart-emerald)" radius={[3, 3, 0, 0]} animationDuration={800} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <ChartEmptyState />}
            </div>

            <div className="overview-chart-card">
              <h4>
                Daily Ingestion Volume
                <span className="chart-subtitle">New invoices received per day</span>
              </h4>
              {data.dailyIngestion.length > 0 ? (
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
              ) : <ChartEmptyState />}
            </div>

            <div className="overview-chart-card" style={{ position: "relative" }}>
              <h4>
                Status Breakdown
                <span className="chart-subtitle">Current distribution by status</span>
              </h4>
              {data.statusBreakdown.length > 0 ? (
                <>
                  <div style={{ position: "relative" }}>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={data.statusBreakdown}
                          dataKey="count"
                          nameKey="status"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          animationDuration={800}
                        >
                          {data.statusBreakdown.map((entry) => (
                            <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number, name: string) => [v, STATUS_LABELS[name] ?? name]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="donut-center-label">
                      <strong>{donutTotal}</strong>
                      <span>Total</span>
                    </div>
                  </div>
                  <div className="donut-legend">
                    {data.statusBreakdown.map((entry) => (
                      <div key={entry.status} className="donut-legend-item">
                        <span className="donut-legend-dot" style={{ background: STATUS_COLORS[entry.status] ?? "#94a3b8" }} />
                        <span>{STATUS_LABELS[entry.status] ?? entry.status}</span>
                        <span className="donut-legend-count">{entry.count}</span>
                        <span className="donut-legend-pct">({donutTotal > 0 ? Math.round((entry.count / donutTotal) * 100) : 0}%)</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <ChartEmptyState />}
            </div>

            <div className="overview-chart-card">
              <h4>
                Daily Exports
                <span className="chart-subtitle">Invoices exported to Tally per day</span>
              </h4>
              {data.dailyExports.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.dailyExports} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="count" fill="var(--chart-violet)" radius={[3, 3, 0, 0]} animationDuration={800} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <ChartEmptyState />}
            </div>

            <div className="overview-chart-card">
              <h4>
                Pending Burndown
                <span className="chart-subtitle">Remaining unapproved value (₹)</span>
              </h4>
              {(() => {
                const totalAmount = (kpis?.approvedAmountMinor ?? 0) + (kpis?.pendingAmountMinor ?? 0);
                const burndown = computeBurndown(totalAmount, data.dailyApprovals);
                return burndown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={burndown} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtInrShort(v)} width={52} />
                      <Tooltip formatter={(v: number) => [fmtInr(v), "Remaining"]} labelFormatter={fmtDate} />
                      <Line type="monotone" dataKey="remainingMinor" stroke="var(--chart-rose)" strokeWidth={2} dot={false} animationDuration={800} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <ChartEmptyState />;
              })()}
            </div>
          </div>

          <div className="overview-vendors-grid">
            <div className="overview-chart-card">
              <h4>
                Top Vendors by Approved Amount
                <span className="chart-subtitle">Highest-value approved vendors</span>
              </h4>
              {data.topVendorsByApproved.length > 0 ? (() => {
                const collapsed = collapseVendors(data.topVendorsByApproved);
                return (
                  <ResponsiveContainer width="100%" height={Math.max(160, collapsed.length * 36)}>
                    <BarChart data={collapsed} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtInrShort(v)} />
                      <YAxis type="category" dataKey="vendor" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [fmtInr(v), "Approved"]} />
                      <Bar dataKey="amountMinor" radius={[0, 3, 3, 0]} animationDuration={800}>
                        {collapsed.map((_, i) => (
                          <Cell key={i} fill={VENDOR_COLORS[i % VENDOR_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                );
              })() : <ChartEmptyState />}
            </div>

            <div className="overview-chart-card">
              <h4>
                Top Vendors by Pending Amount
                <span className="chart-subtitle">Vendors with highest pending value</span>
              </h4>
              {data.topVendorsByPending.length > 0 ? (() => {
                const collapsed = collapseVendors(data.topVendorsByPending);
                return (
                  <ResponsiveContainer width="100%" height={Math.max(160, collapsed.length * 36)}>
                    <BarChart data={collapsed} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtInrShort(v)} />
                      <YAxis type="category" dataKey="vendor" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [fmtInr(v), "Pending"]} />
                      <Bar dataKey="amountMinor" radius={[0, 3, 3, 0]} animationDuration={800}>
                        {collapsed.map((_, i) => (
                          <Cell key={i} fill={VENDOR_COLORS[i % VENDOR_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                );
              })() : <ChartEmptyState />}
            </div>
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
