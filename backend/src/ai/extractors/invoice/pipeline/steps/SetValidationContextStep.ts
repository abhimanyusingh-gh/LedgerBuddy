import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { InvoiceDocumentDefinition, InvoiceValidationContext } from "@/ai/extractors/invoice/InvoiceDocumentDefinition.js";
import { INVOICE_CTX } from "@/ai/extractors/invoice/pipeline/contextKeys.js";

interface ValidationParams {
  expectedMaxTotal: number;
  expectedMaxDueDays: number;
  referenceDate?: Date;
}

export class SetValidationContextStep implements PipelineStep {
  readonly name = "set-validation-context";

  constructor(
    private definition: InvoiceDocumentDefinition,
    private params: ValidationParams,
  ) {}

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const primaryText = ctx.store.require<string>(INVOICE_CTX.PRIMARY_TEXT);

    const validationCtx: InvoiceValidationContext = {
      expectedMaxTotal: this.params.expectedMaxTotal,
      expectedMaxDueDays: this.params.expectedMaxDueDays,
      referenceDate: this.params.referenceDate,
      ocrText: primaryText,
    };
    this.definition.setValidationContext(validationCtx);

    return {};
  }
}
