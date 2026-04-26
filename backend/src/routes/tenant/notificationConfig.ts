import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import { ClientNotificationConfigModel, NOTIFICATION_RECIPIENT_TYPES } from "@/models/integration/ClientNotificationConfig.js";
import { MailboxNotificationEventModel } from "@/models/integration/MailboxNotificationEvent.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";

const VALID_RECIPIENT_TYPES = new Set<string>(NOTIFICATION_RECIPIENT_TYPES);

const DEFAULTS = {
  mailboxReauthEnabled: true,
  escalationEnabled: true,
  inAppEnabled: false,
  primaryRecipientType: "integration_creator" as const,
  specificRecipientUserId: null
};

export function createNotificationConfigRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/admin/notification-config", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const clientOrgId = req.activeClientOrgId!;
      const config = await ClientNotificationConfigModel.findOne({ tenantId, clientOrgId }).lean();

      if (!config) {
        const created = await ClientNotificationConfigModel.create({
          tenantId,
          clientOrgId,
          ...DEFAULTS,
          updatedBy: getAuth(req).email || getAuth(req).userId
        });
        res.json(created.toObject());
        return;
      }

      res.json(config);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/notification-config", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const clientOrgId = req.activeClientOrgId!;
      const update: Record<string, unknown> = {};

      if (typeof req.body.mailboxReauthEnabled === "boolean") {
        update.mailboxReauthEnabled = req.body.mailboxReauthEnabled;
      }

      if (typeof req.body.escalationEnabled === "boolean") {
        update.escalationEnabled = req.body.escalationEnabled;
      }

      if (req.body.primaryRecipientType !== undefined) {
        if (!VALID_RECIPIENT_TYPES.has(req.body.primaryRecipientType)) {
          res.status(400).json({
            message: `primaryRecipientType must be one of: ${[...VALID_RECIPIENT_TYPES].join(", ")}`
          });
          return;
        }
        update.primaryRecipientType = req.body.primaryRecipientType;
      }

      if (req.body.specificRecipientUserId !== undefined) {
        const effectiveRecipientType = (update.primaryRecipientType ?? req.body.primaryRecipientType) as string | undefined;

        if (req.body.specificRecipientUserId !== null && typeof req.body.specificRecipientUserId !== "string") {
          res.status(400).json({ message: "specificRecipientUserId must be a string or null." });
          return;
        }

        if (effectiveRecipientType === "specific_user" && !req.body.specificRecipientUserId) {
          res.status(400).json({ message: "specificRecipientUserId is required when primaryRecipientType is specific_user." });
          return;
        }

        update.specificRecipientUserId = req.body.specificRecipientUserId;
      }

      update.updatedBy = getAuth(req).email || getAuth(req).userId;

      const config = await ClientNotificationConfigModel.findOneAndUpdate(
        { tenantId, clientOrgId },
        { $set: update, $setOnInsert: { tenantId, clientOrgId } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      res.json(config!.toObject());
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createNotificationLogRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/admin/notifications/log", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
      const skip = (page - 1) * limit;

      const tenantRoles = await TenantUserRoleModel.find({ tenantId }).select({ userId: 1 }).lean();
      const tenantUserIds = tenantRoles.map((r) => r.userId);

      if (tenantUserIds.length === 0) {
        res.json({ items: [], page, limit, total: 0 });
        return;
      }

      const filter = { userId: { $in: tenantUserIds } };

      const [items, total] = await Promise.all([
        MailboxNotificationEventModel
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        MailboxNotificationEventModel
          .countDocuments(filter)
      ]);

      res.json({ items, page, limit, total });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
