import { VendorTemplateModel } from "../../models/VendorTemplate.js";
import type { ParsedInvoiceData } from "../../types/invoice.js";
import { logger } from "../../utils/logger.js";

export interface VendorTemplateSnapshot {
  tenantId: string;
  fingerprintKey: string;
  layoutSignature: string;
  vendorName: string;
  currency?: string;
  invoicePrefix?: string;
  confidenceScore: number;
}

export interface VendorTemplateStore {
  findByFingerprint(tenantId: string, fingerprintKey: string): Promise<VendorTemplateSnapshot | undefined>;
  saveOrUpdate(template: VendorTemplateSnapshot): Promise<void>;
}

export class MongoVendorTemplateStore implements VendorTemplateStore {
  async findByFingerprint(tenantId: string, fingerprintKey: string): Promise<VendorTemplateSnapshot | undefined> {
    try {
      const template = await VendorTemplateModel.findOne({ tenantId, fingerprintKey }).lean();
      if (!template) {
        return undefined;
      }

      return {
        tenantId: template.tenantId,
        fingerprintKey: template.fingerprintKey,
        layoutSignature: template.layoutSignature,
        vendorName: template.vendorName,
        currency: template.currency ?? undefined,
        invoicePrefix: template.invoicePrefix ?? undefined,
        confidenceScore: template.confidenceScore
      };
    } catch (error) {
      logger.warn("vendor.template.lookup.failed", { tenantId, fingerprintKey, error: toErrorMessage(error) });
      return undefined;
    }
  }

  async saveOrUpdate(template: VendorTemplateSnapshot): Promise<void> {
    try {
      await VendorTemplateModel.findOneAndUpdate(
        { tenantId: template.tenantId, fingerprintKey: template.fingerprintKey },
        {
          $set: {
            tenantId: template.tenantId,
            fingerprintKey: template.fingerprintKey,
            layoutSignature: template.layoutSignature,
            vendorName: template.vendorName,
            currency: template.currency,
            invoicePrefix: template.invoicePrefix,
            confidenceScore: template.confidenceScore
          },
          $inc: { usageCount: 1 }
        },
        { upsert: true }
      );
    } catch (error) {
      logger.warn("vendor.template.persist.failed", {
        tenantId: template.tenantId,
        fingerprintKey: template.fingerprintKey,
        error: toErrorMessage(error)
      });
    }
  }
}

export class InMemoryVendorTemplateStore implements VendorTemplateStore {
  private readonly templates = new Map<string, VendorTemplateSnapshot>();

  async findByFingerprint(tenantId: string, fingerprintKey: string): Promise<VendorTemplateSnapshot | undefined> {
    return this.templates.get(`${tenantId}|${fingerprintKey}`);
  }

  async saveOrUpdate(template: VendorTemplateSnapshot): Promise<void> {
    this.templates.set(`${template.tenantId}|${template.fingerprintKey}`, template);
  }
}

export function templateFromParsed(
  tenantId: string,
  fingerprintKey: string,
  layoutSignature: string,
  parsed: ParsedInvoiceData,
  confidenceScore: number
): VendorTemplateSnapshot | undefined {
  if (!parsed.vendorName || parsed.vendorName.trim().length === 0) {
    return undefined;
  }

  const normalizedVendor = parsed.vendorName.trim();
  const invoicePrefix = buildInvoicePrefix(parsed.invoiceNumber);
  return {
    tenantId,
    fingerprintKey,
    layoutSignature,
    vendorName: normalizedVendor,
    currency: parsed.currency,
    invoicePrefix,
    confidenceScore
  };
}

const INVOICE_PREFIX_REGEX = /^[A-Z]+/i;
function buildInvoicePrefix(invoiceNumber?: string): string | undefined {
  if (!invoiceNumber) {
    return undefined;
  }

  const normalized = invoiceNumber.trim();
  if (normalized.length < 3) {
    return undefined;
  }

  const prefix = normalized.match(INVOICE_PREFIX_REGEX)?.[0];
  if (prefix && prefix.length >= 2) {
    return prefix.toUpperCase();
  }
  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
