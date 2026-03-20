export type TenantViewTab = "overview" | "dashboard" | "config" | "exports" | "connections";

interface TenantViewTabsProps {
  activeTab: TenantViewTab;
  canViewTenantConfig: boolean;
  onTabChange: (tab: TenantViewTab) => void;
}

export function TenantViewTabs({ activeTab, canViewTenantConfig, onTabChange }: TenantViewTabsProps) {
  return (
    <div className="tenant-view-tabs" role="tablist" aria-label="Tenant workspace sections">
      <button
        type="button"
        className={activeTab === "overview" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
        onClick={() => onTabChange("overview")}
      >
        Overview
      </button>
      <button
        type="button"
        className={activeTab === "dashboard" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
        onClick={() => onTabChange("dashboard")}
      >
        Invoices
      </button>
      <button
        type="button"
        className={activeTab === "exports" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
        onClick={() => onTabChange("exports")}
      >
        Exports
      </button>
      {canViewTenantConfig ? (
        <button
          type="button"
          className={activeTab === "config" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
          onClick={() => onTabChange("config")}
        >
          Tenant Config
        </button>
      ) : null}
      {canViewTenantConfig ? (
        <button
          type="button"
          className={activeTab === "connections" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
          onClick={() => onTabChange("connections")}
        >
          Connections
        </button>
      ) : null}
    </div>
  );
}
