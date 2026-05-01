import { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, CartesianGrid, LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchAnalyticsOverview } from "@/api";
import { EmptyState } from "@/components/common/EmptyState";
import { AdminRealmSwitcher } from "@/features/admin/AdminRealmSwitcher";
import { useAdminClientOrgFilter } from "@/hooks/useAdminClientOrgFilter";
import type { AnalyticsOverview } from "@/types";
import { STATUS_LABELS } from "@/lib/invoice/invoiceView";
import { computeBurndown } from "@/lib/common/burndown";
import {
  ChartCard,
  ChartOrEmpty,
  KpiCard,
  StatusDonut,
  TimeSeriesBarChart,
  VendorBarChart
} from "@/features/overview/OverviewDashboardCharts";
import {
  STATUS_COLORS,
  PRESETS,
  PresetKey,
  computeTrend,
  fmtDate,
  fmtInr,
  fmtInrShort,
  firstOfMonthStr,
  priorPeriodRange,
  todayStr
} from "@/features/overview/OverviewDashboardUtils";

export function OverviewDashboard() {
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [activePreset, setActivePreset] = useState<PresetKey>("this-month");
  const [scope, setScope] = useState<"mine" | "all">("all");
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [priorData, setPriorData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { clientOrgId } = useAdminClientOrgFilter();

  useEffect(() => {
    if (from && to && from > to) {
      setError("Start date must be before end date");
      return;
    }
    if (to) {
      const max = new Date();
      max.setFullYear(max.getFullYear() + 1);
      if (to > max.toISOString().slice(0, 10)) {
        setError("End date cannot be more than one year from today");
        return;
      }
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const prior = priorPeriodRange(from, to);
    Promise.all([
      fetchAnalyticsOverview(from, to, scope, clientOrgId),
      fetchAnalyticsOverview(prior.from, prior.to, scope, clientOrgId).catch(() => null)
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
    return () => {
      cancelled = true;
    };
  }, [from, to, scope, clientOrgId]);

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

  const donutTotal = useMemo(() => data?.statusBreakdown.reduce((sum, e) => sum + e.count, 0) ?? 0, [data]);

  return (
    <div className="overview-dashboard">
      <div className="overview-date-bar">
        <AdminRealmSwitcher />
        <span className="overview-date-bar-label">Date range:</span>
        <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setActivePreset(null); }} />
        <span className="overview-date-bar-sep">{"\u2013"}</span>
        <input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setActivePreset(null); }} />
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className="ds-pill"
            data-active={activePreset === preset.key ? "true" : undefined}
            aria-pressed={activePreset === preset.key}
            onClick={() => {
              const range = preset.range();
              applyPreset(range.from, range.to, preset.key);
            }}
          >
            {preset.label}
          </button>
        ))}
        {loading ? <span className="overview-date-bar-loading">Refreshing…</span> : null}
        <div className="ds-segmented-group overview-scope-toggle" role="group" aria-label="Approval scope">
          {(["mine", "all"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="ds-pill"
              data-active={scope === item ? "true" : undefined}
              aria-pressed={scope === item}
              onClick={() => setScope(item)}
            >
              {item === "mine" ? "My Approvals" : "All Users"}
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
                <div className="skeleton skeleton-text overview-skel-label" />
                <div className="skeleton skeleton-value overview-skel-value" />
                <div className="skeleton skeleton-text overview-skel-sub" />
              </div>
            ))}
          </div>
          <div className="overview-charts-grid">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="overview-chart-card">
                <div className="skeleton skeleton-text overview-skel-chart-title" />
                <div className="skeleton skeleton-chart" />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {data ? (
        <>
          <div className="platform-stats-grid">
            <KpiCard label="Total Invoices" value={kpis?.totalInvoices ?? "—"} icon="receipt_long" trend={trends?.total} sparkData={data.dailyIngestion} />
            <KpiCard label="Approved Amount" value={kpis != null ? fmtInr(kpis.approvedAmountMinor) : "—"} sub={kpis != null ? `${kpis.approvedCount} invoices` : undefined} accent icon="check_circle" trend={trends?.approved} sparkData={data.dailyApprovals} />
            <KpiCard label="Pending Amount" value={kpis != null ? fmtInr(kpis.pendingAmountMinor) : "—"} warn icon="schedule" trend={trends?.pending} />
            <KpiCard label="Exported" value={kpis?.exportedCount ?? "—"} icon="upload" trend={trends?.exported} sparkData={data.dailyExports} />
            <KpiCard label="Needs Review" value={kpis?.needsReviewCount ?? "—"} warn={!!kpis && kpis.needsReviewCount > 0} icon="flag" trend={trends?.review} />
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
                    <Tooltip />
                    <Area type="monotone" dataKey="count" name="count" stroke="var(--accent)" fill="url(#ingestionGrad)" strokeWidth={2} animationDuration={800} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartOrEmpty>
            </ChartCard>

            <ChartCard title="Status Breakdown" subtitle="Current distribution by status" relative>
              <ChartOrEmpty hasData={data.statusBreakdown.length > 0}>
                <StatusDonut data={data.statusBreakdown} total={donutTotal} statusColors={STATUS_COLORS} statusLabels={STATUS_LABELS} />
                <div className="donut-legend">
                  {data.statusBreakdown.map((entry) => (
                    <div key={entry.status} className="donut-legend-item">
                      <span className="donut-legend-dot" data-status={entry.status} />
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

            <ChartCard title="Pending Burndown" subtitle="Remaining unapproved value (₹)">
              {(() => {
                const burndown = computeBurndown((kpis?.approvedAmountMinor ?? 0) + (kpis?.pendingAmountMinor ?? 0), data.dailyApprovals);
                return (
                  <ChartOrEmpty hasData={burndown.length > 0}>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={burndown} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={fmtDate} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(value: number) => fmtInrShort(value)} width={52} />
                        <Tooltip formatter={(value: number) => [fmtInr(value), "Remaining"]} labelFormatter={fmtDate} />
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
