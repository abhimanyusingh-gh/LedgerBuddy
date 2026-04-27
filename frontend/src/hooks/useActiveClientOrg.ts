import { useCallback } from "react";
import {
  useActiveRealmStore,
  setActiveRealm,
  readActiveRealmId
} from "@/stores/activeRealmStore";

export {
  ACTIVE_CLIENT_ORG_QUERY_PARAM,
  ACTIVE_CLIENT_ORG_STORAGE_KEY,
  ACTIVE_CLIENT_ORG_CHANGE_EVENT
} from "@/stores/activeRealmStore";

export function readActiveClientOrgId(): string | null {
  return readActiveRealmId();
}

export function setActiveClientOrgId(id: string | null): void {
  setActiveRealm(id);
}

interface UseActiveClientOrgResult {
  activeClientOrgId: string | null;
  setActiveClientOrg: (id: string | null) => void;
}

export function useActiveClientOrg(): UseActiveClientOrgResult {
  const storeId = useActiveRealmStore((s) => s.id);
  const activeClientOrgId = readActiveRealmId() ?? storeId;
  const setActiveClientOrg = useCallback((id: string | null) => {
    setActiveRealm(id);
  }, []);
  return { activeClientOrgId, setActiveClientOrg };
}
