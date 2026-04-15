import type { Request } from "express";
import type { TenantRole } from "@/models/core/TenantUserRole.js";
import type { OnboardingStatus } from "@/types/onboarding.js";

export interface AuthenticatedRequestContext {
  userId: string;
  email: string;
  tenantId: string;
  tenantName: string;
  onboardingStatus: OnboardingStatus;
  role: TenantRole;
  isPlatformAdmin: boolean;
}

interface AuthenticatedRequest extends Request {
  authContext: AuthenticatedRequestContext;
}

export function getAuth(req: Request): AuthenticatedRequestContext {
  if (!req.authContext) throw new Error("Missing auth context");
  return req.authContext;
}

export interface SessionFlagsPayload {
  requires_tenant_setup: boolean;
  requires_reauth: boolean;
  requires_admin_action: boolean;
  requires_email_confirmation: boolean;
  must_change_password: boolean;
}
