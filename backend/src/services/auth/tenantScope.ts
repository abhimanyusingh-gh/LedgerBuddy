/**
 * Tenant → ClientOrganization scope resolution helpers.
 *
 * Post hierarchy-pivot (issues #155/#156), accounting-leaf models
 * (Invoice, VendorMaster, ExportBatch, …) no longer carry `tenantId`
 * directly — they reference `clientOrgId` which in turn points at a
 * `ClientOrganization` that is tenant-scoped via its own `tenantId`.
 *
 * Query call-sites must therefore resolve the set of client-org ids
 * owned by the caller's tenant before filtering accounting leaves.
 * Ingestion paths must likewise verify that a caller-supplied
 * `clientOrgId` is owned by the caller's tenant before accepting it.
 *
 * These two helpers are the single source of truth for that scope
 * resolution. Every accounting-leaf query and every ingestion ownership
 * check must go through here — do NOT inline `ClientOrganizationModel.find`
 * at call-sites.
 */

import type { Types } from "mongoose";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { INVOICE_STATUS } from "@/types/invoice.js";

export class ClientOrgTenantInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientOrgTenantInvariantError";
  }
}

/**
 * Return the ObjectIds of every ClientOrganization owned by `tenantId`.
 *
 * Use at list/query call-sites:
 * ```ts
 * const clientOrgIds = await findClientOrgIdsForTenant(tenantId);
 * await InvoiceModel.find({ clientOrgId: { $in: clientOrgIds }, ...rest });
 * ```
 *
 * An empty array is a valid result (tenant with no client-orgs yet) —
 * callers must pass it straight to `$in` rather than shortcut around it.
 */
export async function findClientOrgIdsForTenant(
  tenantId: string
): Promise<Types.ObjectId[]> {
  const docs = await ClientOrganizationModel.find({ tenantId })
    .select("_id")
    .lean();
  return docs.map((d) => d._id);
}

/**
 * Ownership re-check: return `clientOrgId` only if it belongs to
 * `tenantId`, else `null`.
 *
 * Use at ingestion entry points and batch-upload item loops — never
 * trust a caller-supplied `clientOrgId` without re-checking ownership.
 * Returning the ObjectId (rather than a boolean) lets the caller drop
 * it straight onto the accounting-leaf document being created.
 */
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

/**
 * Filter a tenant-owned `clientOrgIds[]` candidate set down to those whose
 * `ClientOrganization.gstin` matches `gstin` (case-insensitive — caller
 * upper-cases). Shared lookup primitive for ingestion-side resolvers
 * (#159 mailbox triage) and any future GSTIN-based reconciliation; keeps
 * the `(tenantId, _id ∈ ids, gstin)` query in one place rather than
 * scattering `find({ tenantId, gstin })` patterns across services.
 */
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

/**
 * Reverse lookup: given a set of `clientOrgIds`, return the
 * `(clientOrgId → tenantId)` mapping. Used by cross-tenant scanners
 * (e.g. workflow-health) that start from accounting-leaf docs and need
 * to resolve their owning tenant. Keeps the
 * `find({ _id: { $in: ids } }, { tenantId: 1 })` pattern in one place.
 */
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

/**
 * Pre-save invariant: every accounting-leaf document must carry a
 * `clientOrgId` whose referenced `ClientOrganization.tenantId` matches
 * the document's own `tenantId`. Triage-stage invoices are exempt —
 * `PENDING_TRIAGE` is awaiting assignment, and `REJECTED` (#179) was
 * dismissed before assignment ever happened, so both legitimately carry
 * `clientOrgId: null`.
 */
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
