import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPlatformTenantUsage, onboardTenantAdmin, setTenantEnabled } from "../api";
import type { WorkspaceGuard, WorkspaceSessionContext } from "./useTenantWorkspaceSession";
import type { PlatformTenantUsageSummary } from "../api";

interface UseTenantWorkspacePlatformOptions {
  session: WorkspaceSessionContext | null;
  guarded: WorkspaceGuard;
}

export function useTenantWorkspacePlatform({ session, guarded }: UseTenantWorkspacePlatformOptions) {
  const [platformUsage, setPlatformUsage] = useState<PlatformTenantUsageSummary[]>([]);
  const [selectedPlatformTenantId, setSelectedPlatformTenantId] = useState<string | null>(null);
  const [platformOnboardCollapsed, setPlatformOnboardCollapsed] = useState(false);
  const [platformUsageCollapsed, setPlatformUsageCollapsed] = useState(false);
  const [platformActivityCollapsed, setPlatformActivityCollapsed] = useState(false);
  const [platformOnboardForm, setPlatformOnboardForm] = useState({ tenantName: "", adminEmail: "", adminDisplayName: "", mode: "test" as string });
  const [platformOnboardResult, setPlatformOnboardResult] = useState<{ tempPassword: string; adminEmail: string } | null>(null);

  const loadPlatformUsage = useCallback(async () => {
    if (!session?.user.isPlatformAdmin) return;
    await guarded(async () => {
      setPlatformUsage(await fetchPlatformTenantUsage());
    }, "Failed to load tenant usage overview.");
  }, [guarded, session?.user.isPlatformAdmin]);

  useEffect(() => {
    if (!session?.user.isPlatformAdmin) {
      setPlatformUsage([]);
      setSelectedPlatformTenantId(null);
      return;
    }
    void loadPlatformUsage();
  }, [loadPlatformUsage, session?.user.isPlatformAdmin]);

  useEffect(() => {
    if (platformUsage.length === 0) {
      setSelectedPlatformTenantId(null);
      return;
    }
    setSelectedPlatformTenantId((current) =>
      current && platformUsage.some((entry) => entry.tenantId === current) ? current : platformUsage[0].tenantId
    );
  }, [platformUsage]);

  const platformStats = useMemo(
    () => ({
      tenants: platformUsage.length,
      users: platformUsage.reduce((sum, entry) => sum + entry.userCount, 0),
      totalDocuments: platformUsage.reduce((sum, entry) => sum + entry.totalDocuments, 0),
      approvedDocuments: platformUsage.reduce((sum, entry) => sum + entry.approvedDocuments, 0),
      exportedDocuments: platformUsage.reduce((sum, entry) => sum + entry.exportedDocuments, 0),
      failedDocuments: platformUsage.reduce((sum, entry) => sum + entry.failedDocuments, 0)
    }),
    [platformUsage]
  );

  const selectedPlatformTenant = useMemo(
    () => platformUsage.find((entry) => entry.tenantId === selectedPlatformTenantId) ?? null,
    [platformUsage, selectedPlatformTenantId]
  );

  const handlePlatformOnboardTenantAdmin = useCallback(async () => {
    const tenantName = platformOnboardForm.tenantName.trim();
    const adminEmail = platformOnboardForm.adminEmail.trim().toLowerCase();
    const adminDisplayName = platformOnboardForm.adminDisplayName.trim();
    if (!tenantName || !adminEmail) {
      return;
    }

    await guarded(async () => {
      const result = await onboardTenantAdmin({
        tenantName,
        adminEmail,
        ...(adminDisplayName ? { adminDisplayName } : {}),
        mode: platformOnboardForm.mode
      });
      setPlatformOnboardForm({ tenantName: "", adminEmail: "", adminDisplayName: "", mode: "test" });
      if (result.tempPassword) setPlatformOnboardResult({ tempPassword: result.tempPassword, adminEmail: result.adminEmail });
      await loadPlatformUsage();
      setPlatformUsageCollapsed(false);
    }, "Failed to onboard tenant admin.");
  }, [guarded, loadPlatformUsage, platformOnboardForm]);

  const handleToggleTenantEnabled = useCallback(async (tenantId: string, enabled: boolean) => {
    await guarded(async () => {
      await setTenantEnabled(tenantId, enabled);
      await loadPlatformUsage();
    }, "Failed to update tenant status.");
  }, [guarded, loadPlatformUsage]);

  return {
    platformUsage,
    setPlatformUsage,
    selectedPlatformTenantId,
    setSelectedPlatformTenantId,
    platformOnboardCollapsed,
    setPlatformOnboardCollapsed,
    platformUsageCollapsed,
    setPlatformUsageCollapsed,
    platformActivityCollapsed,
    setPlatformActivityCollapsed,
    platformOnboardForm,
    setPlatformOnboardForm,
    platformOnboardResult,
    setPlatformOnboardResult,
    platformStats,
    selectedPlatformTenant,
    loadPlatformUsage,
    handlePlatformOnboardTenantAdmin,
    handleToggleTenantEnabled
  };
}
