import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import { requireCap } from "@/auth/requireCapability.js";
import { BankAccountModel } from "@/models/bank/BankAccount.js";
import type { IBankConnectionService } from "@/services/bank/anumati/IBankConnectionService.js";
import { BANK_ACCOUNT_STATUS } from "@/types/bankAccount.js";

export function createBankAccountsRouter(bankService: IBankConnectionService) {
  const router = Router();

  router.get(
    "/bank/accounts",
    requireCap("canManageConnections"),
    async (req, res, next) => {
      try {
        const { tenantId } = getAuth(req);
        const accounts = await BankAccountModel.find({
          tenantId,
          clientOrgId: req.activeClientOrgId
        })
          .sort({ createdAt: -1 })
          .lean();
        res.json({
          items: accounts.map((a) => ({
            _id: a._id.toString(),
            clientOrgId: String(a.clientOrgId),
            status: a.status,
            aaAddress: a.aaAddress,
            displayName: a.displayName,
            accountNumber: a.accountNumber,
            bankName: a.bankName,
            ifsc: a.ifsc,
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
    }
  );

  router.post(
    "/bank/accounts",
    requireCap("canManageConnections"),
    async (req, res, next) => {
      try {
        const { tenantId, userId } = getAuth(req);
        const aaAddress = typeof req.body?.aaAddress === "string" ? req.body.aaAddress.trim() : "";
        const displayName = typeof req.body?.displayName === "string" ? req.body.displayName.trim() : "";
        const accountNumber = typeof req.body?.accountNumber === "string" ? req.body.accountNumber.trim() : "";
        const bankName = typeof req.body?.bankName === "string" ? req.body.bankName.trim() : "";
        const ifsc = typeof req.body?.ifsc === "string" ? req.body.ifsc.trim().toUpperCase() : "";

        if (!aaAddress) {
          res.status(400).json({ message: "aaAddress is required." });
          return;
        }
        if (!accountNumber) {
          res.status(400).json({ message: "accountNumber is required." });
          return;
        }
        if (!bankName) {
          res.status(400).json({ message: "bankName is required." });
          return;
        }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
          res.status(400).json({ message: "ifsc must be 11-char format (4 letters + 0 + 6 alphanumerics)." });
          return;
        }

        const account = await BankAccountModel.create({
          tenantId,
          clientOrgId: req.activeClientOrgId,
          createdByUserId: userId,
          aaAddress,
          displayName: displayName || aaAddress,
          accountNumber,
          bankName,
          ifsc,
          status: BANK_ACCOUNT_STATUS.PENDING_CONSENT
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
    }
  );

  router.delete(
    "/bank/accounts/:id",
    requireCap("canManageConnections"),
    async (req, res, next) => {
      try {
        const { tenantId } = getAuth(req);
        const account = await BankAccountModel.findOne({
          _id: req.params.id,
          tenantId,
          clientOrgId: req.activeClientOrgId
        });
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
    }
  );

  router.post(
    "/bank/accounts/:id/refresh",
    requireCap("canManageConnections"),
    async (req, res, next) => {
      try {
        const { tenantId } = getAuth(req);
        const account = await BankAccountModel.findOne({
          _id: req.params.id,
          tenantId,
          clientOrgId: req.activeClientOrgId
        });
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
    }
  );

  return router;
}
