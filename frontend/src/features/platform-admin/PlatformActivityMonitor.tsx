import type { PlatformTenantUsageSummary } from "@/api";
import { PlatformSection } from "@/features/platform-admin/PlatformSection";

interface PlatformActivityMonitorProps {
  selectedTenant: PlatformTenantUsageSummary | null;
  collapsed: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}

export function PlatformActivityMonitor({
  selectedTenant,
  collapsed,
  onToggle,
  onRefresh
}: PlatformActivityMonitorProps) {
  return (
    <PlatformSection
      title="Activity Monitor"
      icon="monitoring"
      collapsed={collapsed}
      onToggle={onToggle}
      className="platform-activity-section"
      actions={
        <button type="button" className="app-button app-button-secondary" onClick={onRefresh}>
          Refresh
        </button>
      }
    >
      {selectedTenant ? (
        <div className="platform-activity-content">
          <p className="muted" data-testid="platform-activity-tenant">
            Selected tenant: <strong>{selectedTenant.tenantName}</strong>
          </p>
          <div className="platform-stats-grid">
            <article className="platform-stat-tile">
              <h4>Onboarding</h4>
              <p>{selectedTenant.onboardingStatus}</p>
            </article>
            <article className="platform-stat-tile">
              <h4>Users</h4>
              <p>{selectedTenant.userCount}</p>
            </article>
            <article className="platform-stat-tile">
              <h4>Documents</h4>
              <p>{selectedTenant.totalDocuments}</p>
            </article>
            <article className="platform-stat-tile">
              <h4>Approved</h4>
              <p>{selectedTenant.approvedDocuments}</p>
            </article>
            <article className="platform-stat-tile">
              <h4>Exported</h4>
              <p>{selectedTenant.exportedDocuments}</p>
            </article>
            <article className="platform-stat-tile">
              <h4>Failed</h4>
              <p className="platform-stat-value-alert">{selectedTenant.failedDocuments}</p>
            </article>
          </div>
          <div className="detail-grid">
            <p>
              <span>Gmail Connection</span>
              <strong>{selectedTenant.gmailConnectionState}</strong>
            </p>
            <p>
              <span>Last Ingested</span>
              <strong>{selectedTenant.lastIngestedAt ? new Date(selectedTenant.lastIngestedAt).toLocaleString() : "-"}</strong>
            </p>
          </div>
        </div>
      ) : (
        <div className="platform-activity-empty">
          <div className="platform-empty-icon">
            <span className="material-symbols-outlined">visibility_off</span>
          </div>
          <h4>No Tenant Selected</h4>
          <p>Select a tenant from the table above to view detailed platform activity for that tenant.</p>
        </div>
      )}
    </PlatformSection>
  );
}
