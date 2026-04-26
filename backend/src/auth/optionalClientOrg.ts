/**
 * Optional client-org resolver — admin analytics contract (issue #162).
 *
 * Per the locked design on #162, admin analytics endpoints accept an
 * OPTIONAL `clientOrgId` query parameter. When present, the value must
 * be ownership-validated against the caller's tenant (same check as
 * `requirePathClientOrgOwnership` for nested-router routes). When absent,
 * the caller is opting into the tenant-wide aggregate view — the only
 * legitimate place in the app where accounting data is queried without a
 * `clientOrgId` scalar.
 *
 * The composite-key invariant (`always both tenantId + clientOrgId` —
 * see #156) is NOT relaxed by this helper. It is the documented
 * exemption surface for admin/analytics routes only. Operational routes
 * mount under `clientOrgRouter` and pick up `req.activeClientOrgId` from
 * the path-stamping middleware.
 *
 * Routes consume this helper instead of hand-rolling
 * `req.query.clientOrgId` parsing so the validation contract lives in
 * one place. The handler short-circuits with 400 on `!result.valid`.
 */

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
