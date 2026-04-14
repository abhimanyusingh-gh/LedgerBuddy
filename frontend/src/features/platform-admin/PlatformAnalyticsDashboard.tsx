import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import type { PlatformTenantUsageSummary } from "@/api";

interface PlatformAnalyticsDashboardProps {
  usage: PlatformTenantUsageSummary[];
}

const STATUS_COLORS: Record<string, string> = {
  Approved: "var(--status-approved)",
  Exported: "var(--status-exported)",
  Parsed: "var(--status-parsed)",
  "Needs Review": "var(--status-needs-review)",
  Failed: "var(--status-failed-ocr)",
  Pending: "var(--status-pending)"
};

const TENANT_COLORS = ["var(--chart-blue)", "var(--chart-emerald)", "var(--chart-amber)", "var(--chart-rose)", "var(--chart-violet)", "var(--chart-cyan)", "#6366f1", "#a855f7"];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function PlatformAnalyticsDashboard({ usage }: PlatformAnalyticsDashboardProps) {
  if (usage.length === 0) return null;

  const totals = usage.reduce(
    (acc, t) => ({
      documents: acc.documents + t.totalDocuments,
      approved: acc.approved + t.approvedDocuments,
      exported: acc.exported + t.exportedDocuments,
      needsReview: acc.needsReview + t.needsReviewDocuments,
      failed: acc.failed + t.failedDocuments,
      ocrTokens: acc.ocrTokens + t.ocrTokensTotal,
      slmTokens: acc.slmTokens + t.slmTokensTotal,
      users: acc.users + t.userCount
    }),
    { documents: 0, approved: 0, exported: 0, needsReview: 0, failed: 0, ocrTokens: 0, slmTokens: 0, users: 0 }
  );

  const statusBreakdown = [
    { status: "Approved", count: totals.approved },
    { status: "Exported", count: totals.exported },
    { status: "Needs Review", count: totals.needsReview },
    { status: "Failed", count: totals.failed }
  ].filter((s) => s.count > 0);

  const tenantDocs = usage
    .map((t) => ({ name: t.tenantName, total: t.totalDocuments, approved: t.approvedDocuments, exported: t.exportedDocuments, failed: t.failedDocuments }))
    .sort((a, b) => b.total - a.total);

  const tokenData = usage
    .filter((t) => t.ocrTokensTotal > 0 || t.slmTokensTotal > 0)
    .map((t) => ({ name: t.tenantName, ocr: t.ocrTokensTotal, slm: t.slmTokensTotal }))
    .sort((a, b) => (b.ocr + b.slm) - (a.ocr + a.slm));

  return (
    <div className="platform-analytics">
      <div className="platform-stats-grid">
        <div className="platform-stat-tile" style={{ borderTop: "3px solid var(--accent)" }}>
          <span className="platform-stat-label">Total Documents</span>
          <span className="platform-stat-value">{totals.documents.toLocaleString()}</span>
        </div>
        <div className="platform-stat-tile">
          <span className="platform-stat-label">Approved</span>
          <span className="platform-stat-value">{totals.approved.toLocaleString()}</span>
        </div>
        <div className="platform-stat-tile">
          <span className="platform-stat-label">Exported</span>
          <span className="platform-stat-value">{totals.exported.toLocaleString()}</span>
        </div>
        <div className="platform-stat-tile">
          <span className="platform-stat-label">Users</span>
          <span className="platform-stat-value">{totals.users}</span>
        </div>
        {totals.failed > 0 ? (
          <div className="platform-stat-tile" style={{ borderTop: "3px solid var(--warn)" }}>
            <span className="platform-stat-label">Failed</span>
            <span className="platform-stat-value platform-stat-value-alert">{totals.failed}</span>
          </div>
        ) : null}
      </div>

      <div className="overview-charts-grid">
        <div className="overview-chart-card">
          <h4>Documents by Tenant</h4>
          {tenantDocs.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tenantDocs} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtNum} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="approved" stackId="docs" fill="var(--status-approved)" radius={0} />
                <Bar dataKey="exported" stackId="docs" fill="var(--status-exported)" radius={0} />
                <Bar dataKey="failed" stackId="docs" fill="var(--status-failed-ocr)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : null}
        </div>

        <div className="overview-chart-card" style={{ position: "relative" }}>
          <h4>Status Distribution</h4>
          {statusBreakdown.length > 0 ? (
            <>
              <div style={{ position: "relative" }}>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={statusBreakdown} dataKey="count" nameKey="status" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} animationDuration={800}>
                      {statusBreakdown.map((entry) => (
                        <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center-label">
                  <strong>{totals.documents}</strong>
                  <span>Total</span>
                </div>
              </div>
              <div className="donut-legend">
                {statusBreakdown.map((entry) => (
                  <div key={entry.status} className="donut-legend-item">
                    <span className="donut-legend-dot" style={{ background: STATUS_COLORS[entry.status] ?? "#94a3b8" }} />
                    <span>{entry.status}</span>
                    <span className="donut-legend-count">{entry.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {tokenData.length > 0 ? (
        <div className="overview-charts-grid" style={{ gridTemplateColumns: "1fr" }}>
          <div className="overview-chart-card">
            <h4>Token Usage by Tenant</h4>
            <ResponsiveContainer width="100%" height={Math.max(160, tokenData.length * 40)}>
              <BarChart data={tokenData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={fmtNum} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="ocr" name="OCR Tokens" fill="var(--chart-blue)" radius={0} />
                <Bar dataKey="slm" name="SLM Tokens" fill="var(--chart-violet)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
