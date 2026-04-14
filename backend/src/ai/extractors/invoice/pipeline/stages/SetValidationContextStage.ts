import type { PipelineStage, StageResult } from "@/core/pipeline/PipelineStage.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { InvoiceDocumentDefinition, InvoiceValidationContext } from "../../InvoiceDocumentDefinition.js";
import { INVOICE_CTX } from "../contextKeys.js";

interface ValidationParams {
  expectedMaxTotal: number;
  expectedMaxDueDays: number;
  referenceDate?: Date;
}

export class SetValidationContextStage implements PipelineStage {
  readonly name = "set-validation-context";

  constructor(
    private definition: InvoiceDocumentDefinition,
    private params: ValidationParams,
  ) {}

  async execute(ctx: PipelineContext): Promise<StageResult> {
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
