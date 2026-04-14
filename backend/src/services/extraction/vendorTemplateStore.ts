import { VendorTemplateModel } from "../../models/VendorTemplate.js";

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
      throw error instanceof Error ? error : new Error(String(error));
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
      throw error instanceof Error ? error : new Error(String(error));
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
