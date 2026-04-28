import { useEffect, useMemo } from "react";
import { useActiveClientOrg } from "@/hooks/useActiveClientOrg";

export interface ClientOrgOption {
  id: string;
  companyName: string;
}

interface TenantBadgeProps {
  tenantName: string;
}

export function TenantBadge({ tenantName }: TenantBadgeProps) {
  const label = tenantName.trim().length > 0 ? tenantName : "Unknown tenant";
  return (
    <span
      className="workspace-hierarchy-badge workspace-hierarchy-badge-tenant"
      data-testid="tenant-badge"
      title={`CA firm: ${label}`}
      aria-label={`Tenant ${label}`}
    >
      <span className="material-symbols-outlined workspace-hierarchy-badge-icon" aria-hidden="true">
        domain
      </span>
      {label}
    </span>
  );
}

interface ActiveRealmBadgeProps {
  clientOrgs?: ClientOrgOption[];
  onOpenSwitcher?: () => void;
}

export function ActiveRealmBadge({ clientOrgs, onOpenSwitcher }: ActiveRealmBadgeProps) {
  const { activeClientOrgId, setActiveClientOrg } = useActiveClientOrg();

  const activeName = useMemo(() => {
    if (!activeClientOrgId || !clientOrgs) return null;
    const match = clientOrgs.find((org) => org.id === activeClientOrgId);
    return match?.companyName ?? null;
  }, [activeClientOrgId, clientOrgs]);

  useEffect(() => {
    if (activeClientOrgId === null) return;
    if (!clientOrgs) return;
    const stillExists = clientOrgs.some((org) => org.id === activeClientOrgId);
    if (!stillExists) {
      setActiveClientOrg(null);
    }
  }, [activeClientOrgId, clientOrgs, setActiveClientOrg]);

  if (activeClientOrgId === null) {
    const switcherReady = typeof onOpenSwitcher === "function";
    return (
      <button
        type="button"
        className="workspace-hierarchy-badge workspace-hierarchy-badge-realm-empty"
        onClick={switcherReady ? onOpenSwitcher : undefined}
        disabled={!switcherReady}
        aria-disabled={!switcherReady}
        title={switcherReady ? undefined : "Realm switcher coming soon"}
        data-testid="select-client-cta"
        aria-label="Select a client"
      >
        <span className="material-symbols-outlined workspace-hierarchy-badge-icon" aria-hidden="true">
          add_business
        </span>
        Select a client
      </button>
    );
  }

  const isLoading = clientOrgs === undefined;
  const label = isLoading ? "Loading…" : activeName ?? activeClientOrgId;
  const switcherReady = typeof onOpenSwitcher === "function";

  if (switcherReady) {
    return (
      <button
        type="button"
        className="workspace-hierarchy-badge workspace-hierarchy-badge-realm workspace-hierarchy-badge-realm-trigger"
        data-testid="active-realm-badge"
        data-loading={isLoading ? "true" : undefined}
        title={`Active client: ${label} — click to switch`}
        aria-label={`Active client ${label}, open switcher`}
        aria-haspopup="listbox"
        onClick={onOpenSwitcher}
      >
        <span className="material-symbols-outlined workspace-hierarchy-badge-icon" aria-hidden="true">
          business_center
        </span>
        {label}
        <span className="material-symbols-outlined workspace-hierarchy-badge-icon" aria-hidden="true">
          expand_more
        </span>
      </button>
    );
  }

  return (
    <span
      className="workspace-hierarchy-badge workspace-hierarchy-badge-realm"
      data-testid="active-realm-badge"
      data-loading={isLoading ? "true" : undefined}
      title={`Active client: ${label}`}
      aria-label={`Active client ${label}`}
    >
      <span className="material-symbols-outlined workspace-hierarchy-badge-icon" aria-hidden="true">
        business_center
      </span>
      {label}
    </span>
  );
}
