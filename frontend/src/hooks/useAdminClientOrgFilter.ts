import { useCallback, useEffect } from "react";
import {
  useAdminRealmStore,
  syncAdminRealmFromUrl,
  readAdminRealmFromUrl
} from "@/stores/adminRealmStore";

export { ADMIN_CLIENT_ORG_QUERY_PARAM } from "@/stores/adminRealmStore";

interface UseAdminClientOrgFilterResult {
  clientOrgId: string | null;
  setClientOrgId: (id: string | null) => void;
}

export function useAdminClientOrgFilter(): UseAdminClientOrgFilterResult {
  useAdminRealmStore((s) => s.id);
  const setAdminRealm = useAdminRealmStore((s) => s.setAdminRealm);
  const clientOrgId = readAdminRealmFromUrl();
  useEffect(() => { syncAdminRealmFromUrl(); }, []);
  const setClientOrgId = useCallback((id: string | null) => setAdminRealm(id), [setAdminRealm]);
  return { clientOrgId, setClientOrgId };
}
