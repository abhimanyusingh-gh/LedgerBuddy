# Composable Pipeline Architecture

The composable pipeline decomposes document extraction into small, testable steps that can be shared across document types.

## Core abstractions

All live in `backend/src/core/pipeline/`:

- **`PipelineStage`** -- interface with `name: string` and `execute(ctx): Promise<StageResult>`. Each step returns `{ status?: "continue" | "skip" | "halt" }`.
- **`ContextStore`** -- typed key-value store (`set<T>`, `get<T>`, `require<T>`) that stages use to pass data to downstream stages.
- **`PipelineContext`** -- bundles `input` (file buffer, tenant, mime), `store`, `metadata` (string map for observability), and `issues` (warnings array).
- **`ComposablePipeline<T>`** -- chain of stages with `.add()` / `.addIf()`. Executes stages in order, extracts a typed result at the end.

## Directory structure

```
backend/src/ai/extractors/
  stages/                         # Shared business-logic utilities
    fieldParsingUtils.ts          #   date/currency/amount parsing, clamp, indexBlocks
    ocrTextCandidates.ts          #   OCR text ranking and normalization
    nativePdfText.ts              #   pdftotext wrapper (no domain types)
  commonSteps/                    # Shared pipeline steps (reusable by any doc type)
    CaptureOcrMetadataStep.ts     #   Extract blocks, page images, tokens from OCR result
    PostProcessOcrStep.ts         #   Merge blocks, build lines
    BuildTextCandidatesStep.ts    #   Rank OCR text variants, select primary
    CalibrateConfidenceStep.ts    #   Calibrate document-level OCR confidence
    DetectLanguageStep.ts         #   Detect document language from OCR text
  invoice/
    pipeline/
      contextKeys.ts              #   INVOICE_CTX keys for ContextStore
      postEngineContextKeys.ts    #   POST_ENGINE_CTX keys
      invoiceAfterOcrPipeline.ts  #   Factory: stages 1-8 (pre-engine)
      invoicePostEnginePipeline.ts#   Factory: stages 9-16 (post-engine)
      steps/                      #   Invoice-specific pipeline steps
        BaselineTextParseStep.ts  #     Heuristic field extraction
        AugmentPromptBuilderStep.ts
        SetValidationContextStep.ts
        MergeBaselineWithSlmStep.ts
        RecoverOcrFieldsStep.ts
        ValidateFieldsStep.ts
        ComputeFieldDiagnosticsStep.ts
        EnrichComplianceStep.ts
        AssessConfidenceStep.ts
        ResolveProvenanceStep.ts
        BuildExtractionResultStep.ts
        CheckExtractFieldsGateStep.ts
    stages/                       #   Invoice-specific business logic
      groundingText.ts            #     Field grounding via OCR blocks
      groundingAmounts.ts
      fieldCandidates.ts
      documentFieldRecovery.ts
      lineItemRecovery.ts
      totalsRecovery.ts
      provenance.ts
    adapters/
      LlamaExtractAdapter.ts     #   Parse LlamaCloud results into ParsedInvoiceData
```

## Invoice pipeline flow

The invoice extraction runs two sub-pipelines around the SLM engine call:

### After-OCR pipeline (stages 1-8)

Built by `buildInvoiceAfterOcrPipeline()`. Runs immediately after OCR completes.

| # | Step | Source |
|---|------|--------|
| 1 | CaptureOcrMetadataStep | commonSteps/ |
| 2 | PostProcessOcrStep | commonSteps/ |
| 3 | BuildTextCandidatesStep | commonSteps/ |
| 4 | CalibrateConfidenceStep | commonSteps/ |
| 5 | DetectLanguageStep | commonSteps/ |
| G | CheckExtractFieldsGateStep | invoice/pipeline/steps/ |
| 6 | BaselineTextParseStep | invoice/pipeline/steps/ |
| 7 | AugmentPromptBuilderStep | invoice/pipeline/steps/ |
| 8 | SetValidationContextStep | invoice/pipeline/steps/ |

### Post-engine pipeline (stages 9-16)

Built by `createInvoicePostEnginePipeline()`. Runs after the SLM returns structured fields.

| # | Step | Source |
|---|------|--------|
| 9 | MergeBaselineWithSlmStep | invoice/pipeline/steps/ |
| 10 | RecoverOcrFieldsStep | invoice/pipeline/steps/ |
| 11 | ValidateFieldsStep | invoice/pipeline/steps/ |
| 12 | ComputeFieldDiagnosticsStep | invoice/pipeline/steps/ |
| 13 | EnrichComplianceStep | invoice/pipeline/steps/ |
| 14 | AssessConfidenceStep | invoice/pipeline/steps/ |
| 15 | ResolveProvenanceStep | invoice/pipeline/steps/ |
| 16 | BuildExtractionResultStep | invoice/pipeline/steps/ |

## Adding a new document type

1. Create `extractors/<type>/pipeline/contextKeys.ts` with type-specific context keys.
2. Create type-specific steps in `extractors/<type>/pipeline/steps/`.
3. Create a factory function that builds a `ComposablePipeline`, reusing common steps from `extractors/commonSteps/` for OCR post-processing (stages 1-5 are document-agnostic).
4. Add type-specific business logic in `extractors/<type>/stages/`.
5. Define a `DocumentDefinition` in `extractors/<type>/`.

## Adding a new step

1. Create a class implementing `PipelineStage` with a descriptive `name`.
2. Read inputs from `ctx.store.require<T>(KEY)`.
3. Write outputs with `ctx.store.set(KEY, value)`.
4. Add observability data to `ctx.metadata`.
5. Return `{}` to continue, `{ status: "skip" }` to skip remaining stages, or `{ status: "halt" }` to abort.
6. Register the step in the appropriate factory function (e.g., `buildInvoiceAfterOcrPipeline`).
7. If the step is document-agnostic, place it in `extractors/commonSteps/`.
