import { Router } from "express";
import { TenantExportConfigModel } from "@/models/integration/TenantExportConfig.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";
import { getAuth } from "@/types/auth.js";

const VALID_CSV_COLUMN_KEYS = new Set([
  "invoiceNumber", "vendorName", "invoiceDate", "dueDate",
  "total", "currency", "tdsSection", "tdsAmount", "tdsNetPayable",
  "glCode", "costCenter", "cgst", "sgst", "igst", "cess", "pan", "gstin"
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCsvColumns(columns: unknown): string | null {
  if (!Array.isArray(columns)) return "csvColumns must be an array.";
  if (columns.length === 0) return null;
  if (columns.length > 50) return "csvColumns cannot exceed 50 entries.";

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (typeof col !== "object" || col === null) return `csvColumns[${i}] must be an object.`;
    const c = col as Record<string, unknown>;
    if (!isNonEmptyString(c.key)) return `csvColumns[${i}].key is required.`;
    if (!VALID_CSV_COLUMN_KEYS.has(c.key)) return `csvColumns[${i}].key "${c.key}" is not a valid column key.`;
    if (!isNonEmptyString(c.label)) return `csvColumns[${i}].label is required.`;
  }

  return null;
}

export function createTenantExportConfigRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/tenant/:tenantId/export-config", requireCap("canExportToTally"), async (req, res, next) => {
    try {
      const auth = getAuth(req);
      if (auth.tenantId !== req.params.tenantId) {
        res.status(403).json({ message: "Access denied to this tenant." });
        return;
      }

      const config = await TenantExportConfigModel.findOne({ tenantId: auth.tenantId }).lean();
      res.json(config ?? {});
    } catch (error) { next(error); }
  });

  router.patch("/tenant/:tenantId/export-config", requireCap("canConfigureWorkflow"), async (req, res, next) => {
    try {
      const auth = getAuth(req);
      if (auth.tenantId !== req.params.tenantId) {
        res.status(403).json({ message: "Access denied to this tenant." });
        return;
      }

      const update: Record<string, unknown> = {};

      if (isNonEmptyString(req.body.tallyCompanyName)) update.tallyCompanyName = req.body.tallyCompanyName.trim();
      if (req.body.tallyCompanyName === null) update.tallyCompanyName = undefined;

      if (isNonEmptyString(req.body.tallyPurchaseLedger)) update.tallyPurchaseLedger = req.body.tallyPurchaseLedger.trim();
      if (req.body.tallyPurchaseLedger === null) update.tallyPurchaseLedger = undefined;

      if (isNonEmptyString(req.body.tallyCgstLedger)) update.tallyCgstLedger = req.body.tallyCgstLedger.trim();
      if (req.body.tallyCgstLedger === null) update.tallyCgstLedger = undefined;

      if (isNonEmptyString(req.body.tallySgstLedger)) update.tallySgstLedger = req.body.tallySgstLedger.trim();
      if (req.body.tallySgstLedger === null) update.tallySgstLedger = undefined;

      if (isNonEmptyString(req.body.tallyIgstLedger)) update.tallyIgstLedger = req.body.tallyIgstLedger.trim();
      if (req.body.tallyIgstLedger === null) update.tallyIgstLedger = undefined;

      if (isNonEmptyString(req.body.tallyCessLedger)) update.tallyCessLedger = req.body.tallyCessLedger.trim();
      if (req.body.tallyCessLedger === null) update.tallyCessLedger = undefined;

      if (isNonEmptyString(req.body.tallyTdsLedger)) update.tallyTdsLedger = req.body.tallyTdsLedger.trim();
      if (req.body.tallyTdsLedger === null) update.tallyTdsLedger = undefined;

      if (isNonEmptyString(req.body.tallyTcsLedger)) update.tallyTcsLedger = req.body.tallyTcsLedger.trim();
      if (req.body.tallyTcsLedger === null) update.tallyTcsLedger = undefined;

      if (req.body.csvColumns !== undefined) {
        if (req.body.csvColumns === null) {
          update.csvColumns = [];
        } else {
          const err = validateCsvColumns(req.body.csvColumns);
          if (err) {
            res.status(400).json({ message: err });
            return;
          }
          update.csvColumns = req.body.csvColumns;
        }
      }

      if (Object.keys(update).length === 0) {
        res.status(400).json({ message: "No valid fields provided for update." });
        return;
      }

      const config = await TenantExportConfigModel.findOneAndUpdate(
        { tenantId: auth.tenantId },
        { $set: { tenantId: auth.tenantId, ...update } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      res.json(config!.toObject());
    } catch (error) { next(error); }
  });

  return router;
}
