import { apiClient } from "@/api/client";

export const TALLY_DETECTED_VERSION = {
  ERP9: "erp9",
  Prime: "prime",
  PrimeServer: "primeServer"
} as const;

export type TallyDetectedVersion = typeof TALLY_DETECTED_VERSION[keyof typeof TALLY_DETECTED_VERSION];

export interface ClientOrganization {
  _id: string;
  tenantId: string;
  gstin: string;
  companyName: string;
  companyGuid?: string;
  stateName?: string;
  f12OverwriteByGuidVerified: boolean;
  detectedVersion: TallyDetectedVersion | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

interface CreateClientOrganizationPayload {
  gstin: string;
  companyName: string;
  stateName?: string;
  companyGuid?: string;
}

interface UpdateClientOrganizationPayload {
  companyName?: string;
  stateName?: string;
  f12OverwriteByGuidVerified?: boolean;
}

export const CLIENT_ORG_DEPENDENT_LABEL = {
  Invoices: "invoices",
  ExportBatches: "exportBatches",
  ApprovalWorkflows: "approvalWorkflows",
  ExtractionLearnings: "extractionLearnings",
  ExtractionMappings: "extractionMappings",
  VendorTemplates: "vendorTemplates",
  Vendors: "vendors",
  VendorGlMappings: "vendorGlMappings",
  GlCodes: "glCodes",
  CostCenters: "costCenters",
  VendorCostCenterMappings: "vendorCostCenterMappings",
  BankAccounts: "bankAccounts",
  BankStatements: "bankStatements",
  BankTransactions: "bankTransactions",
  ComplianceConfigs: "complianceConfigs",
  NotificationConfigs: "notificationConfigs",
  TcsConfigs: "tcsConfigs",
  ExportConfigs: "exportConfigs",
  MailboxAssignments: "mailboxAssignments",
  TdsSectionMappings: "tdsSectionMappings"
} as const;

export type ClientOrgDependentLabel =
  typeof CLIENT_ORG_DEPENDENT_LABEL[keyof typeof CLIENT_ORG_DEPENDENT_LABEL];

export type ClientOrgLinkedCounts = Partial<Record<ClientOrgDependentLabel, number>>;

export const ARCHIVE_RESULT_STATUS = {
  Archived: "archived",
  Deleted: "deleted"
} as const;

type ArchiveResultStatus =
  typeof ARCHIVE_RESULT_STATUS[keyof typeof ARCHIVE_RESULT_STATUS];

export interface ArchiveClientOrganizationResult {
  status: ArchiveResultStatus;
  linkedCounts: ClientOrgLinkedCounts;
  archivedAt?: string;
}

export interface PreviewArchiveClientOrganizationResult {
  projectedStatus: ArchiveResultStatus;
  linkedCounts: ClientOrgLinkedCounts;
  archivedAt: string | null;
}

const CLIENT_ORGS_PATH = "/admin/client-orgs";

export async function fetchClientOrganizations(): Promise<ClientOrganization[]> {
  const response = await apiClient.get<{ items?: ClientOrganization[] }>(CLIENT_ORGS_PATH);
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

export async function createClientOrganization(
  payload: CreateClientOrganizationPayload
): Promise<ClientOrganization> {
  return (await apiClient.post<ClientOrganization>(CLIENT_ORGS_PATH, payload)).data;
}

export async function updateClientOrganization(
  id: string,
  payload: UpdateClientOrganizationPayload
): Promise<ClientOrganization> {
  return (await apiClient.patch<ClientOrganization>(`${CLIENT_ORGS_PATH}/${encodeURIComponent(id)}`, payload)).data;
}

export async function deleteClientOrganization(
  id: string
): Promise<ArchiveClientOrganizationResult> {
  return (
    await apiClient.delete<ArchiveClientOrganizationResult>(
      `${CLIENT_ORGS_PATH}/${encodeURIComponent(id)}`
    )
  ).data;
}

export async function previewArchiveClientOrganization(
  id: string
): Promise<PreviewArchiveClientOrganizationResult> {
  return (
    await apiClient.get<PreviewArchiveClientOrganizationResult>(
      `${CLIENT_ORGS_PATH}/${encodeURIComponent(id)}/preview-archive`
    )
  ).data;
}
