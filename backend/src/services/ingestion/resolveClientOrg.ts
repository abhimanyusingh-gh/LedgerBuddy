import { Types } from "mongoose";
import { findClientOrgIdsByGstinForTenant } from "@/services/auth/tenantScope.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";

export interface MailboxAssignmentLike {
  _id: Types.ObjectId;
  tenantId: string;
  clientOrgIds: Types.ObjectId[];
}

interface ResolveClientOrgResult {
  clientOrgId: Types.ObjectId | null;
  triage: boolean;
  reason: "gstin_match" | "single_candidate" | "multi_candidate_triage";
}

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
