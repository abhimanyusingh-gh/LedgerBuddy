
import type { Request } from "express";
import type { Types } from "mongoose";
import { findClientOrgIdByIdForTenant } from "@/services/auth/tenantScope.js";
import { getAuth } from "@/types/auth.js";

export const OPTIONAL_CLIENT_ORG_ERROR_CODE = "invalid_client_org_id";
export const OPTIONAL_CLIENT_ORG_ERROR_MESSAGE = "clientOrgId does not belong to this tenant";

type ResolveOptionalClientOrgIdResult =
  | { valid: true; clientOrgId: Types.ObjectId | null }
  | { valid: false; error: string; message: string };

export async function resolveOptionalClientOrgId(
  req: Request
): Promise<ResolveOptionalClientOrgIdResult> {
  const raw = req.query?.clientOrgId;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { valid: true, clientOrgId: null };
  }
  const { tenantId } = getAuth(req);
  const owned = await findClientOrgIdByIdForTenant(raw.trim(), tenantId);
  if (!owned) {
    return {
      valid: false,
      error: OPTIONAL_CLIENT_ORG_ERROR_CODE,
      message: OPTIONAL_CLIENT_ORG_ERROR_MESSAGE
    };
  }
  return { valid: true, clientOrgId: owned };
}
