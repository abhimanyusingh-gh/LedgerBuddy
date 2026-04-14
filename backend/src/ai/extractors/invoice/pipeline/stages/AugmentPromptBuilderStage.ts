import type { PipelineStage, StageResult } from "@/core/pipeline/PipelineStage.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { OcrBlock, OcrPageImage } from "@/core/interfaces/OcrProvider.js";
import type { InvoiceDocumentDefinition } from "../../InvoiceDocumentDefinition.js";
import { INVOICE_CTX } from "../contextKeys.js";

export class AugmentPromptBuilderStage implements PipelineStage {
  readonly name = "augment-prompt-builder";

  constructor(private definition: InvoiceDocumentDefinition) {}

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const augmentedText = ctx.store.require<string>(INVOICE_CTX.AUGMENTED_TEXT);
    const primaryText = ctx.store.require<string>(INVOICE_CTX.PRIMARY_TEXT);

    const chosenText = augmentedText || primaryText;
    this.definition.buildPrompt = (_text: string, _blocks: OcrBlock[], _pageImages: OcrPageImage[]) => chosenText;

    return {};
  }
}
