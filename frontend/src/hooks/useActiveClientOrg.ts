import { useCallback, useEffect, useState } from "react";

export const ACTIVE_CLIENT_ORG_QUERY_PARAM = "clientOrgId";
export const ACTIVE_CLIENT_ORG_STORAGE_KEY = "activeClientOrgId";

const ACTIVE_CLIENT_ORG_CHANGE_EVENT = "ledgerbuddy:active-client-org-change";

function readActiveClientOrgIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(ACTIVE_CLIENT_ORG_QUERY_PARAM);
  return value && value.length > 0 ? value : null;
}

// Persistence backed by sessionStorage (per-tab) instead of localStorage so a
// CA can open Client A in one tab and Client B in another without realm
// cross-contamination — closing the tab forgets the active realm and a new
// tab starts fresh.
function readActiveClientOrgIdFromStorage(): string | null {
  const value = window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY);
  return value && value.length > 0 ? value : null;
}

export function readActiveClientOrgId(): string | null {
  return readActiveClientOrgIdFromUrl() ?? readActiveClientOrgIdFromStorage();
}

function writeActiveClientOrgIdToUrl(id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id === null) {
    params.delete(ACTIVE_CLIENT_ORG_QUERY_PARAM);
  } else {
    params.set(ACTIVE_CLIENT_ORG_QUERY_PARAM, id);
  }
  const search = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
  );
}

function writeActiveClientOrgIdToStorage(id: string | null) {
  if (id === null) {
    window.sessionStorage.removeItem(ACTIVE_CLIENT_ORG_STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(ACTIVE_CLIENT_ORG_STORAGE_KEY, id);
  }
}

export function setActiveClientOrgId(id: string | null) {
  writeActiveClientOrgIdToUrl(id);
  writeActiveClientOrgIdToStorage(id);
  window.dispatchEvent(new CustomEvent(ACTIVE_CLIENT_ORG_CHANGE_EVENT));
}

export interface UseActiveClientOrgResult {
  activeClientOrgId: string | null;
  setActiveClientOrg: (id: string | null) => void;
}

export function useActiveClientOrg(): UseActiveClientOrgResult {
  const [activeClientOrgId, setLocalState] = useState<string | null>(() => readActiveClientOrgId());

  useEffect(() => {
    // sessionStorage is per-tab and does not fire the cross-tab `storage`
    // event, so we only listen for in-tab signals.
    const sync = () => setLocalState(readActiveClientOrgId());
    window.addEventListener(ACTIVE_CLIENT_ORG_CHANGE_EVENT, sync);
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener(ACTIVE_CLIENT_ORG_CHANGE_EVENT, sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  const setActiveClientOrg = useCallback((id: string | null) => {
    setActiveClientOrgId(id);
    setLocalState(id);
  }, []);

  return { activeClientOrgId, setActiveClientOrg };
}
