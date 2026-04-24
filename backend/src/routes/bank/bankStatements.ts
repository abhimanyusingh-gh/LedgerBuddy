import { Router } from "express";
import multer from "multer";
import { BankStatementModel, type BankStatement } from "@/models/bank/BankStatement.js";
import { BankTransactionModel, BANK_TRANSACTION_MATCH_STATUS, type BankTransactionMatchStatus } from "@/models/bank/BankTransaction.js";
import { BankStatementExtractionPipeline } from "@/ai/extractors/bank/BankStatementExtractionPipeline.js";
import { BankStatementParseProgress } from "@/ai/extractors/bank/BankStatementParseProgress.js";
import { ReconciliationService } from "@/services/bank/ReconciliationService.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireActiveClientOrg } from "@/auth/activeClientOrg.js";
import { requireCap } from "@/auth/requireCapability.js";
import { requireNotViewer } from "@/auth/middleware.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import type { OcrProvider } from "@/core/interfaces/OcrProvider.js";
import type { FieldVerifier } from "@/core/interfaces/FieldVerifier.js";
import { DOCUMENT_MIME_TYPE, EXPORT_CONTENT_TYPE, assertDocumentMimeType } from "@/types/mime.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const reconciler = new ReconciliationService();

const PDF_MIME_TYPES = new Set<string>([DOCUMENT_MIME_TYPE.PDF, DOCUMENT_MIME_TYPE.JPEG, "image/jpg", DOCUMENT_MIME_TYPE.PNG]);
const CSV_MIME_TYPES = new Set<string>([EXPORT_CONTENT_TYPE.CSV, "application/vnd.ms-excel"]);

function isDocumentMime(mimeType: string): boolean {
  return PDF_MIME_TYPES.has(mimeType);
}

function isCsvMime(mimeType: string): boolean {
  return CSV_MIME_TYPES.has(mimeType);
}

function detectMimeFromExtension(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "csv") return EXPORT_CONTENT_TYPE.CSV;
  if (ext === "pdf") return DOCUMENT_MIME_TYPE.PDF;
  if (ext === "jpg" || ext === "jpeg") return DOCUMENT_MIME_TYPE.JPEG;
  if (ext === "png") return DOCUMENT_MIME_TYPE.PNG;
  return null;
}

export function createBankStatementsRouter(
  fileStore?: FileStore,
  ocrProvider?: OcrProvider,
  fieldVerifier?: FieldVerifier
) {
  const parser = new BankStatementExtractionPipeline({ ocrProvider, fieldVerifier });
  const parseProgress = new BankStatementParseProgress();
  const router = Router();
  router.use(requireAuth);

  router.get("/bank-statements/parse/sse", (req, res) => {
    parseProgress.addSubscriber(req.authContext!.tenantId, res, req);
  });

  router.get("/bank-statements/vendor-gstins", requireActiveClientOrg, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const invoices = await InvoiceModel.find(
        { tenantId, clientOrgId: req.activeClientOrgId, "parsed.gst.gstin": { $exists: true, $nin: [null, ""] } },
        { "parsed.gst.gstin": 1, "parsed.vendorName": 1 }
      ).lean();

      const seen = new Map<string, string>();
      for (const inv of invoices) {
        const gstin = (inv.parsed as Record<string, unknown>)?.gst
          ? ((inv.parsed as Record<string, unknown>).gst as Record<string, unknown>)?.gstin as string
          : undefined;
        const vendor = (inv.parsed as Record<string, unknown>)?.vendorName as string ?? "";
        if (gstin && !seen.has(gstin)) {
          seen.set(gstin, vendor);
        }
      }

      const items = [...seen.entries()].map(([gstin, vendorName]) => ({
        gstin,
        vendorName,
        label: vendorName ? `${vendorName} (${gstin})` : gstin
      }));
      items.sort((a, b) => a.label.localeCompare(b.label));
      res.json({ items });
    } catch (error) { next(error); }
  });

  router.get("/bank-statements/account-names", requireActiveClientOrg, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const statements = await BankStatementModel.find(
        { tenantId, clientOrgId: req.activeClientOrgId, bankName: { $ne: null } },
        { bankName: 1, accountNumberMasked: 1 }
      ).lean();

      const seen = new Set<string>();
      const items: Array<{ bankName: string; accountNumberMasked: string; label: string }> = [];

      for (const s of statements) {
        if (!s.bankName) continue;
        const label = [s.bankName, s.accountNumberMasked].filter(Boolean).join(" ");
        if (seen.has(label)) continue;
        seen.add(label);
        items.push({
          bankName: s.bankName,
          accountNumberMasked: s.accountNumberMasked ?? "",
          label
        });
      }

      items.sort((a, b) => a.label.localeCompare(b.label));
      res.json({ items });
    } catch (error) { next(error); }
  });

  router.get("/bank-statements", requireActiveClientOrg, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 200);
      const skip = (page - 1) * limit;

      const query: Record<string, unknown> = { tenantId, clientOrgId: req.activeClientOrgId };

      if (typeof req.query.accountName === "string" && req.query.accountName) {
        const parts = req.query.accountName.split(" ");
        if (parts.length > 1) {
          query.bankName = parts.slice(0, -1).join(" ");
          query.accountNumberMasked = parts[parts.length - 1];
        } else {
          query.bankName = req.query.accountName;
        }
      }

      if (typeof req.query.periodFrom === "string" && req.query.periodFrom) {
        query.periodTo = { ...(query.periodTo as Record<string, unknown> ?? {}), $gte: req.query.periodFrom };
      }
      if (typeof req.query.periodTo === "string" && req.query.periodTo) {
        query.periodFrom = { ...(query.periodFrom as Record<string, unknown> ?? {}), $lte: req.query.periodTo };
      }

      const [items, total]: [BankStatement[], number] = await Promise.all([
        BankStatementModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        BankStatementModel.countDocuments(query)
      ]);

      res.json({ items, total, page, limit });
    } catch (error) { next(error); }
  });

  router.get("/bank-statements/:id/matches", requireActiveClientOrg, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;

      const { BankStatementModel } = await import("@/models/bank/BankStatement.js");
      const statement = await BankStatementModel.findOne({ _id: req.params.id, tenantId, clientOrgId: req.activeClientOrgId }).lean();
      if (!statement) { res.status(404).json({ message: "Bank statement not found." }); return; }

      const transactions = await BankTransactionModel.find(
        { tenantId, clientOrgId: req.activeClientOrgId, statementId: req.params.id }
      ).sort({ date: 1 }).lean();

      const invoiceIds = [...new Set(
        transactions.map((t) => t.matchedInvoiceId).filter((id): id is string => !!id)
      )];

      const invoiceMap = new Map<string, {
        _id: string;
        invoiceNumber: string | null;
        vendorName: string | null;
        totalAmountMinor: number | null;
        invoiceDate: string | null;
        status: string;
      }>();

      if (invoiceIds.length > 0) {
        const invoices = await InvoiceModel.find(
          { _id: { $in: invoiceIds }, tenantId, clientOrgId: req.activeClientOrgId },
          { "parsed.invoiceNumber": 1, "parsed.vendorName": 1, "parsed.totalAmountMinor": 1, "parsed.invoiceDate": 1, status: 1 }
        ).lean();
        for (const inv of invoices) {
          const parsed = inv.parsed as Record<string, unknown> | undefined;
          const rawDate = parsed?.invoiceDate;
          invoiceMap.set(String(inv._id), {
            _id: String(inv._id),
            invoiceNumber: (parsed?.invoiceNumber as string | null) ?? null,
            vendorName: (parsed?.vendorName as string | null) ?? null,
            totalAmountMinor: (parsed?.totalAmountMinor as number | null) ?? null,
            invoiceDate: rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : null,
            status: inv.status as string
          });
        }
      }

      let matched = 0;
      let suggested = 0;
      let unmatched = 0;

      const items = transactions.map((t) => {
        const status = (t.matchStatus ?? "unmatched") as BankTransactionMatchStatus;
        if (status === "matched" || status === "manual") matched++;
        else if (status === "suggested") suggested++;
        else unmatched++;
        return {
          _id: String(t._id),
          date: t.date,
          description: t.description,
          reference: t.reference ?? null,
          debitMinor: t.debitMinor ?? null,
          creditMinor: t.creditMinor ?? null,
          balanceMinor: t.balanceMinor ?? null,
          matchStatus: status,
          matchConfidence: t.matchConfidence ?? null,
          matchedInvoiceId: t.matchedInvoiceId ?? null,
          invoice: t.matchedInvoiceId ? (invoiceMap.get(t.matchedInvoiceId) ?? null) : null
        };
      });

      res.json({
        items,
        summary: { totalTransactions: transactions.length, matched, suggested, unmatched }
      });
    } catch (error) { next(error); }
  });

  router.get("/bank-statements/:id/transactions", requireActiveClientOrg, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
      const skip = (page - 1) * limit;

      const query: Record<string, unknown> = { tenantId, clientOrgId: req.activeClientOrgId, statementId: req.params.id };

      if (typeof req.query.status === "string" && (Object.values(BANK_TRANSACTION_MATCH_STATUS) as string[]).includes(req.query.status)) {
        query.matchStatus = req.query.status as BankTransactionMatchStatus;
      }
      if (typeof req.query.matchStatus === "string" && (Object.values(BANK_TRANSACTION_MATCH_STATUS) as string[]).includes(req.query.matchStatus)) {
        query.matchStatus = req.query.matchStatus as BankTransactionMatchStatus;
      }

      if (typeof req.query.dateFrom === "string" && req.query.dateFrom) {
        query.date = { ...(query.date as Record<string, unknown> ?? {}), $gte: new Date(req.query.dateFrom) };
      }
      if (typeof req.query.dateTo === "string" && req.query.dateTo) {
        query.date = { ...(query.date as Record<string, unknown> ?? {}), $lte: new Date(req.query.dateTo) };
      }

      if (typeof req.query.search === "string" && req.query.search) {
        const escaped = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = { $regex: escaped, $options: "i" };
        query.$or = [{ description: regex }, { reference: regex }];
      }

      const [items, total] = await Promise.all([
        BankTransactionModel.find(query).sort({ date: -1 }).skip(skip).limit(limit).lean(),
        BankTransactionModel.countDocuments(query)
      ]);

      res.json({ items, page, limit, total });
    } catch (error) { next(error); }
  });

  router.post("/bank-statements/upload-csv", requireNotViewer, requireCap("canManageConnections"), requireActiveClientOrg, upload.single("file") as unknown as import("express").RequestHandler, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const file = req.file;
      if (!file) { res.status(400).json({ message: "CSV file is required." }); return; }

      const csvContent = file.buffer.toString("utf-8");
      const mapping = req.body.columnMapping ? JSON.parse(req.body.columnMapping) : { date: 0, description: 1, debit: 2, credit: 3 };

      const result = await parser.parseCsv(
        tenantId,
        file.originalname,
        csvContent,
        mapping,
        req.authContext!.email
      );

      if (fileStore) {
        const s3Key = `bank-statements/${tenantId}/${result.statementId}/${file.originalname}`;
        await fileStore.putObject({ key: s3Key, body: file.buffer, contentType: EXPORT_CONTENT_TYPE.CSV });
        await BankStatementModel.updateOne({ _id: result.statementId }, { $set: { s3Key } });
      }

      const reconciliation = await reconciler.reconcileStatement(tenantId, req.activeClientOrgId!, result.statementId);

      res.status(201).json({
        statementId: result.statementId,
        transactionCount: result.transactionCount,
        duplicatesSkipped: result.duplicatesSkipped,
        ...reconciliation
      });
    } catch (error) { next(error); }
  });

  router.post("/bank-statements/upload", requireNotViewer, requireCap("canManageConnections"), requireActiveClientOrg, upload.single("file") as unknown as import("express").RequestHandler, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const file = req.file;
      if (!file) { res.status(400).json({ message: "File is required." }); return; }

      const mimeType = file.mimetype || detectMimeFromExtension(file.originalname) || "";

      if (isCsvMime(mimeType) || file.originalname.toLowerCase().endsWith(".csv")) {
        const csvContent = file.buffer.toString("utf-8");
        const mapping = req.body.columnMapping ? JSON.parse(req.body.columnMapping) : { date: 0, description: 1, debit: 2, credit: 3 };

        const result = await parser.parseCsv(
          tenantId,
          file.originalname,
          csvContent,
          mapping,
          req.authContext!.email
        );

        if (fileStore) {
          const s3Key = `bank-statements/${tenantId}/${result.statementId}/${file.originalname}`;
          await fileStore.putObject({ key: s3Key, body: file.buffer, contentType: EXPORT_CONTENT_TYPE.CSV });
          await BankStatementModel.updateOne({ _id: result.statementId }, { $set: { s3Key } });
        }

        const reconciliation = await reconciler.reconcileStatement(tenantId, req.activeClientOrgId!, result.statementId);

        res.status(201).json({
          statementId: result.statementId,
          transactionCount: result.transactionCount,
          duplicatesSkipped: result.duplicatesSkipped,
          ...reconciliation
        });
        return;
      }

      const resolvedMime = isDocumentMime(mimeType) ? mimeType : (detectMimeFromExtension(file.originalname) || mimeType);

      if (!isDocumentMime(resolvedMime)) {
        res.status(400).json({
          message: `Unsupported file type: ${mimeType}. Supported formats: CSV, PDF, JPEG, PNG.`
        });
        return;
      }

      const result = await parser.parsePdf(
        tenantId,
        file.originalname,
        file.buffer,
        assertDocumentMimeType(resolvedMime),
        req.authContext!.email,
        (event) => parseProgress.broadcast(tenantId, event)
      );

      if (fileStore) {
        const s3Key = `bank-statements/${tenantId}/${result.statementId}/${file.originalname}`;
        await fileStore.putObject({ key: s3Key, body: file.buffer, contentType: resolvedMime });
        await BankStatementModel.updateOne({ _id: result.statementId }, { $set: { s3Key } });
      }

      const reconciliation = await reconciler.reconcileStatement(tenantId, req.activeClientOrgId!, result.statementId);

      res.status(201).json({
        statementId: result.statementId,
        transactionCount: result.transactionCount,
        duplicatesSkipped: result.duplicatesSkipped,
        warnings: result.warnings,
        bankName: result.bankName,
        accountNumber: result.accountNumber,
        periodFrom: result.periodFrom,
        periodTo: result.periodTo,
        ...reconciliation
      });
    } catch (error) {
      const tenantId = req.authContext?.tenantId;
      if (tenantId) {
        parseProgress.broadcast(tenantId, {
          type: "error",
          message: error instanceof Error ? error.message : String(error)
        });
      }
      next(error);
    }
  });

  router.post("/bank-statements/:id/reconcile", requireNotViewer, requireCap("canManageConnections"), requireActiveClientOrg, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const result = await reconciler.reconcileStatement(tenantId, req.activeClientOrgId!, req.params.id);
      res.json(result);
    } catch (error) { next(error); }
  });

  router.post("/bank-statements/transactions/:txnId/match", requireNotViewer, requireCap("canApproveInvoices"), requireActiveClientOrg, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      const invoiceId = req.body.invoiceId;
      if (!invoiceId) { res.status(400).json({ message: "invoiceId is required." }); return; }

      await reconciler.manualMatch(tenantId, req.activeClientOrgId!, req.params.txnId, invoiceId);
      res.json({ matched: true });
    } catch (error) { next(error); }
  });

  router.delete("/bank-statements/transactions/:txnId/match", requireNotViewer, requireCap("canApproveInvoices"), requireActiveClientOrg, async (req, res, next) => {
    try {
      const tenantId = req.authContext!.tenantId;
      await reconciler.unmatch(tenantId, req.activeClientOrgId!, req.params.txnId);
      res.json({ unmatched: true });
    } catch (error) { next(error); }
  });

  return router;
}
