import { getAuth } from "../types/auth.js";
import { Router } from "express";
import { TenantAssignableRoles, type TenantAssignableRole } from "../models/core/TenantUserRole.js";
import type { TenantAdminService } from "../services/tenant/tenantAdminService.js";
import type { TenantInviteService } from "../services/tenant/tenantInviteService.js";
import { requireCap } from "../auth/requireCapability.js";
import { toValidObjectId } from "../utils/validation.js";

export function createTenantAdminRouter(tenantAdminService: TenantAdminService, inviteService: TenantInviteService) {
  const router = Router();

  router.get("/admin/users", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      const users = await tenantAdminService.listTenantUsers(getAuth(request).tenantId);
      response.json({ items: users });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/users/invite", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      const context = getAuth(request);
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

  router.post("/admin/users/:userId/role", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      if (!toValidObjectId(request.params.userId)) {
        response.status(400).json({ message: "Invalid userId." });
        return;
      }
      const role = typeof request.body?.role === "string" ? request.body.role : "";
      if (!TenantAssignableRoles.includes(role as TenantAssignableRole)) {
        response.status(400).json({ message: "Invalid role." });
        return;
      }
      await tenantAdminService.assignRole({
        tenantId: getAuth(request).tenantId,
        userId: request.params.userId,
        role: role as TenantAssignableRole,
        actingUserId: getAuth(request).userId
      });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/users/:userId/enabled", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      const enabled = request.body?.enabled;
      if (typeof enabled !== "boolean") {
        response.status(400).json({ message: "enabled must be a boolean.", code: "tenant_invalid_input" });
        return;
      }
      await tenantAdminService.setUserEnabled({
        tenantId: getAuth(request).tenantId,
        userId: request.params.userId,
        enabled,
        actingUserId: getAuth(request).userId
      });
      response.json({ userId: request.params.userId, enabled });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/users/:userId", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      await tenantAdminService.removeUser({
        tenantId: getAuth(request).tenantId,
        userId: request.params.userId
      });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/mailboxes", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      const items = await tenantAdminService.listMailboxes(getAuth(request).tenantId);
      response.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/mailboxes/:id/assign", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      const userId = typeof request.body?.userId === "string" ? request.body.userId : "";
      if (!userId) {
        response.status(400).json({ message: "userId is required." });
        return;
      }
      await tenantAdminService.assignMailbox(getAuth(request).tenantId, request.params.id, userId);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/mailboxes/:id/assign/:userId", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      await tenantAdminService.removeMailboxAssignment(getAuth(request).tenantId, request.params.id, request.params.userId);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/mailboxes/:id", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      await tenantAdminService.deleteMailbox(getAuth(request).tenantId, request.params.id);
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/users/:userId/viewer-scope", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      const result = await tenantAdminService.getViewerScope(getAuth(request).tenantId, request.params.userId);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/users/:userId/viewer-scope", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      if (!toValidObjectId(request.params.userId)) {
        response.status(400).json({ message: "Invalid userId." });
        return;
      }
      const visibleUserIds = Array.isArray(request.body?.visibleUserIds)
        ? request.body.visibleUserIds.filter((id: unknown) => typeof id === "string" && toValidObjectId(id))
        : [];
      const result = await tenantAdminService.setViewerScope(getAuth(request).tenantId, request.params.userId, visibleUserIds);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
