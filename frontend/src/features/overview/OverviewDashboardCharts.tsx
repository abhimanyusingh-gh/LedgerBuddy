import type { ReactNode } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  LineChart,
  Line,
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { DailyStat, VendorStat } from "@/types";
import { collapseVendors, fmtDate, fmtInr, fmtInrShort, VENDOR_COLORS } from "@/features/overview/OverviewDashboardUtils";

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

export function KpiCard({ label, value, sub, accent, warn, icon, trend, sparkData }: KpiCardProps) {
  const tone = accent ? "accent" : warn ? "warn" : undefined;
  return (
    <div className="platform-stat-tile" data-tone={tone}>
      <div className="platform-stat-header">
        {icon ? <span className="material-symbols-outlined platform-stat-icon">{icon}</span> : null}
        <span className="platform-stat-label">{label}</span>
      </div>
      <span className="platform-stat-value lb-num">{value}</span>
      {trend ? <span className={`kpi-trend kpi-trend-${trend.direction}`}>{trend.direction === "up" ? "\u2191" : trend.direction === "down" ? "\u2193" : "\u2014"} {trend.label}</span> : null}
      {sub ? <span className="platform-stat-sub">{sub}</span> : null}
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

export function ChartCard({ title, subtitle, children, relative }: { title: string; subtitle: string; children: ReactNode; relative?: boolean }) {
  return (
    <div className={`overview-chart-card${relative ? " overview-chart-card-relative" : ""}`}>
      <h4>{title}<span className="chart-subtitle">{subtitle}</span></h4>
      {children}
    </div>
  );
}

export function ChartOrEmpty({ hasData, children }: { hasData: boolean; children: ReactNode }) {
  if (!hasData) return <div className="chart-empty-state"><span className="material-symbols-outlined">bar_chart</span><p>No data for this period</p></div>;
  return <>{children}</>;
}

export function TimeSeriesBarChart({ data, dataKey, fill, yWidth = 32, yFormatter }: { data: DailyStat[]; dataKey: string; fill: string; yWidth?: number; yFormatter?: (v: number) => string }) {
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

export function VendorBarChart({ vendors, tooltipLabel }: { vendors: VendorStat[]; tooltipLabel: string }) {
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

export function StatusDonut({ data, total, statusColors, statusLabels }: { data: Array<{ status: string; count: number }>; total: number; statusColors: Record<string, string>; statusLabels: Record<string, string> }) {
  return (
    <div className="status-donut-wrap">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} animationDuration={800}>
            {data.map((entry) => <Cell key={entry.status} fill={statusColors[entry.status] ?? "#94a3b8"} />)}
          </Pie>
          <Tooltip formatter={(v: number, name: string) => [v, statusLabels[name] ?? name]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center-label"><strong>{total}</strong><span>Total</span></div>
    </div>
  );
}
