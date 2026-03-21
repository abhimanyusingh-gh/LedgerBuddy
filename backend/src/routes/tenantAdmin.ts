import { Router } from "express";
import { TenantRoles, type TenantRole } from "../models/TenantUserRole.js";
import type { TenantAdminService } from "../services/tenantAdminService.js";
import type { TenantInviteService } from "../services/tenantInviteService.js";
import { requireTenantAdmin } from "../auth/middleware.js";
import { toValidObjectId } from "../utils/validation.js";

export function createTenantAdminRouter(tenantAdminService: TenantAdminService, inviteService: TenantInviteService) {
  const router = Router();

  router.get("/admin/users", requireTenantAdmin, async (request, response, next) => {
    try {
      const users = await tenantAdminService.listTenantUsers(request.authContext!.tenantId);
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
      if (!toValidObjectId(request.params.userId)) {
        response.status(400).json({ message: "Invalid userId." });
        return;
      }
      const role = typeof request.body?.role === "string" ? request.body.role : "";
      if (!TenantRoles.includes(role as TenantRole)) {
        response.status(400).json({ message: "Invalid role." });
        return;
      }
      await tenantAdminService.assignRole({
        tenantId: request.authContext!.tenantId,
        userId: request.params.userId,
        role: role as TenantRole
      });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/users/:userId/enabled", requireTenantAdmin, async (request, response, next) => {
    try {
      const enabled = request.body?.enabled;
      if (typeof enabled !== "boolean") {
        response.status(400).json({ message: "enabled must be a boolean.", code: "tenant_invalid_input" });
        return;
      }
      await tenantAdminService.setUserEnabled({
        tenantId: request.authContext!.tenantId,
        userId: request.params.userId,
        enabled
      });
      response.json({ userId: request.params.userId, enabled });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/users/:userId", requireTenantAdmin, async (request, response, next) => {
    try {
      await tenantAdminService.removeUser({
        tenantId: request.authContext!.tenantId,
        userId: request.params.userId
      });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/mailboxes", requireTenantAdmin, async (request, response, next) => {
    try {
      const items = await tenantAdminService.listMailboxes(request.authContext!.tenantId);
      response.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/mailboxes/:id/assign", requireTenantAdmin, async (request, response, next) => {
    try {
      const userId = typeof request.body?.userId === "string" ? request.body.userId : "";
      if (!userId) {
        response.status(400).json({ message: "userId is required." });
        return;
      }
      await tenantAdminService.assignMailbox(request.authContext!.tenantId, request.params.id, userId);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/mailboxes/:id/assign/:userId", requireTenantAdmin, async (request, response, next) => {
    try {
      await tenantAdminService.removeMailboxAssignment(request.authContext!.tenantId, request.params.id, request.params.userId);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/mailboxes/:id", requireTenantAdmin, async (request, response, next) => {
    try {
      await tenantAdminService.deleteMailbox(request.authContext!.tenantId, request.params.id);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/users/:userId/viewer-scope", requireTenantAdmin, async (request, response, next) => {
    try {
      const result = await tenantAdminService.getViewerScope(request.authContext!.tenantId, request.params.userId);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/users/:userId/viewer-scope", requireTenantAdmin, async (request, response, next) => {
    try {
      if (!toValidObjectId(request.params.userId)) {
        response.status(400).json({ message: "Invalid userId." });
        return;
      }
      const visibleUserIds = Array.isArray(request.body?.visibleUserIds)
        ? request.body.visibleUserIds.filter((id: unknown) => typeof id === "string" && toValidObjectId(id))
        : [];
      const result = await tenantAdminService.setViewerScope(request.authContext!.tenantId, request.params.userId, visibleUserIds);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
