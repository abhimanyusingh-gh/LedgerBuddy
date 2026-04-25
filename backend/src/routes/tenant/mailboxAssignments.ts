import { Router } from "express";
import { getAuth } from "@/types/auth.js";
import { requireCap } from "@/auth/requireCapability.js";
import type { MailboxAssignmentsAdminService } from "@/services/tenant/mailboxAssignmentsAdminService.js";
import { isRecord, isString } from "@/utils/validation.js";
import { HttpError } from "@/errors/HttpError.js";

/**
 * Admin CRUD for `TenantMailboxAssignment.clientOrgIds[]` (#174).
 * Tenant-scoped admin surface; the legacy `assignedTo` user-mapping
 * routes at `tenantAdmin.ts:90-129` continue to live alongside this
 * router and operate on a different field of the same document.
 */
export function createMailboxAssignmentsRouter(service: MailboxAssignmentsAdminService) {
  const router = Router();

  router.get("/admin/mailbox-assignments", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const items = await service.list(getAuth(req).tenantId);
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/mailbox-assignments", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      if (!isString(body.integrationId)) {
        throw new HttpError("integrationId is required.", 400, "mailbox_assignment_invalid_input");
      }
      const created = await service.create({
        tenantId: getAuth(req).tenantId,
        integrationId: body.integrationId,
        clientOrgIds: Array.isArray(body.clientOrgIds) ? body.clientOrgIds : [],
        assignedTo: isString(body.assignedTo) ? body.assignedTo : undefined
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/mailbox-assignments/:id", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      const updated = await service.update({
        tenantId: getAuth(req).tenantId,
        assignmentId: req.params.id,
        clientOrgIds: Array.isArray(body.clientOrgIds) ? (body.clientOrgIds as string[]) : undefined,
        assignedTo: isString(body.assignedTo) ? body.assignedTo : undefined
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/mailbox-assignments/:id", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      await service.delete({
        tenantId: getAuth(req).tenantId,
        assignmentId: req.params.id
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/admin/mailbox-assignments/:id/recent-ingestions",
    requireCap("canManageConnections"),
    async (req, res, next) => {
      try {
        const days = typeof req.query.days === "string" ? Number.parseInt(req.query.days, 10) : 30;
        const result = await service.recentIngestions({
          tenantId: getAuth(req).tenantId,
          assignmentId: req.params.id,
          days: Number.isFinite(days) ? days : 30
        });
        res.json(result);
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
