import { useCallback, useEffect, useState } from "react";

export const ADMIN_CLIENT_ORG_QUERY_PARAM = "clientOrgId";

const ADMIN_CLIENT_ORG_CHANGE_EVENT = "ledgerbuddy:admin-client-org-filter-change";

const OBJECT_ID_REGEX = /^[a-f0-9]{24}$/i;

function readFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const value = params.get(ADMIN_CLIENT_ORG_QUERY_PARAM);
  if (!value || value.length === 0) return null;
  return OBJECT_ID_REGEX.test(value) ? value : null;
}

function writeToUrl(id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id === null) {
    params.delete(ADMIN_CLIENT_ORG_QUERY_PARAM);
  } else {
    params.set(ADMIN_CLIENT_ORG_QUERY_PARAM, id);
  }
  const search = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`
  );
  window.dispatchEvent(new CustomEvent(ADMIN_CLIENT_ORG_CHANGE_EVENT));
}

export interface UseAdminClientOrgFilterResult {
  clientOrgId: string | null;
  setClientOrgId: (id: string | null) => void;
}

export function useAdminClientOrgFilter(): UseAdminClientOrgFilterResult {
  const [clientOrgId, setLocal] = useState<string | null>(() => readFromUrl());

  useEffect(() => {
    const sync = () => setLocal(readFromUrl());
    window.addEventListener(ADMIN_CLIENT_ORG_CHANGE_EVENT, sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener(ADMIN_CLIENT_ORG_CHANGE_EVENT, sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const setClientOrgId = useCallback((id: string | null) => {
    writeToUrl(id);
    setLocal(id);
  }, []);

  return { clientOrgId, setClientOrgId };
}
