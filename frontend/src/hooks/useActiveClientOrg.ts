import { useCallback } from "react";
import {
  useActiveRealmStore,
  setActiveRealm,
  readActiveRealmId
} from "@/stores/activeRealmStore";

export {
  ACTIVE_CLIENT_ORG_QUERY_PARAM,
  ACTIVE_CLIENT_ORG_STORAGE_KEY
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
  // Subscribe so the component re-renders on store changes; the value itself comes from the URL-aware reader.
  useActiveRealmStore((s) => s.id);
  const activeClientOrgId = readActiveRealmId();
  const setActiveClientOrg = useCallback((id: string | null) => {
    setActiveRealm(id);
  }, []);
  return { activeClientOrgId, setActiveClientOrg };
}
