import { useCallback, useEffect, useState } from "react";
import { ACTIVE_CLIENT_ORG_CHANGE_EVENT } from "@/hooks/useActiveClientOrg";

export const ADMIN_CLIENT_ORG_QUERY_PARAM = "clientOrgId";

export const ADMIN_CLIENT_ORG_CHANGE_EVENT = "ledgerbuddy:admin-client-org-filter-change";

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
  // Notify both layers — admin/app-shell intentionally share the URL key (#162). Single dispatch leaves the other layer stale until popstate. Will be replaced by store subscriptions when #173 lands.
  window.dispatchEvent(new CustomEvent(ADMIN_CLIENT_ORG_CHANGE_EVENT));
  window.dispatchEvent(new CustomEvent(ACTIVE_CLIENT_ORG_CHANGE_EVENT));
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
