import { getAuth } from "../../types/auth.js";
import { Router } from "express";
import { requireCap } from "../../auth/requireCapability.js";
import { BankAccountModel } from "../../models/bank/BankAccount.js";
import type { IBankConnectionService } from "../../services/bank/anumati/IBankConnectionService.js";

export function createBankAccountsRouter(bankService: IBankConnectionService) {
  const router = Router();

  router.get("/bank/accounts", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const { tenantId } = getAuth(req);
      const accounts = await BankAccountModel.find({ tenantId }).sort({ createdAt: -1 }).lean();
      res.json({
        items: accounts.map((a) => ({
          _id: a._id.toString(),
          tenantId: a.tenantId,
          status: a.status,
          aaAddress: a.aaAddress,
          displayName: a.displayName,
          bankName: a.bankName,
          maskedAccNumber: a.maskedAccNumber,
          balanceMinor: a.balanceMinor,
          currency: a.currency,
          balanceFetchedAt: a.balanceFetchedAt,
          lastErrorReason: a.lastErrorReason,
          createdAt: a.createdAt
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bank/accounts", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const { tenantId, userId } = getAuth(req);
      const aaAddress = typeof req.body?.aaAddress === "string" ? req.body.aaAddress.trim() : "";
      const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";

      if (!aaAddress) {
        res.status(400).json({ message: "aaAddress is required." });
        return;
      }

      const account = await BankAccountModel.create({
        tenantId,
        createdByUserId: userId,
        aaAddress,
        displayName: displayName || aaAddress,
        status: "pending_consent"
      });

      const result = await bankService.initiateConsent({
        tenantId,
        userId,
        aaAddress,
        displayName: displayName || aaAddress,
        bankAccountId: account._id.toString()
      });

      res.status(201).json({ _id: account._id.toString(), redirectUrl: result.redirectUrl });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/bank/accounts/:id", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const { tenantId } = getAuth(req);
      const account = await BankAccountModel.findOne({ _id: req.params.id, tenantId });
      if (!account) {
        res.status(404).json({ message: "Bank account not found." });
        return;
      }
      await bankService.revokeConsent(account._id.toString());
      await BankAccountModel.deleteOne({ _id: account._id });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/bank/accounts/:id/refresh", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const { tenantId } = getAuth(req);
      const account = await BankAccountModel.findOne({ _id: req.params.id, tenantId });
      if (!account) {
        res.status(404).json({ message: "Bank account not found." });
        return;
      }
      const result = await bankService.fetchFiData(account._id.toString());
      res.json({
        balanceMinor: result.balanceMinor,
        bankName: result.bankName,
        maskedAccNumber: result.maskedAccNumber,
        balanceFetchedAt: result.balanceFetchedAt
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
