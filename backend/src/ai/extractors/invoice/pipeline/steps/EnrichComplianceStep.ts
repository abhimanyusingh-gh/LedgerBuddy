import type { PipelineContext, PipelineStep, StepOutput } from "@/core/pipeline/index.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import type { ComplianceEnricher } from "@/services/compliance/ComplianceEnricher.js";
import { toUUID } from "@/types/uuid.js";
import { logger } from "@/utils/logger.js";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.js";

/**
 * Stage 13: Enriches the parsed data with compliance information (TDS, PAN, risk signals).
 * Only executes if a ComplianceEnricher was provided. Mirrors `runCompliance()` in the pipeline.
 */
export class EnrichComplianceStep implements PipelineStep {
  readonly name = "enrich-compliance";

  constructor(private readonly complianceEnricher?: ComplianceEnricher) {}

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    if (!this.complianceEnricher) {
      return {};
    }

    const parsed = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.RECOVERED_PARSED);
    const tenantId = toUUID(ctx.input.tenantId);
    const vendorFingerprint = ctx.metadata.vendorFingerprint ?? "";
    const contentHash = ctx.metadata.vendorContentHash ?? "";

    try {
      const compliance = await this.complianceEnricher.enrich(parsed, tenantId, vendorFingerprint, { contentHash });
      ctx.store.set(POST_ENGINE_CTX.COMPLIANCE, compliance);
    } catch (error) {
      logger.warn("compliance.enrich.failed", {
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {};
  }
}
