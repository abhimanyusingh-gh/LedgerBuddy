import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useActiveClientOrg } from "@/hooks/useActiveClientOrg";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import type { ClientOrgOption } from "@/components/workspace/HierarchyBadges";

interface RealmSwitcherProps {
  open: boolean;
  onClose: () => void;
  clientOrgs: ClientOrgOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onGoToOnboarding?: () => void;
}

function filterClientOrgs(orgs: ClientOrgOption[], query: string): ClientOrgOption[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return orgs;
  return orgs.filter((org) => org.companyName.toLowerCase().includes(trimmed));
}

export function RealmSwitcher({
  open,
  onClose,
  clientOrgs,
  isLoading,
  isError,
  onRetry,
  onGoToOnboarding
}: RealmSwitcherProps) {
  const { activeClientOrgId, setActiveClientOrg } = useActiveClientOrg();
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useModalDismiss({ open, onClose, options: { saveFocusOnOpen: true, lockScroll: false } });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHighlightedIndex(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const filtered = useMemo(
    () => (clientOrgs ? filterClientOrgs(clientOrgs, query) : []),
    [clientOrgs, query]
  );

  useEffect(() => {
    setHighlightedIndex(0);
  }, [filtered]);

  if (!open) return null;

  const isEmpty = !isLoading && !isError && (clientOrgs?.length ?? 0) === 0;
  const hasData = !isLoading && !isError && (clientOrgs?.length ?? 0) > 0;

  function commit(option: ClientOrgOption) {
    setActiveClientOrg(option.id);
    onClose();
  }

  // Escape is intentionally not handled here: dismissal is owned by useModalDismiss
  // (window-bound listener) so overlay/Escape behavior cannot drift between handlers.
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length === 0) return;
      setHighlightedIndex((prev) => (prev + 1) % filtered.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length === 0) return;
      setHighlightedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[highlightedIndex];
      if (option) commit(option);
    }
  }

  const activeDescendant = hasData && filtered[highlightedIndex]
    ? `${listboxId}-option-${filtered[highlightedIndex].id}`
    : undefined;

  return (
    <div
      className="popup-overlay realm-switcher-overlay"
      role="presentation"
      onClick={onClose}
      data-testid="realm-switcher-overlay"
    >
      <section
        className="popup-card realm-switcher-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${listboxId}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popup-header">
          <h2 id={`${listboxId}-title`}>Switch client organization</h2>
          <button type="button" onClick={onClose} aria-label="Close realm switcher">
            Close
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          className="search-input realm-switcher-input"
          placeholder="Search by company name..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search client organizations"
          aria-controls={listboxId}
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
          data-testid="realm-switcher-input"
        />

        {isLoading && (
          <p className="realm-switcher-status" data-testid="realm-switcher-loading">
            Loading clients...
          </p>
        )}

        {isError && (
          <div className="realm-switcher-status realm-switcher-status-error" data-testid="realm-switcher-error">
            <span>Couldn't load your clients.</span>
            <button type="button" className="app-button app-button-secondary" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}

        {isEmpty && (
          <div className="realm-switcher-status" data-testid="realm-switcher-empty">
            <span>No clients yet.</span>
            {onGoToOnboarding ? (
              <button
                type="button"
                className="app-button app-button-secondary"
                onClick={() => {
                  onGoToOnboarding();
                  onClose();
                }}
              >
                Go to Onboarding
              </button>
            ) : null}
          </div>
        )}

        {hasData && filtered.length === 0 && (
          <p className="realm-switcher-status" data-testid="realm-switcher-no-match">
            No clients match "{query}".
          </p>
        )}

        {hasData && filtered.length > 0 && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Client organizations"
            className="realm-switcher-list"
            data-testid="realm-switcher-list"
          >
            {filtered.map((org, idx) => {
              const isActive = org.id === activeClientOrgId;
              const isHighlighted = idx === highlightedIndex;
              const optionId = `${listboxId}-option-${org.id}`;
              return (
                <li
                  key={org.id}
                  id={optionId}
                  role="option"
                  aria-selected={isActive}
                  data-testid={`realm-switcher-option-${org.id}`}
                  data-highlighted={isHighlighted ? "true" : undefined}
                  data-active={isActive ? "true" : undefined}
                  className="realm-switcher-option"
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  onClick={() => commit(org)}
                >
                  <span className="realm-switcher-option-name">{org.companyName}</span>
                  {isActive ? (
                    <span className="realm-switcher-option-check" aria-label="Currently active">
                      ✓
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
