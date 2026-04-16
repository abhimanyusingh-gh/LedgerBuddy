import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { ExtractedField } from "@/core/interfaces/OcrProvider.js";
import { INVOICE_CTX } from "@/ai/extractors/invoice/pipeline/contextKeys.js";

export class CheckExtractFieldsGateStep implements PipelineStep {
  readonly name = "check-extract-fields-gate";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const extractFields = ctx.store.get<ExtractedField[]>(INVOICE_CTX.EXTRACT_FIELDS);

    if ((extractFields?.length ?? 0) > 0) {
      return { status: "halt" };
    }

    return {};
  }
}
