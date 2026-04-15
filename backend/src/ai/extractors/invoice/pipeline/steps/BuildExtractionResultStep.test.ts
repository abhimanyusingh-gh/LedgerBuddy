import { ContextStore } from "@/core/pipeline/PipelineContext.ts";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.ts";
import { BuildExtractionResultStep } from "@/ai/extractors/invoice/pipeline/steps/BuildExtractionResultStep.ts";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.ts";
import { ENGINE_STRATEGY } from "@/core/engine/types.ts";
import { EXTRACTION_SOURCE } from "@/core/engine/extractionSource.ts";
import type { InvoiceSlmOutput } from "@/ai/extractors/invoice/InvoiceDocumentDefinition.ts";
import type { PipelineExtractionResult } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.ts";

function buildCtx(overrides?: { engineStrategy?: string }): PipelineContext {
  const store = new ContextStore();
  const parsed = { invoiceNumber: "INV-001", totalAmountMinor: 500000 };
  const slmOutput: InvoiceSlmOutput = {
    parsed,
    tokens: 42,
    issues: [],
    changedFields: [],
    lineItemProvenance: [],
  };

  store.set(POST_ENGINE_CTX.RECOVERED_PARSED, parsed);
  store.set(POST_ENGINE_CTX.SLM_OUTPUT, slmOutput);
  store.set("invoice.ocrBlocks", []);
  store.set("invoice.ocrPageImages", []);
  store.set("invoice.primaryText", "Invoice Number: INV-001");
  store.set("invoice.ocrConfidence", 0.95);
  store.set("invoice.ocrTokens", 100);
  store.set("invoice.ocrProviderName", "mock-ocr");
  store.set(POST_ENGINE_CTX.CONFIDENCE_ASSESSMENT, {
    score: 90,
    autoApprove: true,
    details: [],
  });

  if (overrides?.engineStrategy) {
    store.set(POST_ENGINE_CTX.ENGINE_STRATEGY, overrides.engineStrategy);
  }

  return {
    input: {
      tenantId: "t-1",
      fileName: "test.pdf",
      mimeType: "application/pdf" as const,
      fileBuffer: Buffer.from(""),
    },
    store,
    metadata: {},
    issues: [],
  };
}

describe("BuildExtractionResultStep", () => {
  const step = new BuildExtractionResultStep();

  it("builds result with SLM source when engine strategy is slm", async () => {
    const ctx = buildCtx({ engineStrategy: ENGINE_STRATEGY.SLM });
    await step.execute(ctx);

    const result = ctx.store.require<PipelineExtractionResult>(POST_ENGINE_CTX.FINAL_RESULT);
    expect(result.source).toBe(EXTRACTION_SOURCE.SLM_DIRECT);
    expect(result.strategy).toBe(EXTRACTION_SOURCE.SLM_GENERIC);
    expect(result.extraction?.source).toBe(EXTRACTION_SOURCE.SLM_DIRECT);
  });

  it("builds result with LlamaExtract source when engine strategy is llamaextract", async () => {
    const ctx = buildCtx({ engineStrategy: ENGINE_STRATEGY.LLAMA_EXTRACT });
    await step.execute(ctx);

    const result = ctx.store.require<PipelineExtractionResult>(POST_ENGINE_CTX.FINAL_RESULT);
    expect(result.source).toBe(EXTRACTION_SOURCE.LLAMA_EXTRACT);
    expect(result.strategy).toBe(EXTRACTION_SOURCE.LLAMA_EXTRACT);
    expect(result.extraction?.source).toBe(EXTRACTION_SOURCE.LLAMA_EXTRACT);
    expect(result.extraction?.strategy).toBe(EXTRACTION_SOURCE.LLAMA_EXTRACT);
  });

  it("defaults to SLM source when engine strategy is not set", async () => {
    const ctx = buildCtx();
    await step.execute(ctx);

    const result = ctx.store.require<PipelineExtractionResult>(POST_ENGINE_CTX.FINAL_RESULT);
    expect(result.source).toBe(EXTRACTION_SOURCE.SLM_DIRECT);
  });

  it("includes provider, text, confidence, and token counts in result", async () => {
    const ctx = buildCtx({ engineStrategy: ENGINE_STRATEGY.LLAMA_EXTRACT });
    await step.execute(ctx);

    const result = ctx.store.require<PipelineExtractionResult>(POST_ENGINE_CTX.FINAL_RESULT);
    expect(result.provider).toBe("mock-ocr");
    expect(result.text).toBe("Invoice Number: INV-001");
    expect(result.confidence).toBe(0.95);
    expect(result.ocrTokens).toBe(100);
    expect(result.slmTokens).toBe(42);
  });

  it("uses recovery strategy for SLM strategy field", async () => {
    const ctx = buildCtx({ engineStrategy: ENGINE_STRATEGY.SLM });
    ctx.store.set(POST_ENGINE_CTX.RECOVERY_STRATEGY, "invoice_table");
    await step.execute(ctx);

    const result = ctx.store.require<PipelineExtractionResult>(POST_ENGINE_CTX.FINAL_RESULT);
    expect(result.strategy).toBe(EXTRACTION_SOURCE.SLM_INVOICE_TABLE);
  });

  it("ignores recovery strategy for LlamaExtract path", async () => {
    const ctx = buildCtx({ engineStrategy: ENGINE_STRATEGY.LLAMA_EXTRACT });
    ctx.store.set(POST_ENGINE_CTX.RECOVERY_STRATEGY, "invoice_table");
    await step.execute(ctx);

    const result = ctx.store.require<PipelineExtractionResult>(POST_ENGINE_CTX.FINAL_RESULT);
    expect(result.strategy).toBe(EXTRACTION_SOURCE.LLAMA_EXTRACT);
  });
});
