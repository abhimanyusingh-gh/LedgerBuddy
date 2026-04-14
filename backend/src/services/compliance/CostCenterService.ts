import { CostCenterMasterModel } from "../../models/compliance/CostCenterMaster.js";
import { VendorCostCenterMappingModel } from "../../models/compliance/VendorCostCenterMapping.js";
import { VendorMasterModel } from "../../models/compliance/VendorMaster.js";
import type { ComplianceCostCenterResult } from "../../types/invoice.js";

interface CostCenterSuggestion {
  costCenter: ComplianceCostCenterResult;
}

export class CostCenterService {
  async suggest(
    tenantId: string,
    vendorFingerprint: string,
    glCode: string | null
  ): Promise<CostCenterSuggestion> {
    const vendorResult = await this.suggestFromVendorHistory(tenantId, vendorFingerprint);
    if (vendorResult) return vendorResult;

    if (glCode) {
      const glLinked = await this.suggestFromGlLink(tenantId, glCode);
      if (glLinked) return glLinked;
    }

    return {
      costCenter: { code: null, name: null, source: "vendor-default", confidence: null }
    };
  }

  async recordUsage(
    tenantId: string,
    vendorFingerprint: string,
    costCenterCode: string,
    costCenterName: string
  ): Promise<void> {
    const now = new Date();
    await VendorCostCenterMappingModel.findOneAndUpdate(
      { tenantId, vendorFingerprint, costCenterCode },
      { $inc: { usageCount: 1 }, $set: { costCenterName, lastUsedAt: now } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const topMapping = await VendorCostCenterMappingModel
      .findOne({ tenantId, vendorFingerprint })
      .sort({ usageCount: -1 })
      .lean();

    if (topMapping) {
      await VendorMasterModel.updateOne(
        { tenantId, vendorFingerprint },
        { $set: { defaultCostCenter: topMapping.costCenterCode } }
      );
    }
  }

  private async suggestFromVendorHistory(
    tenantId: string,
    vendorFingerprint: string
  ): Promise<CostCenterSuggestion | null> {
    const mappings = await VendorCostCenterMappingModel
      .find({ tenantId, vendorFingerprint })
      .sort({ usageCount: -1 })
      .limit(1)
      .lean();

    if (mappings.length === 0) return null;

    const top = mappings[0];
    return {
      costCenter: {
        code: top.costCenterCode,
        name: top.costCenterName,
        source: "vendor-default",
        confidence: Math.min(100, top.usageCount * 15)
      }
    };
  }

  private async suggestFromGlLink(
    tenantId: string,
    glCode: string
  ): Promise<CostCenterSuggestion | null> {
    const cc = await CostCenterMasterModel.findOne({
      tenantId,
      linkedGlCodes: glCode,
      isActive: true
    }).lean();

    if (!cc) return null;

    return {
      costCenter: {
        code: cc.code,
        name: cc.name,
        source: "gl-linked",
        confidence: 70
      }
    };
  }
}
