import type { PipelineContext, PipelineStep, StepOutput } from "@/core/pipeline/index.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import { validateInvoiceFields } from "@/ai/extractors/invoice/deterministicValidation.js";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.js";

export class ValidateFieldsStep implements PipelineStep {
  readonly name = "validate-fields";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const parsed = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.RECOVERED_PARSED);
    const primaryText = ctx.store.require<string>("invoice.primaryText");

    const validation = validateInvoiceFields({
      parsed,
      ocrText: primaryText,
    });

    ctx.store.set(POST_ENGINE_CTX.VALIDATION_ISSUES, validation.issues);

    if (!validation.valid) {
      ctx.issues.push(...validation.issues);
    }

    return {};
  }
}
