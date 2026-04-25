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

export async function deleteClientOrganization(id: string): Promise<ClientOrganization> {
  return (await apiClient.delete<ClientOrganization>(`${CLIENT_ORGS_PATH}/${encodeURIComponent(id)}`)).data;
}
