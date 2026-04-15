import { Router } from "express";
import { getAuth } from "@/types/auth.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";
import { ExtractionMappingModel, EXTRACTION_MAPPING_MATCH_TYPE, EXTRACTION_MAPPING_SOURCE } from "@/models/invoice/ExtractionMapping.js";
import type { ExtractionMappingMatchType } from "@/models/invoice/ExtractionMapping.js";
import { toValidObjectId } from "@/utils/validation.js";

const VALID_MATCH_TYPES = Object.values(EXTRACTION_MAPPING_MATCH_TYPE);

export function createExtractionMappingsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/admin/extraction-mappings", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
      const skip = (page - 1) * limit;

      const query: Record<string, unknown> = { tenantId };
      if (typeof req.query.matchType === "string" && (VALID_MATCH_TYPES as readonly string[]).includes(req.query.matchType)) {
        query.matchType = req.query.matchType;
      }

      const [items, total] = await Promise.all([
        ExtractionMappingModel.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
        ExtractionMappingModel.countDocuments(query)
      ]);

      res.json({ items, total, page, limit });
    } catch (error) { next(error); }
  });

  router.post("/admin/extraction-mappings", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const { matchType, matchKey, canonicalVendorName, fieldOverrides } = req.body ?? {};

      if (!(VALID_MATCH_TYPES as readonly string[]).includes(matchType)) {
        res.status(400).json({ message: "matchType must be 'gstin' or 'vendorNameFuzzy'." });
        return;
      }
      if (typeof matchKey !== "string" || !matchKey.trim()) {
        res.status(400).json({ message: "matchKey is required." });
        return;
      }

      const existing = await ExtractionMappingModel.findOne({ tenantId, matchType, matchKey: matchKey.trim() });
      if (existing) {
        res.status(409).json({ message: "A mapping with this matchType and matchKey already exists." });
        return;
      }

      const createdBy = getAuth(req).userId;
      const doc = await ExtractionMappingModel.create({
        tenantId,
        matchType,
        matchKey: matchKey.trim(),
        canonicalVendorName: typeof canonicalVendorName === "string" ? canonicalVendorName.trim() || undefined : undefined,
        fieldOverrides: fieldOverrides && typeof fieldOverrides === "object" ? fieldOverrides : undefined,
        createdBy,
        source: EXTRACTION_MAPPING_SOURCE.MANUAL
      });

      res.status(201).json(doc.toObject());
    } catch (error) { next(error); }
  });

  router.patch("/admin/extraction-mappings/:id", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      if (!toValidObjectId(req.params.id)) {
        res.status(400).json({ message: "Invalid mapping id." });
        return;
      }

      const update: Record<string, unknown> = {};
      if (typeof req.body.canonicalVendorName === "string") {
        update.canonicalVendorName = req.body.canonicalVendorName.trim() || undefined;
      }
      if (req.body.fieldOverrides && typeof req.body.fieldOverrides === "object") {
        update.fieldOverrides = req.body.fieldOverrides;
      }

      const doc = await ExtractionMappingModel.findOneAndUpdate(
        { _id: req.params.id, tenantId },
        { $set: update },
        { new: true }
      ).lean();

      if (!doc) {
        res.status(404).json({ message: "Mapping not found." });
        return;
      }

      res.json(doc);
    } catch (error) { next(error); }
  });

  router.delete("/admin/extraction-mappings/:id", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      if (!toValidObjectId(req.params.id)) {
        res.status(400).json({ message: "Invalid mapping id." });
        return;
      }

      const doc = await ExtractionMappingModel.findOneAndDelete({ _id: req.params.id, tenantId });
      if (!doc) {
        res.status(404).json({ message: "Mapping not found." });
        return;
      }

      res.status(204).send();
    } catch (error) { next(error); }
  });

  return router;
}
