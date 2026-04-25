import type { ReactNode } from "react";
import type { TenantViewTab } from "@/types";
import { TenantSidebar } from "@/features/workspace/TenantSidebar";
import { UrlMigrationBanner } from "@/features/workspace/UrlMigrationBanner";
import type { HashRouteMigration } from "@/features/workspace/useTabHashRouting";
import type { StandaloneHashRoute } from "@/features/workspace/tabHashConfig";

interface AppShellProps {
  activeTab: TenantViewTab;
  activeStandaloneRoute: StandaloneHashRoute | null;
  onTabChange: (tab: TenantViewTab) => void;
  onStandaloneRouteChange: (route: StandaloneHashRoute) => void;
  canViewTenantConfig: boolean;
  canViewConnections: boolean;
  invoiceActionRequiredCount: number;
  triageCount: number;
  topNav: ReactNode;
  subNav?: ReactNode;
  migration: HashRouteMigration | null;
  children: ReactNode;
}

export function AppShell({
  activeTab,
  activeStandaloneRoute,
  onTabChange,
  onStandaloneRouteChange,
  canViewTenantConfig,
  canViewConnections,
  invoiceActionRequiredCount,
  triageCount,
  topNav,
  subNav,
  migration,
  children
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="app-shell-sidebar" aria-label="Primary navigation">
        <TenantSidebar
          activeTab={activeTab}
          activeStandaloneRoute={activeStandaloneRoute}
          onTabChange={onTabChange}
          onStandaloneRouteChange={onStandaloneRouteChange}
          canViewTenantConfig={canViewTenantConfig}
          canViewConnections={canViewConnections}
          invoiceActionRequiredCount={invoiceActionRequiredCount}
          triageCount={triageCount}
        />
      </aside>
      <div className="app-shell-column">
        {migration ? (
          <UrlMigrationBanner oldPath={migration.oldPath} newPath={migration.newPath} />
        ) : null}
        {topNav}
        {subNav}
        <main className="app-shell-main" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
