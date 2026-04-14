import { Router } from "express";
import { TenantComplianceConfigModel } from "../models/integration/TenantComplianceConfig.js";
import { requireAuth } from "../auth/requireAuth.js";
import { requireCap } from "../auth/requireCapability.js";

const VALID_PAN_LEVELS = new Set(["format", "format_and_checksum", "disabled"]);

const TDS_SECTION_PATTERN = /^[0-9]{3}[A-Z]{0,3}(\([a-z]\))?$/;

const DEFAULT_TDS_SECTIONS = [
  { section: "194C", description: "Contractor payments", rateIndividual: 100, rateCompany: 200, rateNoPan: 2000, threshold: 3000000, active: true },
  { section: "194J", description: "Professional/Technical fees", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 3000000, active: true },
  { section: "194H", description: "Commission/Brokerage", rateIndividual: 500, rateCompany: 500, rateNoPan: 2000, threshold: 1500000, active: true },
  { section: "194I(a)", description: "Rent - Plant & Machinery", rateIndividual: 200, rateCompany: 200, rateNoPan: 2000, threshold: 24000000, active: true },
  { section: "194I(b)", description: "Rent - Land/Building/Furniture", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 24000000, active: true },
  { section: "194A", description: "Interest other than securities", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 500000, active: true },
  { section: "194Q", description: "Purchase of goods", rateIndividual: 10, rateCompany: 10, rateNoPan: 500, threshold: 500000000, active: true }
];

const AVAILABLE_RISK_SIGNALS = [
  { code: "PAN_FORMAT_INVALID", description: "PAN format is invalid", category: "compliance" },
  { code: "PAN_GSTIN_MISMATCH", description: "PAN does not match GSTIN cross-reference", category: "compliance" },
  { code: "TDS_NO_PAN_PENALTY_RATE", description: "No PAN available - penalty TDS rate applies", category: "compliance" },
  { code: "TDS_SECTION_AMBIGUOUS", description: "Multiple TDS sections could apply", category: "compliance" },
  { code: "TDS_BELOW_THRESHOLD", description: "Invoice amount below TDS threshold", category: "compliance" },
  { code: "TOTAL_AMOUNT_ABOVE_EXPECTED", description: "Total amount exceeds expected maximum", category: "financial" },
  { code: "TOTAL_AMOUNT_BELOW_MINIMUM", description: "Total amount is unusually low", category: "financial" },
  { code: "DUE_DATE_TOO_FAR", description: "Due date is unusually far in the future", category: "data-quality" },
  { code: "MISSING_MANDATORY_FIELDS", description: "Required fields are missing from invoice", category: "data-quality" },
  { code: "DUPLICATE_INVOICE", description: "Possible duplicate of an existing invoice", category: "data-quality" },
  { code: "VENDOR_BANK_CHANGED", description: "Vendor bank details have changed recently", category: "financial" },
  { code: "MSME_OVERDUE", description: "Payment to MSME vendor is overdue", category: "compliance" },
  { code: "MISSING_IRN", description: "Invoice Reference Number (IRN) is missing", category: "compliance" },
  { code: "GSTIN_INVALID", description: "GSTIN format is invalid", category: "compliance" }
];

const ALL_RISK_SIGNAL_CODES = new Set(AVAILABLE_RISK_SIGNALS.map((s) => s.code));

interface TdsRateEntry {
  section: string;
  description: string;
  rateIndividual: number;
  rateCompany: number;
  rateNoPan: number;
  threshold: number;
  active: boolean;
}

function validateTdsRate(entry: unknown, index: number): string | null {
  if (typeof entry !== "object" || entry === null) return `tdsRates[${index}] must be an object.`;
  const e = entry as Record<string, unknown>;

  if (typeof e.section !== "string" || e.section.trim().length === 0) return `tdsRates[${index}].section is required.`;
  if (!TDS_SECTION_PATTERN.test(e.section)) return `tdsRates[${index}].section "${e.section}" is not a valid TDS section format.`;
  if (typeof e.description !== "string" || e.description.trim().length === 0) return `tdsRates[${index}].description is required.`;

  for (const field of ["rateIndividual", "rateCompany", "rateNoPan"] as const) {
    if (typeof e[field] !== "number" || !Number.isInteger(e[field]) || (e[field] as number) < 0 || (e[field] as number) > 10000) {
      return `tdsRates[${index}].${field} must be an integer between 0 and 10000 (basis points).`;
    }
  }

  if (typeof e.threshold !== "number" || !Number.isInteger(e.threshold) || (e.threshold as number) < 0) {
    return `tdsRates[${index}].threshold must be a non-negative integer (minor units).`;
  }

  if (typeof e.active !== "boolean") return `tdsRates[${index}].active must be a boolean.`;
  return null;
}

function applyDefaults(config: Record<string, unknown>): Record<string, unknown> {
  if (config.tdsEnabled === undefined) config.tdsEnabled = false;
  if (config.panValidationEnabled === undefined) config.panValidationEnabled = false;
  if (config.panValidationLevel === undefined) config.panValidationLevel = "disabled";
  if (config.riskSignalsEnabled === undefined) config.riskSignalsEnabled = false;
  if (!config.tdsRates || (Array.isArray(config.tdsRates) && config.tdsRates.length === 0)) {
    config.tdsRates = DEFAULT_TDS_SECTIONS;
  }
  if (!config.activeRiskSignals || (Array.isArray(config.activeRiskSignals) && config.activeRiskSignals.length === 0)) {
    config.activeRiskSignals = AVAILABLE_RISK_SIGNALS.map((s) => s.code);
  }
  return config;
}

export function createTenantComplianceConfigRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/admin/compliance-config", requireCap("canConfigureCompliance"), async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      let config = await TenantComplianceConfigModel.findOne({ tenantId }).lean();

      if (!config) {
        const defaults = applyDefaults({ tenantId });
        const created = await TenantComplianceConfigModel.create(defaults);
        res.json(applyDefaults({ ...created.toObject() }));
        return;
      }

      res.json(applyDefaults({ ...config }));
    } catch (error) { next(error); }
  });

  router.put("/admin/compliance-config", requireCap("canConfigureCompliance"), async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const update: Record<string, unknown> = {};

      if (typeof req.body.complianceEnabled === "boolean") update.complianceEnabled = req.body.complianceEnabled;
      if (typeof req.body.autoSuggestGlCodes === "boolean") update.autoSuggestGlCodes = req.body.autoSuggestGlCodes;
      if (typeof req.body.autoDetectTds === "boolean") update.autoDetectTds = req.body.autoDetectTds;
      if (typeof req.body.tdsEnabled === "boolean") update.tdsEnabled = req.body.tdsEnabled;

      if (Array.isArray(req.body.tdsRates)) {
        for (let i = 0; i < req.body.tdsRates.length; i++) {
          const err = validateTdsRate(req.body.tdsRates[i], i);
          if (err) { res.status(400).json({ message: err }); return; }
        }

        const sections = req.body.tdsRates.map((e: TdsRateEntry) => e.section);
        const uniqueSections = new Set(sections);
        if (uniqueSections.size !== sections.length) {
          res.status(400).json({ message: "Duplicate TDS sections are not allowed." });
          return;
        }

        update.tdsRates = req.body.tdsRates;
      }

      if (typeof req.body.panValidationEnabled === "boolean") update.panValidationEnabled = req.body.panValidationEnabled;

      if (req.body.panValidationLevel !== undefined) {
        if (!VALID_PAN_LEVELS.has(req.body.panValidationLevel)) {
          res.status(400).json({ message: `panValidationLevel must be one of: ${[...VALID_PAN_LEVELS].join(", ")}` });
          return;
        }
        update.panValidationLevel = req.body.panValidationLevel;
      }

      if (typeof req.body.riskSignalsEnabled === "boolean") update.riskSignalsEnabled = req.body.riskSignalsEnabled;

      if (Array.isArray(req.body.activeRiskSignals)) {
        const invalid = (req.body.activeRiskSignals as string[]).filter((c) => !ALL_RISK_SIGNAL_CODES.has(c));
        if (invalid.length > 0) {
          res.status(400).json({ message: `Unknown risk signal codes: ${invalid.join(", ")}` });
          return;
        }
        update.activeRiskSignals = req.body.activeRiskSignals;
      }

      if (Array.isArray(req.body.enabledSignals)) update.enabledSignals = req.body.enabledSignals;
      if (Array.isArray(req.body.disabledSignals)) update.disabledSignals = req.body.disabledSignals;
      if (typeof req.body.signalSeverityOverrides === "object" && req.body.signalSeverityOverrides !== null) {
        update.signalSeverityOverrides = req.body.signalSeverityOverrides;
      }
      if (req.body.defaultTdsSection !== undefined) update.defaultTdsSection = req.body.defaultTdsSection || null;

      update.updatedBy = req.authContext!.email || req.authContext!.userId;

      const existing = await TenantComplianceConfigModel.findOne({ tenantId }).lean();
      const effectiveTds = update.tdsEnabled !== undefined ? update.tdsEnabled : existing?.tdsEnabled;
      const effectiveRisk = update.riskSignalsEnabled !== undefined ? update.riskSignalsEnabled : existing?.riskSignalsEnabled;
      const effectivePan = update.panValidationEnabled !== undefined ? update.panValidationEnabled : existing?.panValidationEnabled;
      update.complianceEnabled = !!(effectiveTds || effectiveRisk || effectivePan);

      const config = await TenantComplianceConfigModel.findOneAndUpdate(
        { tenantId },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      res.json(config!.toObject());
    } catch (error) { next(error); }
  });

  router.get("/compliance/tds-sections", async (_req, res) => {
    res.json({ items: DEFAULT_TDS_SECTIONS });
  });

  router.get("/compliance/risk-signals", async (_req, res) => {
    res.json({ items: AVAILABLE_RISK_SIGNALS });
  });

  return router;
}
