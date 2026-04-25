import type { NextFunction, Request, Response } from "express";
import { findClientOrgIdByIdForTenant } from "@/services/auth/tenantScope.js";
import { getAuth } from "@/types/auth.js";

/**
 * Middleware for the nested-router scaffold introduced by #171.
 *
 * The new URL shape encodes scope in the path:
 *   /api/tenants/:tenantId/...                          tenant-wide
 *   /api/tenants/:tenantId/clientOrgs/:clientOrgId/...  realm-scoped
 *
 * These middlewares replace the query/header/session priority chain in
 * `requireActiveClientOrg` for routes mounted under the nested path tree.
 *
 * Old (`requireActiveClientOrg`) and new path-scope middlewares coexist
 * during the per-domain rollout: each domain swaps off the old onto the
 * new in a single vertical-slice PR. See feedback_freeze_be_extensions_until_171.md.
 */

/**
 * Assert the path-supplied `:tenantId` matches the authenticated tenant.
 * Returns 403 on mismatch (authenticated as tenant A but URL targets tenant B).
 */
export function requireMatchingTenantIdParam(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const { tenantId: authTenantId } = getAuth(req);
    const pathTenantId = req.params.tenantId;
    if (!pathTenantId) {
      res.status(400).json({ message: "tenantId path parameter is required." });
      return;
    }
    if (pathTenantId !== authTenantId) {
      res.status(403).json({ message: "Path tenantId does not match authenticated tenant." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Assert the path-supplied `:clientOrgId` is owned by the authenticated tenant
 * and stamp `req.activeClientOrgId` for downstream handlers (preserves the
 * existing `req.activeClientOrgId` contract so domain handlers don't need to
 * change their body — only the mount point and the middleware chain change).
 */
export async function requirePathClientOrgOwnership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { tenantId } = getAuth(req);
    const pathClientOrgId = req.params.clientOrgId;
    if (!pathClientOrgId) {
      res.status(400).json({ message: "clientOrgId path parameter is required." });
      return;
    }
    const owned = await findClientOrgIdByIdForTenant(pathClientOrgId, tenantId);
    if (!owned) {
      res.status(400).json({ message: "clientOrgId does not belong to this tenant." });
      return;
    }
    req.activeClientOrgId = owned;
    next();
  } catch (error) {
    next(error);
  }
}
