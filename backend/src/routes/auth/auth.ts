import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import type { AuthService } from "@/auth/AuthService.js";
import { env } from "@/config/env.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { createAuthenticationMiddleware } from "@/auth/middleware.js";

export function createAuthRouter(authService: AuthService) {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(authService);

  // TODO: Add rate limiting to /auth/token (e.g. express-rate-limit) to prevent brute-force attacks (H5)
  router.post("/auth/token", async (request, response, next) => {
    try {
      const email = typeof request.body?.email === "string" ? request.body.email : "";
      const password = typeof request.body?.password === "string" ? request.body.password : "";
      const result = await authService.loginWithPassword(email, password);
      response.json({ token: result.sessionToken });
    } catch (error) {
      next(error);
    }
  });

  router.get("/auth/login", async (request, response, next) => {
    try {
      const nextPath = typeof request.query.next === "string" ? request.query.next : "/";
      const loginHint = typeof request.query.login_hint === "string" ? request.query.login_hint : "";
      const redirectUrl = await authService.getAuthorizationUrl({
        nextPath,
        loginHint
      });
      response.redirect(302, redirectUrl);
    } catch (error) {
      next(error);
    }
  });

  router.get("/auth/callback", async (request, response, next) => {
    try {
      const code = typeof request.query.code === "string" ? request.query.code.trim() : "";
      const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
      if (!code || !state) {
        response.status(400).json({ message: "Missing OAuth callback code/state." });
        return;
      }

      const result = await authService.handleAuthorizationCallback(code, state);
      const redirect = new URL("/", env.FRONTEND_BASE_URL);
      redirect.searchParams.set("token", result.sessionToken);
      redirect.searchParams.set("next", result.redirectPath);
      response.redirect(302, redirect.toString());
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/refresh", async (request, response, next) => {
    try {
      const authHeader = typeof request.headers.authorization === "string" ? request.headers.authorization : "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (!token) {
        response.status(401).json({ message: "Authorization header with Bearer token is required." });
        return;
      }
      const result = await authService.refreshSession(token);
      response.json({ token: result.sessionToken });
    } catch (error) {
      next(error);
    }
  });

  router.post("/auth/change-password", authenticate, requireAuth, async (request, response, next) => {
    try {
      const context = getAuth(request);
      const currentPassword = typeof request.body?.currentPassword === "string" ? request.body.currentPassword : "";
      const newPassword = typeof request.body?.newPassword === "string" ? request.body.newPassword : "";
      if (!currentPassword || !newPassword) {
        response.status(400).json({ message: "Current password and new password are required." });
        return;
      }

      await authService.changePassword(context, currentPassword, newPassword);
      response.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
