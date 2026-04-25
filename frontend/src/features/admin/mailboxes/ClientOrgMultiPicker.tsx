import { useId, useMemo, useState } from "react";
import { Badge, Button } from "@/components/ds";
import type { ClientOrgOption } from "@/components/workspace/HierarchyBadges";

interface ClientOrgMultiPickerProps {
  clientOrgs: ClientOrgOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  testIdPrefix?: string;
}

function filterClientOrgs(orgs: ClientOrgOption[], query: string): ClientOrgOption[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return orgs;
  return orgs.filter((org) => org.companyName.toLowerCase().includes(trimmed));
}

export function ClientOrgMultiPicker({
  clientOrgs,
  isLoading,
  isError,
  onRetry,
  selectedIds,
  onChange,
  testIdPrefix = "client-org-multi-picker"
}: ClientOrgMultiPickerProps) {
  const [query, setQuery] = useState("");
  const inputId = useId();

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const orgsById = useMemo(() => {
    const map = new Map<string, ClientOrgOption>();
    for (const org of clientOrgs ?? []) {
      map.set(org.id, org);
    }
    return map;
  }, [clientOrgs]);

  const selectedChips = useMemo(() => {
    return selectedIds.map((id) => ({
      id,
      label: orgsById.get(id)?.companyName ?? id,
      orphan: !orgsById.has(id)
    }));
  }, [selectedIds, orgsById]);

  const visibleOptions = useMemo(() => {
    if (!clientOrgs) return [];
    return filterClientOrgs(clientOrgs, query)
      .slice()
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [clientOrgs, query]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((existing) => existing !== id));
      return;
    }
    onChange([...selectedIds, id]);
  };

  const removeChip = (id: string) => {
    onChange(selectedIds.filter((existing) => existing !== id));
  };

  return (
    <div className="mailbox-multi-picker" data-testid={testIdPrefix}>
      <div
        className="mailbox-multi-picker-chips"
        data-testid={`${testIdPrefix}-chips`}
        role="list"
        aria-label="Selected client organizations"
      >
        {selectedChips.length === 0 ? (
          <span
            className="mailbox-multi-picker-empty"
            data-testid={`${testIdPrefix}-chips-empty`}
          >
            No client organizations selected yet.
          </span>
        ) : (
          selectedChips.map((chip) => (
            <span
              key={chip.id}
              role="listitem"
              className="mailbox-multi-picker-chip"
              data-testid={`${testIdPrefix}-chip-${chip.id}`}
              data-orphan={chip.orphan ? "true" : undefined}
            >
              {chip.orphan ? (
                <Badge tone="warning" size="sm">
                  Removed
                </Badge>
              ) : null}
              <span className="mailbox-multi-picker-chip-label">{chip.label}</span>
              <button
                type="button"
                className="mailbox-multi-picker-chip-remove"
                aria-label={`Remove ${chip.label}`}
                data-testid={`${testIdPrefix}-chip-remove-${chip.id}`}
                onClick={() => removeChip(chip.id)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      <div className="mailbox-multi-picker-search">
        <label htmlFor={inputId} className="visually-hidden">
          Search client organizations
        </label>
        <input
          id={inputId}
          type="search"
          autoComplete="off"
          placeholder="Search by company name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid={`${testIdPrefix}-input`}
        />
      </div>

      {isLoading ? (
        <p
          className="mailbox-multi-picker-status"
          role="status"
          data-testid={`${testIdPrefix}-loading`}
        >
          Loading client organizations…
        </p>
      ) : null}

      {isError ? (
        <div
          className="mailbox-multi-picker-status mailbox-multi-picker-status-error"
          role="alert"
          data-testid={`${testIdPrefix}-error`}
        >
          <span>Couldn&apos;t load client organizations.</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      {!isLoading && !isError ? (
        <ul
          className="mailbox-multi-picker-list"
          role="listbox"
          aria-multiselectable="true"
          aria-label="Client organizations"
          data-testid={`${testIdPrefix}-list`}
        >
          {visibleOptions.length === 0 ? (
            <li
              className="mailbox-multi-picker-list-empty"
              data-testid={`${testIdPrefix}-list-empty`}
            >
              {query.trim().length > 0
                ? `No client organizations match "${query}".`
                : "No client organizations exist for this tenant yet."}
            </li>
          ) : (
            visibleOptions.map((org) => {
              const checked = selectedSet.has(org.id);
              return (
                <li
                  key={org.id}
                  role="option"
                  aria-selected={checked}
                  tabIndex={-1}
                  className="mailbox-multi-picker-option"
                  data-testid={`${testIdPrefix}-option-${org.id}`}
                  data-checked={checked ? "true" : undefined}
                  onClick={() => toggle(org.id)}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      toggle(org.id);
                    }
                  }}
                >
                  <span
                    className="mailbox-multi-picker-option-indicator"
                    aria-hidden="true"
                    data-checked={checked ? "true" : undefined}
                    data-testid={`${testIdPrefix}-checkbox-${org.id}`}
                  />
                  <span className="mailbox-multi-picker-option-label">
                    {org.companyName}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
