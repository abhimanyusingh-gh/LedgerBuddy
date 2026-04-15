import { TenantComplianceConfigModel, type TenantComplianceConfigFields } from "@/models/integration/TenantComplianceConfig.js";
import type { UUID } from "@/types/uuid.js";

export async function resolveTenantComplianceConfig(
  tenantId: UUID
): Promise<TenantComplianceConfigFields | null> {
  const doc = await TenantComplianceConfigModel.findOne({ tenantId }).lean();
  if (!doc) return null;
  return doc as unknown as TenantComplianceConfigFields;
}

interface FreemailConfig {
  additionalFreemailDomains?: string[];
}

export async function resolveFreemailConfig(
  tenantId: string
): Promise<FreemailConfig | null> {
  const doc = await TenantComplianceConfigModel.findOne({ tenantId })
    .select({ additionalFreemailDomains: 1 })
    .lean();
  if (!doc) return null;
  return doc as unknown as FreemailConfig;
}

interface LearningModeConfig {
  learningMode?: "active" | "assistive";
}

export async function resolveLearningModeConfig(
  tenantId: string
): Promise<LearningModeConfig | null> {
  const doc = await TenantComplianceConfigModel.findOne({ tenantId })
    .select({ learningMode: 1 })
    .lean();
  if (!doc) return null;
  return doc as unknown as LearningModeConfig;
}

interface DefaultCurrencyConfig {
  defaultCurrency?: string;
}

export async function resolveDefaultCurrencyConfig(
  tenantId: string
): Promise<DefaultCurrencyConfig | null> {
  const doc = await TenantComplianceConfigModel.findOne({ tenantId })
    .select({ defaultCurrency: 1 })
    .lean();
  if (!doc) return null;
  return doc as unknown as DefaultCurrencyConfig;
}

interface TdsRatesConfig {
  tdsRates?: TenantComplianceConfigFields["tdsRates"];
}

export async function resolveTdsRatesConfig(
  tenantId: string
): Promise<TdsRatesConfig | null> {
  const doc = await TenantComplianceConfigModel.findOne({ tenantId })
    .select({ tdsRates: 1 })
    .lean();
  if (!doc) return null;
  return doc as unknown as TdsRatesConfig;
}

interface ApprovalLimitConfig {
  approvalLimitOverrides?: Record<string, number>;
}

export async function resolveApprovalLimitConfig(
  tenantId: string
): Promise<ApprovalLimitConfig | null> {
  const doc = await TenantComplianceConfigModel.findOne({ tenantId })
    .select({ approvalLimitOverrides: 1 })
    .lean();
  if (!doc) return null;
  return doc as unknown as ApprovalLimitConfig;
}
