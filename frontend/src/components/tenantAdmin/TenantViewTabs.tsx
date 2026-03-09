export type TenantViewTab = "dashboard" | "config" | "exports";

interface TenantViewTabsProps {
  activeTab: TenantViewTab;
  canViewTenantConfig: boolean;
  onTabChange: (tab: TenantViewTab) => void;
}

export function TenantViewTabs({ activeTab, canViewTenantConfig, onTabChange }: TenantViewTabsProps) {
  if (!canViewTenantConfig) {
    return null;
  }

  return (
    <div className="tenant-view-tabs" role="tablist" aria-label="Tenant workspace sections">
      <button
        type="button"
        className={activeTab === "dashboard" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
        onClick={() => onTabChange("dashboard")}
      >
        Dashboard
      </button>
      <button
        type="button"
        className={activeTab === "config" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
        onClick={() => onTabChange("config")}
      >
        Tenant Config
      </button>
      <button
        type="button"
        className={activeTab === "exports" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
        onClick={() => onTabChange("exports")}
      >
        Exports
      </button>
    </div>
  );
}
