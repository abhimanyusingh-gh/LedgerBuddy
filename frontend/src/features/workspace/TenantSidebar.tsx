import type { TenantViewTab } from "@/types";
import { Badge } from "@/components/ds/Badge";
import type { StandaloneHashRoute } from "@/features/workspace/tabHashConfig";

export const SIDEBAR_ITEM_ID = {
  Dashboard: "dashboard",
  Inbox: "inbox",
  Triage: "triage",
  Invoices: "invoices",
  Vendors: "vendors",
  Payments: "payments",
  Reconciliation: "reconciliation",
  Exports: "exports",
  Settings: "settings"
} as const;

type SidebarItemId = (typeof SIDEBAR_ITEM_ID)[keyof typeof SIDEBAR_ITEM_ID];

const SIDEBAR_TARGET_KIND = {
  Tab: "tab",
  StandaloneHash: "standalone-hash",
  Placeholder: "placeholder"
} as const;

type SidebarTarget =
  | { kind: typeof SIDEBAR_TARGET_KIND.Tab; tab: TenantViewTab }
  | { kind: typeof SIDEBAR_TARGET_KIND.StandaloneHash; route: StandaloneHashRoute }
  | { kind: typeof SIDEBAR_TARGET_KIND.Placeholder };

interface SidebarItemConfig {
  id: SidebarItemId;
  label: string;
  icon: string;
  target: SidebarTarget;
  requires: "always" | "config" | "connections";
}

const SIDEBAR_ITEMS: readonly SidebarItemConfig[] = [
  { id: SIDEBAR_ITEM_ID.Dashboard, label: "Dashboard", icon: "dashboard", target: { kind: SIDEBAR_TARGET_KIND.Tab, tab: "overview" }, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Inbox, label: "Inbox", icon: "inbox", target: { kind: SIDEBAR_TARGET_KIND.Placeholder }, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Triage, label: "Triage", icon: "inventory_2", target: { kind: SIDEBAR_TARGET_KIND.StandaloneHash, route: "triage" }, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Invoices, label: "Invoices", icon: "receipt_long", target: { kind: SIDEBAR_TARGET_KIND.Tab, tab: "dashboard" }, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Vendors, label: "Vendors", icon: "store", target: { kind: SIDEBAR_TARGET_KIND.Placeholder }, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Payments, label: "Payments", icon: "payments", target: { kind: SIDEBAR_TARGET_KIND.Placeholder }, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Reconciliation, label: "Reconciliation", icon: "rule", target: { kind: SIDEBAR_TARGET_KIND.Tab, tab: "statements" }, requires: "connections" },
  { id: SIDEBAR_ITEM_ID.Exports, label: "Exports", icon: "upload_file", target: { kind: SIDEBAR_TARGET_KIND.Tab, tab: "exports" }, requires: "always" },
  { id: SIDEBAR_ITEM_ID.Settings, label: "Settings", icon: "settings", target: { kind: SIDEBAR_TARGET_KIND.Tab, tab: "config" }, requires: "config" }
] as const;

interface TenantSidebarProps {
  activeTab: TenantViewTab;
  activeStandaloneRoute: StandaloneHashRoute | null;
  onTabChange: (tab: TenantViewTab) => void;
  onStandaloneRouteChange: (route: StandaloneHashRoute) => void;
  canViewTenantConfig: boolean;
  canViewConnections: boolean;
  invoiceActionRequiredCount?: number;
  triageCount?: number;
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

function isItemActive(
  item: SidebarItemConfig,
  activeTab: TenantViewTab,
  activeStandaloneRoute: StandaloneHashRoute | null
): boolean {
  if (item.target.kind === SIDEBAR_TARGET_KIND.Tab) {
    return activeStandaloneRoute === null && item.target.tab === activeTab;
  }
  if (item.target.kind === SIDEBAR_TARGET_KIND.StandaloneHash) {
    return activeStandaloneRoute === item.target.route;
  }
  return false;
}

export function TenantSidebar({
  activeTab,
  activeStandaloneRoute,
  onTabChange,
  onStandaloneRouteChange,
  canViewTenantConfig,
  canViewConnections,
  invoiceActionRequiredCount = 0,
  triageCount = 0
}: TenantSidebarProps) {
  return (
    <nav className="tenant-sidebar" aria-label="Primary">
      <ul className="tenant-sidebar-list">
        {SIDEBAR_ITEMS.map((item) => {
          const allowed = isItemAllowed(item, canViewTenantConfig, canViewConnections);
          const isPlaceholder = item.target.kind === SIDEBAR_TARGET_KIND.Placeholder;
          const isDisabled = !allowed || isPlaceholder;
          const isActive = !isDisabled && isItemActive(item, activeTab, activeStandaloneRoute);
          const showInvoiceBadge = item.id === SIDEBAR_ITEM_ID.Invoices && invoiceActionRequiredCount > 0;
          const showTriageBadge = item.id === SIDEBAR_ITEM_ID.Triage && triageCount > 0;

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
                  if (isDisabled) return;
                  if (item.target.kind === SIDEBAR_TARGET_KIND.Tab) {
                    onTabChange(item.target.tab);
                  } else if (item.target.kind === SIDEBAR_TARGET_KIND.StandaloneHash) {
                    onStandaloneRouteChange(item.target.route);
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
                {showTriageBadge ? (
                  <Badge tone="warning" size="sm" title={`${triageCount} awaiting triage`}>
                    {triageCount}
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
