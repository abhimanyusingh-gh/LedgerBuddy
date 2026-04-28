import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import type { ApprovalWorkflowService } from "@/services/invoice/approvalWorkflowService.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";
import { TenantUserRoleModel, TenantAssignableRoles } from "@/models/core/TenantUserRole.js";
import { getRoleDefaults } from "@/auth/personaDefaults.js";
import { AuditLogModel } from "@/models/core/AuditLog.js";
import { logger } from "@/utils/logger.js";
import { INVOICE_URL_PATHS } from "@/routes/urls/invoiceUrls.js";

const VALID_CONDITION_FIELDS = ["totalAmountMinor", "tdsAmountMinor", "riskSignalMaxSeverity", "glCodeSource"] as const;
const NUMERIC_FIELDS = new Set(["totalAmountMinor", "tdsAmountMinor", "riskSignalMaxSeverity"]);
const NUMERIC_OPERATORS = new Set(["gt", "gte", "lt", "lte", "eq"]);
const STRING_OPERATORS = new Set(["eq", "in"]);

export function validateStepCondition(condition: unknown): string | null {
  if (condition === null || condition === undefined) return null;
  if (typeof condition !== "object" || Array.isArray(condition)) {
    return "Condition must be an object with field, operator, and value.";
  }
  const c = condition as Record<string, unknown>;
  if (!c.field) return null;

  const field = c.field as string;
  if (!(VALID_CONDITION_FIELDS as readonly string[]).includes(field)) {
    return `Invalid condition field "${field}". Must be one of: ${VALID_CONDITION_FIELDS.join(", ")}.`;
  }

  const operator = c.operator as string;
  if (!operator) {
    return `Condition on "${field}" requires an operator.`;
  }

  const isNumericField = NUMERIC_FIELDS.has(field);
  if (isNumericField) {
    if (!NUMERIC_OPERATORS.has(operator)) {
      return `Invalid operator "${operator}" for numeric field "${field}". Must be one of: gt, gte, lt, lte, eq.`;
    }
    if (typeof c.value !== "number") {
      return `Condition value for numeric field "${field}" must be a number.`;
    }
  } else {
    if (!STRING_OPERATORS.has(operator)) {
      return `Invalid operator "${operator}" for field "${field}". Must be one of: eq, in.`;
    }
    if (operator === "eq" && typeof c.value !== "string") {
      return `Condition value for "${field}" with operator "eq" must be a string.`;
    }
    if (operator === "in") {
      if (!Array.isArray(c.value) || !c.value.every((v: unknown) => typeof v === "string")) {
        return `Condition value for "${field}" with operator "in" must be an array of strings.`;
      }
    }
  }

  return null;
}

export function createApprovalWorkflowRouter(workflowService: ApprovalWorkflowService) {
  const router = Router();
  router.use(requireAuth);

  router.get(INVOICE_URL_PATHS.adminApprovalLimits, requireCap("canConfigureWorkflow"), async (req, res, next) => {
    try {
      const { tenantId } = getAuth(req);
      const roleRecords = await TenantUserRoleModel.find({ tenantId }).lean();
      const limitsMap: Record<string, { approvalLimitMinor: number | null; userIds: string[] }> = {};
      for (const role of TenantAssignableRoles) {
        const defaults = getRoleDefaults(role);
        limitsMap[role] = { approvalLimitMinor: defaults.approvalLimitMinor, userIds: [] };
      }
      for (const record of roleRecords) {
        const role = record.role as string;
        if (!limitsMap[role]) continue;
        limitsMap[role].userIds.push(record.userId);
        const storedLimit = (record.capabilities as Record<string, unknown> | undefined)?.approvalLimitMinor;
        if (storedLimit !== undefined && storedLimit !== null) {
          limitsMap[role].approvalLimitMinor = storedLimit as number;
        }
      }
      const complianceUsers = roleRecords
        .filter((r) => (r.capabilities as Record<string, unknown> | undefined)?.canSignOffCompliance === true)
        .map((r) => ({ userId: r.userId, role: r.role as string }));
      res.json({ limits: limitsMap, complianceSignoffUsers: complianceUsers });
    } catch (error) {
      next(error);
    }
  });

  router.put(INVOICE_URL_PATHS.adminApprovalLimits, requireCap("canConfigureWorkflow"), async (req, res, next) => {
    try {
      const { tenantId, userId: actingUserId } = getAuth(req);
      const limits = req.body?.limits;
      if (typeof limits !== "object" || limits === null || Array.isArray(limits)) {
        res.status(400).json({ message: "limits must be an object mapping role to approvalLimitMinor." });
        return;
      }
      const actingUserRecord = await TenantUserRoleModel.findOne({ tenantId, userId: actingUserId }).lean();
      const actingRole = actingUserRecord?.role as string | undefined;
      for (const [role, limitValue] of Object.entries(limits)) {
        if (!TenantAssignableRoles.includes(role as typeof TenantAssignableRoles[number])) {
          res.status(400).json({ message: `Invalid role: ${role}` });
          return;
        }
        if (role === actingRole) {
          res.status(403).json({ message: "You cannot modify your own role's approval limit." });
          return;
        }
        if (limitValue !== null) {
          if (typeof limitValue !== "number" || !Number.isInteger(limitValue) || limitValue <= 0) {
            res.status(400).json({ message: `Approval limit for ${role} must be a positive integer (in minor units) or null for unlimited.` });
            return;
          }
        }
      }
      for (const [role, limitValue] of Object.entries(limits)) {
        await TenantUserRoleModel.updateMany(
          { tenantId, role },
          { $set: { "capabilities.approvalLimitMinor": limitValue } }
        );
      }
      res.json({ updated: true });
    } catch (error) {
      next(error);
    }
  });

  router.get(INVOICE_URL_PATHS.adminApprovalWorkflow, requireCap("canConfigureWorkflow"), async (req, res, next) => {
    try {
      const config = await workflowService.getWorkflowConfig(getAuth(req).tenantId);
      res.json(config ?? { enabled: false, mode: "simple", simpleConfig: { requireManagerReview: false, requireFinalSignoff: false }, steps: [] });
    } catch (error) {
      next(error);
    }
  });

  router.put(INVOICE_URL_PATHS.adminApprovalWorkflow, requireCap("canConfigureWorkflow"), async (req, res, next) => {
    try {
      const context = getAuth(req);
      const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : false;
      const mode = req.body?.mode === "advanced" ? "advanced" as const : "simple" as const;
      const simpleConfig = {
        requireManagerReview: typeof req.body?.simpleConfig?.requireManagerReview === "boolean" ? req.body.simpleConfig.requireManagerReview : false,
        requireFinalSignoff: typeof req.body?.simpleConfig?.requireFinalSignoff === "boolean" ? req.body.simpleConfig.requireFinalSignoff : false
      };
      const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];

      if (mode === "advanced") {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const conditionError = validateStepCondition(step?.condition);
          if (conditionError) {
            res.status(400).json({ message: `Step ${i + 1}: ${conditionError}` });
            return;
          }
        }
      }

      const activeClientOrgId = req.activeClientOrgId!;
      const previousConfig = await workflowService.getWorkflowConfig(context.tenantId);
      const newConfig = { enabled, mode, simpleConfig, steps };

      const result = await workflowService.saveWorkflowConfig(
        context.tenantId,
        activeClientOrgId,
        newConfig,
        context.userId
      );

      AuditLogModel.create({
        tenantId: context.tenantId,
        userId: context.userId,
        entityType: "config",
        entityId: context.tenantId,
        action: "approval_workflow_updated",
        previousValue: previousConfig,
        newValue: result,
      }).catch((err) => {
        logger.error("audit_log.write_failed", { error: String(err), tenantId: context.tenantId });
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post(INVOICE_URL_PATHS.workflowApprove, requireCap("canApproveInvoices"), async (req, res, next) => {
    try {
      const result = await workflowService.approveStep(req.params.id, getAuth(req));
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post(INVOICE_URL_PATHS.workflowReject, requireCap("canApproveInvoices"), async (req, res, next) => {
    try {
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) {
        res.status(400).json({ message: "Rejection reason is required." });
        return;
      }
      await workflowService.rejectStep(req.params.id, reason, getAuth(req));
      res.json({ rejected: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
