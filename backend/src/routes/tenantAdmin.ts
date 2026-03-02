import { Router } from "express";
import { TenantRoles, type TenantRole } from "../models/TenantUserRole.js";
import type { TenantAdminService } from "../services/tenantAdminService.js";
import type { TenantInviteService } from "../services/tenantInviteService.js";
import { requireTenantAdmin } from "../auth/middleware.js";

export function createTenantAdminRouter(tenantAdminService: TenantAdminService, inviteService: TenantInviteService) {
  const router = Router();

  router.get("/admin/users", requireTenantAdmin, async (request, response, next) => {
    try {
      const context = request.authContext!;
      const users = await tenantAdminService.listTenantUsers(context.tenantId);
      response.json({ items: users });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/users/invite", requireTenantAdmin, async (request, response, next) => {
    try {
      const context = request.authContext!;
      const email = typeof request.body?.email === "string" ? request.body.email : "";
      const invite = await inviteService.createInvite({
        tenantId: context.tenantId,
        invitedByUserId: context.userId,
        email
      });
      response.status(201).json(invite);
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/users/:userId/role", requireTenantAdmin, async (request, response, next) => {
    try {
      const context = request.authContext!;
      const role = typeof request.body?.role === "string" ? request.body.role : "";
      if (!TenantRoles.includes(role as TenantRole)) {
        response.status(400).json({ message: "Invalid role." });
        return;
      }
      await tenantAdminService.assignRole({
        tenantId: context.tenantId,
        userId: request.params.userId,
        role: role as TenantRole
      });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/users/:userId", requireTenantAdmin, async (request, response, next) => {
    try {
      const context = request.authContext!;
      await tenantAdminService.removeUser({
        tenantId: context.tenantId,
        userId: request.params.userId
      });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
