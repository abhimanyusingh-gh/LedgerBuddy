import { useCallback, useMemo, useState } from "react";
import { ClientOrgPicker } from "@/features/triage/ClientOrgPicker";
import { useTenantClientOrgs } from "@/hooks/useTenantClientOrgs";
import { useAdminClientOrgFilter } from "@/hooks/useAdminClientOrgFilter";
import type { ClientOrgOption } from "@/components/workspace/HierarchyBadges";

const ALL_CLIENTS_LABEL = "All clients";

export function AdminRealmSwitcher() {
  const { clientOrgId, setClientOrgId } = useAdminClientOrgFilter();
  const { clientOrgs, isLoading, isError, refetch } = useTenantClientOrgs();
  const [open, setOpen] = useState(false);

  const closePicker = useCallback(() => setOpen(false), []);
  const openPicker = useCallback(() => setOpen(true), []);

  const activeRealmName = useMemo(() => {
    if (clientOrgId === null) return null;
    return clientOrgs?.find((org) => org.id === clientOrgId)?.companyName ?? null;
  }, [clientOrgId, clientOrgs]);

  function handleSelect(option: ClientOrgOption) {
    setClientOrgId(option.id);
    closePicker();
  }

  function handleSelectAll() {
    setClientOrgId(null);
  }

  const isAllSelected = clientOrgId === null;
  const specificTriggerLabel = activeRealmName ?? "Pick a client...";

  return (
    <div
      className="ds-segmented-group"
      data-testid="admin-realm-switcher"
      role="group"
      aria-label="Analytics scope"
    >
      <button
        type="button"
        className="ds-pill"
        data-active={isAllSelected ? "true" : undefined}
        aria-pressed={isAllSelected}
        data-testid="admin-realm-switcher-segment-all"
        onClick={handleSelectAll}
      >
        {ALL_CLIENTS_LABEL}
      </button>
      <button
        type="button"
        className="ds-pill"
        data-active={!isAllSelected ? "true" : undefined}
        aria-pressed={!isAllSelected}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="admin-realm-switcher-segment-picker"
        onClick={openPicker}
      >
        <span className="material-symbols-outlined" aria-hidden="true">filter_alt</span>
        <span>{specificTriggerLabel}</span>
      </button>

      <ClientOrgPicker
        open={open}
        onClose={closePicker}
        onSelect={handleSelect}
        clientOrgs={clientOrgs}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => { void refetch(); }}
        activeClientOrgId={clientOrgId}
        title="Choose a client"
        placeholder="Search by company name..."
        testIdPrefix="admin-realm-switcher-picker"
      />
    </div>
  );
}
