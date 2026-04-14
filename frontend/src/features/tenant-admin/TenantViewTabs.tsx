import type { TenantViewTab } from "@/types";

interface TenantViewTabsProps {
  activeTab: TenantViewTab;
  canViewTenantConfig: boolean;
  canViewConnections: boolean;
  onTabChange: (tab: TenantViewTab) => void;
}

export function TenantViewTabs({ activeTab, canViewTenantConfig, canViewConnections, onTabChange }: TenantViewTabsProps) {
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
      {canViewConnections ? (
        <button
          type="button"
          className={activeTab === "statements" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
          onClick={() => onTabChange("statements")}
        >
          Statements
        </button>
      ) : null}
      {canViewTenantConfig ? (
        <button
          type="button"
          className={activeTab === "config" ? "tenant-view-tab tenant-view-tab-active" : "tenant-view-tab"}
          onClick={() => onTabChange("config")}
        >
          Tenant Config
        </button>
      ) : null}
      {canViewConnections ? (
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
