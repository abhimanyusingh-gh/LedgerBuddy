import type { PipelineStage, StageResult } from "@/core/pipeline/PipelineStage.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { VendorTemplateSnapshot } from "../../learning/vendorTemplateStore.js";
import { parseInvoiceText } from "@/ai/parsers/invoiceParser.js";
import { buildFieldCandidates, buildFieldRegions } from "../../stages/fieldCandidates.js";
import { INVOICE_CTX } from "../contextKeys.js";

interface LanguageResolution {
  resolved: { code: string };
}

export class BaselineTextParseStage implements PipelineStage {
  readonly name = "baseline-text-parse";

  constructor(private template?: VendorTemplateSnapshot) {}

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const primaryText = ctx.store.require<string>(INVOICE_CTX.PRIMARY_TEXT);
    const ocrBlocks = ctx.store.require<OcrBlock[]>(INVOICE_CTX.OCR_BLOCKS);
    const language = ctx.store.require<LanguageResolution>(INVOICE_CTX.LANGUAGE_RESOLUTION);

    const baseline = parseInvoiceText(primaryText, { languageHint: language.resolved.code });
    const fieldCandidates = buildFieldCandidates(primaryText, baseline.parsed, this.template);
    const fieldRegions = buildFieldRegions(ocrBlocks, fieldCandidates);

    ctx.store.set(INVOICE_CTX.BASELINE_PARSED, baseline.parsed);
    ctx.store.set(INVOICE_CTX.FIELD_CANDIDATES, fieldCandidates);
    ctx.store.set(INVOICE_CTX.FIELD_REGIONS, fieldRegions);

    ctx.metadata.baselineFieldCount = String(Object.keys(baseline.parsed).length);
    ctx.metadata.baselineWarningCount = String(baseline.warnings.length);
    ctx.metadata.fieldCandidateCount = String(Object.keys(fieldCandidates).length);
    ctx.metadata.fieldRegionCount = String(Object.keys(fieldRegions).length);

    return {};
  }
}
