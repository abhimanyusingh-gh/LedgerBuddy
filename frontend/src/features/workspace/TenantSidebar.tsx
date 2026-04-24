import type { TenantViewTab } from "@/types";
import { Badge } from "@/components/ds/Badge";

export const SIDEBAR_ITEM_ID = {
  Dashboard: "dashboard",
  Inbox: "inbox",
  Invoices: "invoices",
  Vendors: "vendors",
  Payments: "payments",
  Reconciliation: "reconciliation",
  Exports: "exports",
  Settings: "settings"
} as const;

type SidebarItemId = (typeof SIDEBAR_ITEM_ID)[keyof typeof SIDEBAR_ITEM_ID];

interface SidebarItemConfig {
  id: SidebarItemId;
  label: string;
  icon: string;
  tab: TenantViewTab | null;
  requires: "always" | "config" | "connections";
}

const SIDEBAR_ITEMS: readonly SidebarItemConfig[] = [
  { id: SIDEBAR_ITEM_ID.Dashboard, label: "Dashboard", icon: "dashboard", tab: "overview", requires: "always" },
  { id: SIDEBAR_ITEM_ID.Inbox, label: "Inbox", icon: "inbox", tab: null, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Invoices, label: "Invoices", icon: "receipt_long", tab: "dashboard", requires: "always" },
  { id: SIDEBAR_ITEM_ID.Vendors, label: "Vendors", icon: "store", tab: null, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Payments, label: "Payments", icon: "payments", tab: null, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Reconciliation, label: "Reconciliation", icon: "rule", tab: "statements", requires: "connections" },
  { id: SIDEBAR_ITEM_ID.Exports, label: "Exports", icon: "upload_file", tab: "exports", requires: "always" },
  { id: SIDEBAR_ITEM_ID.Settings, label: "Settings", icon: "settings", tab: "config", requires: "config" }
] as const;

interface TenantSidebarProps {
  activeTab: TenantViewTab;
  onTabChange: (tab: TenantViewTab) => void;
  canViewTenantConfig: boolean;
  canViewConnections: boolean;
  invoiceActionRequiredCount?: number;
}

function isItemAllowed(item: SidebarItemConfig, canViewTenantConfig: boolean, canViewConnections: boolean): boolean {
  if (item.requires === "config") {
    return canViewTenantConfig;
  }
  if (item.requires === "connections") {
    return canViewConnections;
  }
  return true;
}

export function TenantSidebar({
  activeTab,
  onTabChange,
  canViewTenantConfig,
  canViewConnections,
  invoiceActionRequiredCount = 0
}: TenantSidebarProps) {
  return (
    <nav className="tenant-sidebar" aria-label="Primary">
      <ul className="tenant-sidebar-list">
        {SIDEBAR_ITEMS.map((item) => {
          const allowed = isItemAllowed(item, canViewTenantConfig, canViewConnections);
          const isPlaceholder = item.tab === null;
          const isDisabled = !allowed || isPlaceholder;
          const isActive = !isDisabled && item.tab === activeTab;
          const showInvoiceBadge = item.id === SIDEBAR_ITEM_ID.Invoices && invoiceActionRequiredCount > 0;

          return (
            <li key={item.id} className="tenant-sidebar-item">
              <button
                type="button"
                className={isActive ? "tenant-sidebar-link tenant-sidebar-link-active" : "tenant-sidebar-link"}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={isDisabled || undefined}
                disabled={isDisabled && !isPlaceholder}
                tabIndex={isPlaceholder ? -1 : undefined}
                data-item-id={item.id}
                onClick={() => {
                  if (!isDisabled && item.tab !== null) {
                    onTabChange(item.tab);
                  }
                }}
              >
                <span className="material-symbols-outlined tenant-sidebar-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="tenant-sidebar-label">{item.label}</span>
                {showInvoiceBadge ? (
                  <Badge tone="danger" size="sm" title={`${invoiceActionRequiredCount} action required`}>
                    {invoiceActionRequiredCount}
                  </Badge>
                ) : null}
                {isPlaceholder ? (
                  <Badge tone="neutral" size="sm" title="Coming soon">
                    Soon
                  </Badge>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
