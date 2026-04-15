import { TenantComplianceConfigModel, type TenantComplianceConfigFields } from "@/models/integration/TenantComplianceConfig.js";
import type { UUID } from "@/types/uuid.js";

export async function resolveTenantComplianceConfig(
  tenantId: UUID
): Promise<TenantComplianceConfigFields | null> {
  const doc = await TenantComplianceConfigModel.findOne({ tenantId }).lean();
  if (!doc) return null;
  return doc as unknown as TenantComplianceConfigFields;
}
