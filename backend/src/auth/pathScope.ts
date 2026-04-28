import type { NextFunction, Request, Response } from "express";
import type { Types } from "mongoose";
import { findClientOrgIdByIdForTenant } from "@/services/auth/tenantScope.js";
import { getAuth } from "@/types/auth.js";

declare module "express-serve-static-core" {
  interface Request {
    activeClientOrgId?: Types.ObjectId;
  }
}


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
