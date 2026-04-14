import type { ParsedInvoiceData } from "@/types/invoice.js";
import { ExtractionMappingModel } from "@/models/invoice/ExtractionMapping.js";
import { logger } from "@/utils/logger.js";


export class ExtractionMappingService {
  static normaliseVendorKey(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ")
      .trim();
  }

  async applyMappings(
    tenantId: string,
    parsed: ParsedInvoiceData
  ): Promise<{ mappingApplied: boolean; mappingId?: string }> {
    let mapping = null;

    const gstin = parsed.gst?.gstin;
    if (gstin) {
      mapping = await ExtractionMappingModel.findOne({
        tenantId,
        matchType: "gstin",
        matchKey: gstin
      }).lean();
    }

    if (!mapping && parsed.vendorName) {
      const normalisedKey = ExtractionMappingService.normaliseVendorKey(parsed.vendorName);
      mapping = await ExtractionMappingModel.findOne({
        tenantId,
        matchType: "vendorNameFuzzy",
        matchKey: normalisedKey
      }).lean();
    }

    if (!mapping) {
      return { mappingApplied: false };
    }

    if (mapping.canonicalVendorName) {
      parsed.vendorName = mapping.canonicalVendorName;
    }
    if (mapping.fieldOverrides?.currency) {
      parsed.currency = mapping.fieldOverrides.currency;
    }

    ExtractionMappingModel.findByIdAndUpdate(mapping._id, {
      $inc: { appliedCount: 1 },
      $set: { lastAppliedAt: new Date() }
    }).catch((err: unknown) =>
      logger.warn("extraction.mapping.apply.update.failed", {
        tenantId,
        mappingId: String(mapping!._id),
        err
      })
    );

    return { mappingApplied: true, mappingId: String(mapping._id) };
  }

  async maybeSeedMappingFromCorrection(
    tenantId: string,
    invoiceId: string,
    before: ParsedInvoiceData,
    after: ParsedInvoiceData,
    createdBy: string
  ): Promise<void> {
    const gstin = after.gst?.gstin;
    if (!gstin) return;
    if (!after.vendorName || after.vendorName === before.vendorName) return;

    await ExtractionMappingModel.findOneAndUpdate(
      { tenantId, matchType: "gstin", matchKey: gstin },
      {
        $set: {
          canonicalVendorName: after.vendorName,
          source: "user-correction",
          createdBy
        }
      },
      { upsert: true, new: true }
    ).catch((err: unknown) =>
      logger.warn("extraction.mapping.seed.upsert.failed", {
        tenantId,
        invoiceId,
        gstin,
        err
      })
    );
  }
}
