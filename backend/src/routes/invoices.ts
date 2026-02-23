import { Router } from "express";
import {
  InvoiceUpdateError,
  type InvoiceService,
  type UpdateParsedFieldInput
} from "../services/invoiceService.js";
import type { WorkloadTier } from "../types/tenant.js";

export function createInvoiceRouter(invoiceService: InvoiceService) {
  const router = Router();

  router.get("/invoices", async (req, res, next) => {
    try {
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
      const workloadTier = parseWorkloadTier(req.query.workloadTier);

      const result = await invoiceService.listInvoices({ page, limit, status, tenantId, workloadTier });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/invoices/:id", async (req, res, next) => {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      res.json(invoice);
    } catch (error) {
      next(error);
    }
  });

  router.post("/invoices/approve", async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isString) : [];
      const approvedBy = typeof req.body?.approvedBy === "string" ? req.body.approvedBy : undefined;

      if (ids.length === 0) {
        res.status(400).json({ message: "Body 'ids' must include at least one invoice id." });
        return;
      }

      const modifiedCount = await invoiceService.approveInvoices(ids, approvedBy);
      res.json({ modifiedCount });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/invoices/:id", async (req, res, next) => {
    try {
      const parsedInput = isRecord(req.body?.parsed) ? req.body.parsed : {};
      const updatedBy = typeof req.body?.updatedBy === "string" ? req.body.updatedBy : undefined;
      const updatedInvoice = await invoiceService.updateInvoiceParsedFields(
        req.params.id,
        parsedInput as UpdateParsedFieldInput,
        updatedBy
      );
      res.json(updatedInvoice);
    } catch (error) {
      if (error instanceof InvoiceUpdateError) {
        res.status(error.statusCode).json({ message: error.message });
        return;
      }

      next(error);
    }
  });

  return router;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkloadTier(value: unknown): WorkloadTier | undefined {
  if (value === "standard" || value === "heavy") {
    return value;
  }
  return undefined;
}
