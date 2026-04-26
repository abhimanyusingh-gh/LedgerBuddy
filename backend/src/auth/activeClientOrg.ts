import type { NextFunction, Request, Response } from "express";
import type { Types } from "mongoose";
import { findClientOrgIdByIdForTenant } from "@/services/auth/tenantScope.js";
import { getAuth } from "@/types/auth.js";

declare module "express-serve-static-core" {
  interface Request {
    activeClientOrgId?: Types.ObjectId;
    session?: { activeClientOrgId?: string };
  }
}

export const CLIENT_ORG_ID_SOURCE = {
  QUERY: "query",
  HEADER: "header",
  SESSION: "session",
  NONE: "none"
} as const;

type ClientOrgIdSource = typeof CLIENT_ORG_ID_SOURCE[keyof typeof CLIENT_ORG_ID_SOURCE];

interface ExtractedClientOrgId {
  raw: string;
  source: ClientOrgIdSource;
}

function extractClientOrgId(req: Request): ExtractedClientOrgId {
  const q = req.query?.clientOrgId;
  if (typeof q === "string" && q.trim().length > 0) {
    return { raw: q.trim(), source: CLIENT_ORG_ID_SOURCE.QUERY };
  }
  const header = req.header("x-client-org-id");
  if (typeof header === "string" && header.trim().length > 0) {
    return { raw: header.trim(), source: CLIENT_ORG_ID_SOURCE.HEADER };
  }
  const sessionValue = req.session?.activeClientOrgId;
  if (typeof sessionValue === "string" && sessionValue.trim().length > 0) {
    return { raw: sessionValue.trim(), source: CLIENT_ORG_ID_SOURCE.SESSION };
  }
  return { raw: "", source: CLIENT_ORG_ID_SOURCE.NONE };
}

export async function requireActiveClientOrg(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Short-circuit when an upstream middleware (#171 nested-router scaffold's
    // `requirePathClientOrgOwnership`) has already validated and stamped
    // `req.activeClientOrgId` from the path. Letting both middlewares coexist
    // lets a single domain router mount under both the legacy `/api/...` shape
    // (query/header/session source chain) AND the new `/api/tenants/:tenantId/
    // clientOrgs/:clientOrgId/...` shape during the per-domain rollout.
    if (req.activeClientOrgId) {
      next();
      return;
    }
    const { tenantId } = getAuth(req);
    const { raw, source } = extractClientOrgId(req);
    if (!raw) {
      res.status(400).json({
        error: "clientOrgId required and must belong to tenant",
        source: CLIENT_ORG_ID_SOURCE.NONE
      });
      return;
    }
    const owned = await findClientOrgIdByIdForTenant(raw, tenantId);
    if (!owned) {
      res.status(400).json({
        error: "clientOrgId required and must belong to tenant",
        source
      });
      return;
    }
    req.activeClientOrgId = owned;
    next();
  } catch (error) {
    next(error);
  }
}
