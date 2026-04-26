import { Types } from "mongoose";
import { findClientOrgIdsByGstinForTenant } from "@/services/auth/tenantScope.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";

/**
 * Mailbox-bound assignment the resolver consults (#159). The caller has
 * already looked up the TenantMailboxAssignment row that sources this
 * invoice (Gmail poller or folder-watcher). We only need the tenantId
 * (ownership enforcement) and the candidate clientOrgIds list.
 *
 * Invariant: `clientOrgIds.length >= 1` — enforced by the mailbox
 * assignment schema validator. The resolver throws if an empty array
 * sneaks through.
 */
export interface MailboxAssignmentLike {
  _id: Types.ObjectId;
  tenantId: string;
  clientOrgIds: Types.ObjectId[];
}

interface ResolveClientOrgResult {
  /**
   * Resolved client-org for this invoice. `null` means the resolver fell
   * through to PENDING_TRIAGE — the caller must set
   * `status: PENDING_TRIAGE` and `clientOrgId: null` on the Invoice.
   */
  clientOrgId: Types.ObjectId | null;
  triage: boolean;
  reason: "gstin_match" | "single_candidate" | "multi_candidate_triage";
}

/**
 * Three-tier mailbox resolution per #159:
 *   1. Parsed invoice's `customerGstin` matches exactly one of the
 *      mailbox assignment's candidate clientOrgs (by
 *      `ClientOrganization.gstin`, ownership restricted to
 *      `assignment.tenantId`) → resolved to that org.
 *   2. Otherwise, if the assignment has exactly one candidate → use it.
 *   3. Otherwise → triage. Caller stamps `PENDING_TRIAGE`.
 *
 * Throws an `Error` if the assignment violates its `minLength: 1`
 * invariant (empty `clientOrgIds`) — that's a data-integrity bug, not
 * a triage path.
 */
export async function resolveClientOrgForIngestion(
  parsedInvoice: Pick<ParsedInvoiceData, "customerGstin">,
  assignment: MailboxAssignmentLike
): Promise<ResolveClientOrgResult> {
  if (!assignment.clientOrgIds || assignment.clientOrgIds.length === 0) {
    throw new Error(
      "resolveClientOrgForIngestion: mailbox assignment has no clientOrgIds — schema invariant violated."
    );
  }

  const customerGstin = typeof parsedInvoice.customerGstin === "string"
    ? parsedInvoice.customerGstin.trim().toUpperCase()
    : "";

  if (customerGstin.length > 0) {
    // Shared (tenantId, _id ∈ ids, gstin) primitive — see tenantScope.ts.
    const matches = await findClientOrgIdsByGstinForTenant(
      assignment.tenantId,
      assignment.clientOrgIds,
      customerGstin
    );

    if (matches.length === 1) {
      return {
        clientOrgId: matches[0],
        triage: false,
        reason: "gstin_match"
      };
    }
  }

  if (assignment.clientOrgIds.length === 1) {
    return {
      clientOrgId: assignment.clientOrgIds[0],
      triage: false,
      reason: "single_candidate"
    };
  }

  return {
    clientOrgId: null,
    triage: true,
    reason: "multi_candidate_triage"
  };
}
