import { VendorTemplateModel } from "@/models/invoice/VendorTemplate.js";

export interface VendorTemplateSnapshot {
  tenantId: string;
  clientOrgId: string;
  fingerprintKey: string;
  layoutSignature: string;
  vendorName: string;
  currency?: string;
  invoicePrefix?: string;
  confidenceScore: number;
}

export interface VendorTemplateStore {
  findByFingerprint(
    tenantId: string,
    clientOrgId: string,
    fingerprintKey: string
  ): Promise<VendorTemplateSnapshot | undefined>;
  saveOrUpdate(template: VendorTemplateSnapshot): Promise<void>;
}

export class MongoVendorTemplateStore implements VendorTemplateStore {
  async findByFingerprint(
    tenantId: string,
    clientOrgId: string,
    fingerprintKey: string
  ): Promise<VendorTemplateSnapshot | undefined> {
    try {
      const template = await VendorTemplateModel.findOne({ tenantId, clientOrgId, fingerprintKey }).lean();
      if (!template) {
        return undefined;
      }

      return {
        tenantId: String(template.tenantId),
        clientOrgId: String(template.clientOrgId),
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
        {
          tenantId: template.tenantId,
          clientOrgId: template.clientOrgId,
          fingerprintKey: template.fingerprintKey
        },
        {
          $set: {
            tenantId: template.tenantId,
            clientOrgId: template.clientOrgId,
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

  async findByFingerprint(
    tenantId: string,
    clientOrgId: string,
    fingerprintKey: string
  ): Promise<VendorTemplateSnapshot | undefined> {
    return this.templates.get(`${tenantId}|${clientOrgId}|${fingerprintKey}`);
  }

  async saveOrUpdate(template: VendorTemplateSnapshot): Promise<void> {
    this.templates.set(
      `${template.tenantId}|${template.clientOrgId}|${template.fingerprintKey}`,
      template
    );
  }
}
