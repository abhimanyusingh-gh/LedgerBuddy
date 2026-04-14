import type { PipelineContext, PipelineStage, StageResult } from "@/core/pipeline/index.js";
import type { InvoiceSlmOutput } from "../../InvoiceDocumentDefinition.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import { sanitizeInvoiceExtraction } from "../../InvoiceExtractionSanitizer.js";
import { uniqueIssues } from "../../../stages/fieldParsingUtils.js";
import { POST_ENGINE_CTX } from "../postEngineContextKeys.js";

/**
 * Stage 9: Merges the baseline (heuristic) parsed data with SLM output.
 * Equivalent to the private `mergeParsedInvoiceData()` in InvoiceExtractionPipeline.
 */
export class MergeBaselineWithSlmStep implements PipelineStage {
  readonly name = "merge-baseline-with-slm";

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const slm = ctx.store.require<InvoiceSlmOutput>(POST_ENGINE_CTX.SLM_OUTPUT);
    const baseline = ctx.store.get<ParsedInvoiceData>("invoice.baselineParsed") ?? {};

    ctx.issues.push(...slm.issues);

    const merged = mergeParsedInvoiceData(baseline, slm.parsed);
    ctx.store.set(POST_ENGINE_CTX.MERGED_PARSED, merged);
    return {};
  }
}

function mergeParsedInvoiceData(base: ParsedInvoiceData, override: ParsedInvoiceData): ParsedInvoiceData {
  const baseNormalized = sanitizeInvoiceExtraction(base);
  const overrideNormalized = sanitizeInvoiceExtraction(override);
  const merged: ParsedInvoiceData = { ...baseNormalized, ...overrideNormalized };

  if (baseNormalized.gst || overrideNormalized.gst) {
    merged.gst = { ...(baseNormalized.gst ?? {}), ...(overrideNormalized.gst ?? {}) };
  }

  if (overrideNormalized.lineItems && overrideNormalized.lineItems.length > 0) {
    merged.lineItems = overrideNormalized.lineItems;
  } else if (baseNormalized.lineItems && baseNormalized.lineItems.length > 0) {
    merged.lineItems = baseNormalized.lineItems;
  }

  const notes = uniqueIssues([...(baseNormalized.notes ?? []), ...(overrideNormalized.notes ?? [])]);
  if (notes.length > 0) {
    merged.notes = notes;
  }

  return sanitizeInvoiceExtraction(merged);
}
