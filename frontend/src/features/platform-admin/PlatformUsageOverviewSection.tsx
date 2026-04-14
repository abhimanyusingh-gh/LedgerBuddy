import type { PlatformTenantUsageSummary } from "@/api";
import { PlatformSection } from "@/features/platform-admin/PlatformSection";

interface PlatformUsageOverviewSectionProps {
  usage: PlatformTenantUsageSummary[];
  selectedTenantId: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onSelectTenant: (tenantId: string) => void;
  onToggleEnabled: (tenantId: string, enabled: boolean) => void;
}

export function PlatformUsageOverviewSection({
  usage,
  selectedTenantId,
  collapsed,
  onToggle,
  onRefresh,
  onSelectTenant,
  onToggleEnabled
}: PlatformUsageOverviewSectionProps) {
  return (
    <PlatformSection
      title="Platform Tenant Usage Overview"
      icon="table_chart"
      collapsed={collapsed}
      onToggle={onToggle}
      actions={
        <button type="button" className="app-button app-button-secondary" onClick={onRefresh}>
          Refresh Usage
        </button>
      }
    >
      <div className="platform-table-wrap">
        <table data-testid="platform-usage-table" className="platform-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Tenant</th>
              <th>Admin Email</th>
              <th>Onboarding</th>
              <th>Users</th>
              <th>Documents</th>
              <th>Approved</th>
              <th>Exported</th>
              <th>Needs Review</th>
              <th>Failed</th>
              <th>OCR Tokens</th>
              <th>SLM Tokens</th>
              <th>Gmail</th>
              <th className="align-right">Last Ingested</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((entry) => (
              <tr
                key={entry.tenantId}
                className={entry.tenantId === selectedTenantId ? "platform-table-row-active" : ""}
                onClick={() => onSelectTenant(entry.tenantId)}
              >
                <td>
                  <button
                    type="button"
                    className={`app-button ${entry.enabled ? "app-button-secondary" : "app-button-danger"}`}
                    style={{ fontSize: 12, padding: "2px 10px", minWidth: 72 }}
                    onClick={(e) => { e.stopPropagation(); onToggleEnabled(entry.tenantId, !entry.enabled); }}
                  >
                    {entry.enabled ? "Active" : "Disabled"}
                  </button>
                </td>
                <td className="tenant-name-cell">{entry.tenantName}</td>
                <td>{entry.adminEmail ?? "-"}</td>
                <td>{entry.onboardingStatus}</td>
                <td>{entry.userCount}</td>
                <td>{entry.totalDocuments}</td>
                <td>{entry.approvedDocuments}</td>
                <td>{entry.exportedDocuments}</td>
                <td>{entry.needsReviewDocuments}</td>
                <td className="platform-failed-cell">{entry.failedDocuments}</td>
                <td>{entry.ocrTokensTotal.toLocaleString()}</td>
                <td>{entry.slmTokensTotal.toLocaleString()}</td>
                <td>{entry.gmailConnectionState}</td>
                <td className="align-right">{entry.lastIngestedAt ? new Date(entry.lastIngestedAt).toLocaleString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">This view is usage-only. Invoice content is not exposed at platform scope.</p>
    </PlatformSection>
  );
}
