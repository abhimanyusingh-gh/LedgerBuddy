import type { PipelineContext, PipelineStage, StageResult } from "@/core/pipeline/index.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import { validateInvoiceFields } from "../../deterministicValidation.js";
import { POST_ENGINE_CTX } from "../postEngineContextKeys.js";

/**
 * Stage 11: Runs deterministic field validation on the recovered parsed data.
 * Stores validation issues and appends them to pipeline issues if invalid.
 */
export class ValidateFieldsStep implements PipelineStage {
  readonly name = "validate-fields";

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const parsed = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.RECOVERED_PARSED);
    const primaryText = ctx.store.require<string>("invoice.primaryText");
    const expectedMaxTotal = (ctx.input as Record<string, unknown>).expectedMaxTotal as number ?? 0;
    const expectedMaxDueDays = (ctx.input as Record<string, unknown>).expectedMaxDueDays as number ?? 0;
    const referenceDate = (ctx.input as Record<string, unknown>).referenceDate as Date | undefined;

    const validation = validateInvoiceFields({
      parsed,
      ocrText: primaryText,
      expectedMaxTotal,
      expectedMaxDueDays,
      referenceDate,
    });

    ctx.store.set(POST_ENGINE_CTX.VALIDATION_ISSUES, validation.issues);

    if (!validation.valid) {
      ctx.issues.push(...validation.issues);
    }

    return {};
  }
}
