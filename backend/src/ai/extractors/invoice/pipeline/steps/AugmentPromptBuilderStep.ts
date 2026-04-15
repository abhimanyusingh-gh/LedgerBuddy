import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { OcrBlock, OcrPageImage } from "@/core/interfaces/OcrProvider.js";
import type { InvoiceDocumentDefinition } from "@/ai/extractors/invoice/InvoiceDocumentDefinition.js";
import { INVOICE_CTX } from "@/ai/extractors/invoice/pipeline/contextKeys.js";

export class AugmentPromptBuilderStep implements PipelineStep {
  readonly name = "augment-prompt-builder";

  constructor(private definition: InvoiceDocumentDefinition) {}

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const augmentedText = ctx.store.require<string>(INVOICE_CTX.AUGMENTED_TEXT);
    const primaryText = ctx.store.require<string>(INVOICE_CTX.PRIMARY_TEXT);

    const chosenText = augmentedText || primaryText;
    this.definition.buildPrompt = (_text: string, _blocks: OcrBlock[], _pageImages: OcrPageImage[]) => chosenText;

    return {};
  }
}
