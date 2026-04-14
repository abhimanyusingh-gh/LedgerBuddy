import type { Request, Response, NextFunction } from "express";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import type { AuthenticatedRequestContext } from "@/types/auth.js";
import { getRoleDefaults, mergeCapabilitiesWithDefaults, type UserCapabilities } from "./personaDefaults.js";

const capabilitiesCache = new WeakMap<Request, UserCapabilities>();

async function resolveCapabilitiesForContext(
  context: Pick<AuthenticatedRequestContext, "tenantId" | "userId" | "role"> | null
): Promise<UserCapabilities> {
  if (!context) {
    return getRoleDefaults("PLATFORM_ADMIN");
  }

  const roleDoc = await TenantUserRoleModel.findOne({
    tenantId: context.tenantId,
    userId: context.userId
  }).lean();

  const rawRoleDoc = roleDoc as Record<string, unknown> | null;
  const storedCaps = rawRoleDoc?.capabilities as Record<string, unknown> | null | undefined;
  const roleForDefaults = typeof rawRoleDoc?.role === "string" ? rawRoleDoc.role : context.role;

  return mergeCapabilitiesWithDefaults(roleForDefaults, storedCaps);
}

export async function resolveCapabilities(req: Request): Promise<UserCapabilities> {
  const cached = capabilitiesCache.get(req);
  if (cached) return cached;

  const capabilities = await resolveCapabilitiesForContext(req.authContext ?? null);

  capabilitiesCache.set(req, capabilities);
  return capabilities;
}

export function requireCap(capabilityName: keyof UserCapabilities) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const context = req.authContext;
    if (!context) {
      res.status(401).json({ message: "Authentication required." });
      return;
    }

    const capabilities = await resolveCapabilities(req);
    if (capabilities[capabilityName] === true || (capabilityName === "approvalLimitMinor" && capabilities.approvalLimitMinor !== 0)) {
      next();
      return;
    }

    res.status(403).json({
      message: `Permission denied: ${capabilityName} is required for this action.`,
      code: "capability_denied",
      capability: capabilityName
    });
  };
}
