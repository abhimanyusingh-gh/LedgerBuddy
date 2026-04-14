import { Router } from "express";
import { TdsRateTableModel } from "../../models/compliance/TdsRateTable.js";
import { requirePlatformAdmin } from "../../auth/middleware.js";
import { requireAuth } from "../../auth/requireAuth.js";
import { requireCap } from "../../auth/requireCapability.js";

export function createTdsRatesRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/compliance/tds-rates", async (_req, res, next) => {
    try {
      const items = await TdsRateTableModel.find({ effectiveTo: null, isActive: true }).sort({ section: 1 }).lean();
      res.json({ items });
    } catch (error) { next(error); }
  });

  router.put("/compliance/tds-rates/:section", requireCap("canConfigureTdsMappings"), async (req, res, next) => {
    try {
      const section = req.params.section;
      const now = new Date();

      const current = await TdsRateTableModel.findOne({ section, effectiveTo: null, isActive: true });
      if (!current) { res.status(404).json({ message: `No active TDS rate found for section "${section}".` }); return; }

      current.effectiveTo = now;
      await current.save();

      const newRate = await TdsRateTableModel.create({
        section,
        description: current.description,
        rateCompanyBps: req.body.rateCompanyBps ?? current.rateCompanyBps,
        rateIndividualBps: req.body.rateIndividualBps ?? current.rateIndividualBps,
        rateNoPanBps: req.body.rateNoPanBps ?? current.rateNoPanBps,
        thresholdSingleMinor: req.body.thresholdSingleMinor ?? current.thresholdSingleMinor,
        thresholdAnnualMinor: req.body.thresholdAnnualMinor ?? current.thresholdAnnualMinor,
        effectiveFrom: now,
        effectiveTo: null,
        isActive: true
      });

      res.json(newRate.toObject());
    } catch (error) { next(error); }
  });

  return router;
}
