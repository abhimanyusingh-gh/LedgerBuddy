interface TenantViewTabsProps {
  showTenantConfig: boolean;
  canViewTenantConfig: boolean;
  onShowDashboard: () => void;
  onShowTenantConfig: () => void;
}

export function TenantViewTabs({
  showTenantConfig,
  canViewTenantConfig,
  onShowDashboard,
  onShowTenantConfig
}: TenantViewTabsProps) {
  if (!canViewTenantConfig) {
    return null;
  }

  return (
    <div className="tenant-view-tabs" role="tablist" aria-label="Tenant workspace sections">
      <button
        type="button"
        className={showTenantConfig ? "tenant-view-tab" : "tenant-view-tab tenant-view-tab-active"}
        onClick={onShowDashboard}
      >
        Dashboard
      </button>
      <button
        type="button"
        className={showTenantConfig ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
        onClick={onShowTenantConfig}
      >
        Tenant Config
      </button>
    </div>
  );
}
