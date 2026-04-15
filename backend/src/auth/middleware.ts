import type { NextFunction, Request, Response } from "express";
import type { AuthService } from "@/auth/AuthService.js";
import { normalizeTenantRole } from "@/models/core/TenantUserRole.js";

function isQueryTokenAllowed(path: string): boolean {
  if (path === "/jobs/ingest/sse") return true;
  if (/^\/invoices\/[^/]+\/preview$/.test(path)) return true;
  if (/^\/invoices\/[^/]+\/ocr-blocks\/\d+\/crop$/.test(path)) return true;
  if (/^\/invoices\/[^/]+\/source-overlays\/[^/]+$/.test(path)) return true;
  return false;
}

export function resolveBearerToken(request: Request): string {
  const authorization = request.header("authorization");
  const queryTokenAllowed = isQueryTokenAllowed(request.path);
  const queryToken = queryTokenAllowed && typeof request.query.authToken === "string" ? request.query.authToken.trim() : "";
  if (typeof authorization !== "string") {
    return queryToken;
  }

  const [scheme, token] = authorization.split(" ");
  const normalizedToken = token.trim();
  if (scheme?.toLowerCase() !== "bearer" || !normalizedToken || normalizedToken === "undefined" || normalizedToken === "null") {
    return queryToken;
  }

  return normalizedToken;
}

export function createAuthenticationMiddleware(authService: AuthService) {
  return async function authenticate(request: Request, response: Response, next: NextFunction) {
    try {
      const token = resolveBearerToken(request);
      if (!token) {
        response.status(401).json({ message: "Missing bearer token." });
        return;
      }

      request.authContext = await authService.resolveRequestContext(token);
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      response.status(401).json({ message });
    }
  };
}

export function requireTenantSetupCompleted(request: Request, response: Response, next: NextFunction): void {
  const context = request.authContext;
  if (!context) {
    response.status(401).json({ message: "Authentication required." });
    return;
  }

  if (context.onboardingStatus !== "completed") {
    response.status(403).json({ message: "Tenant onboarding is incomplete.", requires_tenant_setup: true });
    return;
  }

  next();
}

export function requireNonPlatformAdmin(request: Request, response: Response, next: NextFunction): void {
  const context = request.authContext;
  if (!context) {
    response.status(401).json({ message: "Authentication required." });
    return;
  }

  if (context.isPlatformAdmin) {
    response.status(403).json({ message: "Platform admins have read-only access to tenant operations." });
    return;
  }

  next();
}

export function requireNotViewer(request: Request, response: Response, next: NextFunction): void {
  const context = request.authContext;
  if (!context) {
    response.status(401).json({ message: "Authentication required." });
    return;
  }

  if (normalizeTenantRole(context.role) === "audit_clerk") {
    response.status(403).json({ message: "Viewers have read-only access." });
    return;
  }

  next();
}

export function requirePlatformAdmin(request: Request, response: Response, next: NextFunction): void {
  const context = request.authContext;
  if (!context) {
    response.status(401).json({ message: "Authentication required." });
    return;
  }

  if (!context.isPlatformAdmin) {
    response.status(403).json({ message: "Platform admin access required." });
    return;
  }

  next();
}
