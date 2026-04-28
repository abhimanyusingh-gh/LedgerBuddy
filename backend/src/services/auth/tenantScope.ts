
import type { Types } from "mongoose";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { INVOICE_STATUS } from "@/types/invoice.js";

export class ClientOrgTenantInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientOrgTenantInvariantError";
  }
}

export async function findClientOrgIdsForTenant(
  tenantId: string
): Promise<Types.ObjectId[]> {
  const docs = await ClientOrganizationModel.find({ tenantId })
    .select("_id")
    .lean();
  return docs.map((d) => d._id);
}

export async function findClientOrgIdByIdForTenant(
  clientOrgId: string,
  tenantId: string
): Promise<Types.ObjectId | null> {
  const doc = await ClientOrganizationModel.findOne({
    _id: clientOrgId,
    tenantId
  })
    .select("_id")
    .lean();
  return doc?._id ?? null;
}

export async function findClientOrgIdsByGstinForTenant(
  tenantId: string,
  candidateIds: Types.ObjectId[],
  gstin: string
): Promise<Types.ObjectId[]> {
  if (candidateIds.length === 0 || gstin.length === 0) return [];
  const docs = await ClientOrganizationModel.find({
    tenantId,
    _id: { $in: candidateIds },
    gstin
  })
    .select("_id")
    .lean();
  return docs.map((d) => d._id);
}

export async function findTenantIdsByClientOrgIds(
  clientOrgIds: Array<Types.ObjectId | string>
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (clientOrgIds.length === 0) return map;
  const docs = await ClientOrganizationModel.find(
    { _id: { $in: clientOrgIds } },
    { tenantId: 1 }
  ).lean();
  for (const d of docs) {
    map.set(String(d._id), d.tenantId);
  }
  return map;
}

const TRIAGE_NULL_CLIENT_ORG_STATUSES: readonly string[] = [
  INVOICE_STATUS.PENDING_TRIAGE,
  INVOICE_STATUS.REJECTED
];

export async function validateClientOrgTenantInvariant(
  tenantId: string | null | undefined,
  clientOrgId: Types.ObjectId | string | null | undefined,
  status?: string
): Promise<void> {
  if (status != null && TRIAGE_NULL_CLIENT_ORG_STATUSES.includes(status) && clientOrgId == null) {
    return;
  }
  if (tenantId == null && clientOrgId == null) {
    return;
  }
  if (!tenantId) {
    throw new ClientOrgTenantInvariantError(
      "tenantId required on accounting-leaf documents."
    );
  }
  if (clientOrgId == null) {
    throw new ClientOrgTenantInvariantError(
      "clientOrgId required on accounting-leaf documents outside PENDING_TRIAGE."
    );
  }
  const clientOrg = await ClientOrganizationModel.findById(clientOrgId)
    .select("tenantId")
    .lean();
  if (!clientOrg) {
    throw new ClientOrgTenantInvariantError(
      `clientOrgId ${String(clientOrgId)} does not exist.`
    );
  }
  if (clientOrg.tenantId !== tenantId) {
    throw new ClientOrgTenantInvariantError(
      `clientOrgId ${String(clientOrgId)} belongs to tenant ${clientOrg.tenantId}, not ${tenantId}.`
    );
  }
}
