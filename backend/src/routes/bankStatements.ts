import { getAuth } from "../types/auth.js";
import { Router } from "express";
import multer from "multer";
import { BankStatementModel } from "../models/BankStatement.js";
import { BankTransactionModel } from "../models/BankTransaction.js";
import { BankStatementParser } from "../services/reconciliation/BankStatementParser.js";
import { ReconciliationService } from "../services/reconciliation/ReconciliationService.js";
import { requireAuth } from "../auth/requireAuth.js";
import { requireCap } from "../auth/requireCapability.js";
import { requireNotViewer } from "../auth/middleware.js";
import type { FileStore } from "../core/interfaces/FileStore.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const parser = new BankStatementParser();
const reconciler = new ReconciliationService();

export function createBankStatementsRouter(fileStore?: FileStore) {
  const router = Router();
  router.use(requireAuth);

  router.get("/bank-statements", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const items = await BankStatementModel.find({ tenantId }).sort({ createdAt: -1 }).lean();
      res.json({ items });
    } catch (error) { next(error); }
  });

  router.get("/bank-statements/:id/transactions", requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
      const skip = (page - 1) * limit;

      const query: Record<string, unknown> = { tenantId, statementId: req.params.id };
      if (typeof req.query.status === "string") query.matchStatus = req.query.status;

      const [items, total] = await Promise.all([
        BankTransactionModel.find(query).sort({ date: -1 }).skip(skip).limit(limit).lean(),
        BankTransactionModel.countDocuments(query)
      ]);

      res.json({ items, page, limit, total });
    } catch (error) { next(error); }
  });

  router.post("/bank-statements/upload-csv", requireNotViewer, requireCap("canManageConnections"), upload.single("file") as unknown as import("express").RequestHandler, async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const file = req.file;
      if (!file) { res.status(400).json({ message: "CSV file is required." }); return; }

      const csvContent = file.buffer.toString("utf-8");
      const mapping = req.body.columnMapping ? JSON.parse(req.body.columnMapping) : { date: 0, description: 1, debit: 2, credit: 3 };

      const result = await parser.parseCsv(
        tenantId,
        file.originalname,
        csvContent,
        mapping,
        getAuth(req).email
      );

      if (fileStore) {
        const s3Key = `bank-statements/${tenantId}/${result.statementId}/${file.originalname}`;
        await fileStore.putObject({ key: s3Key, body: file.buffer, contentType: "text/csv" });
        await BankStatementModel.updateOne({ _id: result.statementId }, { $set: { s3Key } });
      }

      const reconciliation = await reconciler.reconcileStatement(tenantId, result.statementId);

      res.status(201).json({
        statementId: result.statementId,
        transactionCount: result.transactionCount,
        duplicatesSkipped: result.duplicatesSkipped,
        ...reconciliation
      });
    } catch (error) { next(error); }
  });

  router.post("/bank-statements/:id/reconcile", requireNotViewer, requireCap("canManageConnections"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const result = await reconciler.reconcileStatement(tenantId, req.params.id);
      res.json(result);
    } catch (error) { next(error); }
  });

  router.post("/bank-statements/transactions/:txnId/match", requireNotViewer, requireCap("canApproveInvoices"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const invoiceId = req.body.invoiceId;
      if (!invoiceId) { res.status(400).json({ message: "invoiceId is required." }); return; }

      await reconciler.manualMatch(tenantId, req.params.txnId, invoiceId);
      res.json({ matched: true });
    } catch (error) { next(error); }
  });

  router.delete("/bank-statements/transactions/:txnId/match", requireNotViewer, requireCap("canApproveInvoices"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      await reconciler.unmatch(tenantId, req.params.txnId);
      res.json({ unmatched: true });
    } catch (error) { next(error); }
  });

  return router;
}
