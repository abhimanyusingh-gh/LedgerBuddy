import { Router } from "express";
import { TenantRoles, type TenantRole } from "../models/TenantUserRole.js";
import type { TenantAdminService } from "../services/tenantAdminService.js";
import type { TenantInviteService } from "../services/tenantInviteService.js";
import { requireTenantAdmin } from "../auth/middleware.js";
import { TenantIntegrationModel } from "../models/TenantIntegration.js";
import { TenantMailboxAssignmentModel } from "../models/TenantMailboxAssignment.js";
import { ViewerScopeModel } from "../models/ViewerScope.js";
import { Types } from "mongoose";

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

  router.patch("/admin/users/:userId/enabled", requireTenantAdmin, async (request, response, next) => {
    try {
      const context = request.authContext!;
      const enabled = request.body?.enabled;
      if (typeof enabled !== "boolean") {
        response.status(400).json({ message: "enabled must be a boolean.", code: "tenant_invalid_input" });
        return;
      }
      await tenantAdminService.setUserEnabled({
        tenantId: context.tenantId,
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

  router.get("/admin/mailboxes", requireTenantAdmin, async (request, response, next) => {
    try {
      const { tenantId } = request.authContext!;
      const integrations = await TenantIntegrationModel.find({ tenantId }).lean();
      const integrationIds = integrations.map((i) => i._id);
      const assignments = await TenantMailboxAssignmentModel.find({ tenantId, integrationId: { $in: integrationIds } }).lean();
      const users = await tenantAdminService.listTenantUsers(tenantId);
      const userMap = new Map(users.map((u) => [u.userId, u.email]));

      const items = integrations.map((integration) => {
        const iid = (integration._id as Types.ObjectId).toString();
        const integrationAssignments = assignments.filter((a) => a.integrationId.toString() === iid);
        const hasAll = integrationAssignments.some((a) => a.assignedTo === "all");
        const specificAssignments = integrationAssignments
          .filter((a) => a.assignedTo !== "all")
          .map((a) => ({ userId: a.assignedTo, email: userMap.get(a.assignedTo) ?? a.assignedTo }));

        return {
          _id: iid,
          provider: integration.provider,
          emailAddress: integration.emailAddress,
          status: integration.status,
          lastSyncedAt: integration.lastSyncedAt,
          assignments: hasAll ? "all" : specificAssignments
        };
      });

      response.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/mailboxes/:id/assign", requireTenantAdmin, async (request, response, next) => {
    try {
      const { tenantId } = request.authContext!;
      const integrationId = new Types.ObjectId(request.params.id);
      const userId = typeof request.body?.userId === "string" ? request.body.userId : "";
      if (!userId) {
        response.status(400).json({ message: "userId is required." });
        return;
      }
      const integration = await TenantIntegrationModel.findOne({ _id: integrationId, tenantId }).lean();
      if (!integration) {
        response.status(404).json({ message: "Mailbox not found." });
        return;
      }
      await TenantMailboxAssignmentModel.updateOne(
        { tenantId, integrationId, assignedTo: userId },
        { tenantId, integrationId, assignedTo: userId },
        { upsert: true }
      );
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/mailboxes/:id/assign/:userId", requireTenantAdmin, async (request, response, next) => {
    try {
      const { tenantId } = request.authContext!;
      const integrationId = new Types.ObjectId(request.params.id);
      await TenantMailboxAssignmentModel.deleteOne({ tenantId, integrationId, assignedTo: request.params.userId });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/mailboxes/:id", requireTenantAdmin, async (request, response, next) => {
    try {
      const { tenantId } = request.authContext!;
      const integrationId = new Types.ObjectId(request.params.id);
      const integration = await TenantIntegrationModel.findOne({ _id: integrationId, tenantId }).lean();
      if (!integration) {
        response.status(404).json({ message: "Mailbox not found." });
        return;
      }
      await TenantMailboxAssignmentModel.deleteMany({ tenantId, integrationId });
      await TenantIntegrationModel.deleteOne({ _id: integrationId, tenantId });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/users/:userId/viewer-scope", requireTenantAdmin, async (request, response, next) => {
    try {
      const context = request.authContext!;
      const scope = await ViewerScopeModel.findOne({ tenantId: context.tenantId, viewerUserId: request.params.userId }).lean();
      response.json({ visibleUserIds: scope?.visibleUserIds ?? [] });
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/users/:userId/viewer-scope", requireTenantAdmin, async (request, response, next) => {
    try {
      const context = request.authContext!;
      const visibleUserIds = Array.isArray(request.body?.visibleUserIds)
        ? request.body.visibleUserIds.filter((id: unknown) => typeof id === "string")
        : [];
      await ViewerScopeModel.findOneAndUpdate(
        { tenantId: context.tenantId, viewerUserId: request.params.userId },
        { $set: { visibleUserIds } },
        { upsert: true }
      );
      response.json({ visibleUserIds });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
