import type { FieldVerifier, FieldVerifierInput, FieldVerifierResult } from "@/core/interfaces/FieldVerifier.ts";
import type { OcrBlock, OcrPageImage, OcrProvider, OcrResult } from "@/core/interfaces/OcrProvider.ts";
import { DocumentProcessingEngine, OCR_SENTINEL_KEY, type DocumentProcessingProgressEvent } from "@/core/engine/DocumentProcessingEngine.ts";
import type { ChunkableDocumentDefinition, DocumentDefinition, SinglePassDocumentDefinition } from "@/core/engine/DocumentDefinition.ts";
import { DOC_TYPE } from "@/core/engine/DocumentDefinition.ts";
import type { ProcessingContext, ValidationResult } from "@/core/engine/types.ts";
import { DocumentProcessingError } from "@/core/engine/types.ts";
import * as nativePdfText from "@/ai/extractors/stages/nativePdfText.ts";

jest.mock("../../ai/extractors/stages/nativePdfText.ts");

function makeNativePdfText(text: string) {
  (nativePdfText.extractNativePdfText as jest.Mock).mockReturnValue(text);
}

class TestDocumentDefinition implements SinglePassDocumentDefinition<string> {
  readonly docType = DOC_TYPE.INVOICE;
  canChunk(): boolean { return false; }

  buildPrompt(ocrText: string, _blocks: OcrBlock[], _pageImages: OcrPageImage[]): string {
    return `PROMPT:${ocrText}`;
  }

  parseOutput(raw: string | Record<string, unknown>): string {
    if (typeof raw === "object") {
      return `PARSED:${JSON.stringify(raw)}`;
    }
    return `PARSED:${raw}`;
  }
}

function makeOcrProvider(text: string, extras?: Partial<OcrResult>): OcrProvider {
  return {
    name: "mock-ocr",
    extractText: jest.fn().mockResolvedValue({ text, provider: "mock-ocr", ...extras })
  };
}

function makeFieldVerifier(rawJson: string): FieldVerifier {
  return {
    name: "mock-slm",
    verify: jest.fn().mockResolvedValue({
      parsed: {},
      issues: [],
      changedFields: [],
      contract: { rawJson }
    } as FieldVerifierResult)
  };
}

function makeCtx(overrides?: Partial<ProcessingContext>): ProcessingContext {
  return {
    tenantId: "t1",
    fileName: "test.pdf",
    mimeType: "application/pdf",
    fileBuffer: Buffer.from("test-pdf"),
    ...overrides
  };
}

describe("DocumentProcessingEngine", () => {
  beforeEach(() => {
    makeNativePdfText("");
  });

  it("calls OCR provider and passes text to SLM", async () => {
    const ocrProvider = makeOcrProvider("OCR TEXT");
    const fieldVerifier = makeFieldVerifier("slm-result");
    const definition = new TestDocumentDefinition();
    const engine = new DocumentProcessingEngine(definition, fieldVerifier, ocrProvider);

    const result = await engine.process(makeCtx());

    expect(ocrProvider.extractText).toHaveBeenCalledWith(
      expect.any(Buffer),
      "application/pdf",
      undefined
    );
    expect(result.ocrText).toBe("OCR TEXT");
    expect(result.output).toBe("PARSED:slm-result");
    expect(result.strategy).toBe("slm");
  });

  it("passes ocrLanguageHint to extractText", async () => {
    const ocrProvider = makeOcrProvider("TEXT");
    const fieldVerifier = makeFieldVerifier("{}");
    const engine = new DocumentProcessingEngine(new TestDocumentDefinition(), fieldVerifier, ocrProvider);

    await engine.process(makeCtx({ ocrLanguageHint: "en" }));

    expect(ocrProvider.extractText).toHaveBeenCalledWith(
      expect.any(Buffer),
      "application/pdf",
      { languageHint: "en" }
    );
  });

  it("throws DocumentProcessingError FAILED_OCR on empty OCR text", async () => {
    const ocrProvider = makeOcrProvider("");
    const fieldVerifier = makeFieldVerifier("{}");
    const engine = new DocumentProcessingEngine(new TestDocumentDefinition(), fieldVerifier, ocrProvider);

    await expect(engine.process(makeCtx())).rejects.toThrow(DocumentProcessingError);
    await expect(engine.process(makeCtx())).rejects.toMatchObject({ code: "FAILED_OCR" });
  });

  it("throws DocumentProcessingError FAILED_OCR when OCR provider throws", async () => {
    const ocrProvider: OcrProvider = {
      name: "mock",
      extractText: jest.fn().mockRejectedValue(new Error("OCR service unavailable"))
    };
    const fieldVerifier = makeFieldVerifier("{}");
    const engine = new DocumentProcessingEngine(new TestDocumentDefinition(), fieldVerifier, ocrProvider);

    await expect(engine.process(makeCtx())).rejects.toMatchObject({ code: "FAILED_OCR" });
  });

  it("uses native PDF text when preferNativePdfText is true and text is sufficient", async () => {
    const nativeText = "Native PDF content " + "x".repeat(200);
    makeNativePdfText(nativeText);

    class NativeTextDefinition extends TestDocumentDefinition {
      readonly preferNativePdfText = true;
      readonly nativePdfTextMinLength = 100;
    }

    const ocrProvider = makeOcrProvider("should not be called");
    const fieldVerifier = makeFieldVerifier("result");
    const engine = new DocumentProcessingEngine(new NativeTextDefinition(), fieldVerifier, ocrProvider);

    const result = await engine.process(makeCtx());

    expect(ocrProvider.extractText).not.toHaveBeenCalled();
    expect(result.ocrText).toBe(nativeText);
  });

  it("falls back to OCR when native PDF text is insufficient", async () => {
    makeNativePdfText("short");

    class NativeTextDefinition extends TestDocumentDefinition {
      readonly preferNativePdfText = true;
      readonly nativePdfTextMinLength = 100;
    }

    const ocrProvider = makeOcrProvider("OCR fallback text");
    const fieldVerifier = makeFieldVerifier("result");
    const engine = new DocumentProcessingEngine(new NativeTextDefinition(), fieldVerifier, ocrProvider);

    const result = await engine.process(makeCtx());

    expect(ocrProvider.extractText).toHaveBeenCalledTimes(1);
    expect(result.ocrText).toBe("OCR fallback text");
  });

  it("throws when native text insufficient and no OCR provider", async () => {
    makeNativePdfText("short");

    class NativeTextDefinition extends TestDocumentDefinition {
      readonly preferNativePdfText = true;
      readonly nativePdfTextMinLength = 100;
    }

    const fieldVerifier = makeFieldVerifier("{}");
    const engine = new DocumentProcessingEngine(new NativeTextDefinition(), fieldVerifier);

    await expect(engine.process(makeCtx())).rejects.toMatchObject({
      code: "FAILED_OCR",
      message: expect.stringContaining("OCR provider is not available")
    });
  });

  it("routes to llamaextract when ocrResult.fields is present", async () => {
    const fields = [{ key: "invoice_number", value: "INV-001" }];
    const ocrProvider = makeOcrProvider("OCR TEXT", { fields });

    class ExtractFieldsDefinition extends TestDocumentDefinition {
      parseOutput(raw: string | Record<string, unknown>): string {
        if (typeof raw === "object") {
          return `EXTRACTED:${(raw as Record<string, unknown>)["invoice_number"]}`;
        }
        return `PARSED:${raw}`;
      }
    }

    const fieldVerifier = makeFieldVerifier("should not be called");
    const engine = new DocumentProcessingEngine(new ExtractFieldsDefinition(), fieldVerifier, ocrProvider);

    const result = await engine.process(makeCtx());

    expect(result.strategy).toBe("llamaextract");
    expect(result.output).toBe("EXTRACTED:INV-001");
    expect(result.slmTokens).toBe(0);
    expect((fieldVerifier.verify as jest.Mock)).not.toHaveBeenCalled();
  });

  it("uses chunked SLM when text exceeds maxChunkChars and mergeChunkOutputs is defined", async () => {
    const largeText = "Transaction line\n".repeat(600);
    const ocrProvider = makeOcrProvider(largeText);

    let callCount = 0;
    const fieldVerifier: FieldVerifier = {
      name: "mock",
      verify: jest.fn().mockImplementation((_: FieldVerifierInput) => {
        callCount++;
        return Promise.resolve({
          parsed: {},
          issues: [],
          changedFields: [],
          contract: { rawJson: `chunk-${callCount}` }
        } as FieldVerifierResult);
      })
    };

    class ChunkDefinition implements ChunkableDocumentDefinition<string[]> {
      readonly docType = DOC_TYPE.BANK_STATEMENT;
      readonly maxChunkChars = 1000;
      canChunk(): boolean { return true; }

      buildChunkPrompt(chunkText: string, _idx: number, _isFirst: boolean): string { return chunkText; }

      parseOutput(raw: string | Record<string, unknown>): string[] {
        const s = typeof raw === "string" ? raw : JSON.stringify(raw);
        return [s];
      }

      mergeChunkOutputs(chunks: string[][]): string[] {
        return chunks.flat();
      }
    }

    const engine = new DocumentProcessingEngine(new ChunkDefinition(), fieldVerifier, ocrProvider);
    const result = await engine.process(makeCtx());

    expect(result.strategy).toBe("slm-chunked");
    expect(fieldVerifier.verify).toHaveBeenCalledTimes(callCount);
    expect((result.output as string[]).length).toBeGreaterThan(1);
  });

  it("runs validation and appends issues to processingIssues", async () => {
    const ocrProvider = makeOcrProvider("OCR");
    const fieldVerifier = makeFieldVerifier("ok");

    class ValidatingDefinition extends TestDocumentDefinition {
      validateOutput(_output: string): ValidationResult {
        return { valid: false, issues: ["Missing required field"] };
      }
    }

    const engine = new DocumentProcessingEngine(new ValidatingDefinition(), fieldVerifier, ocrProvider);
    const result = await engine.process(makeCtx());

    expect(result.validationResult.valid).toBe(false);
    expect(result.processingIssues).toContain("Missing required field");
  });

  it("calls afterOcr callback with OCR result before SLM", async () => {
    const ocrProvider = makeOcrProvider("TEXT WITH BLOCKS", {
      blocks: [{ text: "block1", page: 1, bbox: [0, 0, 100, 20] }]
    });
    const fieldVerifier = makeFieldVerifier("result");
    const engine = new DocumentProcessingEngine(new TestDocumentDefinition(), fieldVerifier, ocrProvider);

    const captured = { ocr: null as OcrResult | null, text: "" };

    await engine.process(makeCtx(), undefined, (ocrResult, ocrText) => {
      captured.ocr = ocrResult;
      captured.text = ocrText;
    });

    expect(captured.text).toBe("TEXT WITH BLOCKS");
    expect(captured.ocr?.blocks).toHaveLength(1);
  });

  it("engine wraps buildPrompt output as ocrText in FieldVerifierInput", async () => {
    const ocrProvider = makeOcrProvider("RAW OCR TEXT");

    const capturedInputs: FieldVerifierInput[] = [];
    const fieldVerifier: FieldVerifier = {
      name: "mock",
      verify: jest.fn().mockImplementation((input: FieldVerifierInput) => {
        capturedInputs.push(input);
        return Promise.resolve({
          parsed: {},
          issues: [],
          changedFields: [],
          contract: { rawJson: "engine-result" }
        } as FieldVerifierResult);
      })
    };

    class CustomPromptDefinition extends TestDocumentDefinition {
      buildPrompt(_ocrText: string, _blocks: OcrBlock[], _pageImages: OcrPageImage[]): string {
        return "CUSTOM PROMPT TEXT";
      }
    }

    const engine = new DocumentProcessingEngine(new CustomPromptDefinition(), fieldVerifier, ocrProvider);
    const result = await engine.process(makeCtx());

    expect(capturedInputs[0]?.ocrText).toBe("CUSTOM PROMPT TEXT");
    expect(result.output).toBe("PARSED:engine-result");
  });

  it("generates prompt from schema when buildPrompt is absent and extractionSchema is set", async () => {
    const ocrProvider = makeOcrProvider("DOCUMENT TEXT");

    const capturedInputs: FieldVerifierInput[] = [];
    const fieldVerifier: FieldVerifier = {
      name: "mock",
      verify: jest.fn().mockImplementation((input: FieldVerifierInput) => {
        capturedInputs.push(input);
        return Promise.resolve({
          parsed: {},
          issues: [],
          changedFields: [],
          contract: { rawJson: "schema-result" }
        } as FieldVerifierResult);
      })
    };

    class SchemaOnlyDefinition implements SinglePassDocumentDefinition<string> {
      readonly docType = DOC_TYPE.INVOICE;
      canChunk(): boolean { return false; }
      readonly extractionSchema = {
        type: "object" as const,
        properties: {
          name: { type: "string" as const, description: "The name field" }
        }
      };

      parseOutput(raw: string | Record<string, unknown>): string {
        return typeof raw === "string" ? raw : JSON.stringify(raw);
      }
    }

    const engine = new DocumentProcessingEngine(new SchemaOnlyDefinition(), fieldVerifier, ocrProvider);
    await engine.process(makeCtx());

    const sentPrompt = capturedInputs[0]?.ocrText ?? "";
    expect(sentPrompt).toContain("name (string): The name field");
    expect(sentPrompt).toContain("DOCUMENT TEXT");
    expect(sentPrompt).toContain("Respond with ONLY a valid JSON object");
  });

  it("OCR_SENTINEL_KEY is the bank statement extraction sentinel string", () => {
    expect(OCR_SENTINEL_KEY).toBe("__bank_statement_extraction__");
  });

  it("onProgress callback receives DocumentProcessingProgressEvent for chunked SLM", async () => {
    const longText = "x".repeat(9000);
    const ocrProvider = makeOcrProvider(longText);
    const fieldVerifier = makeFieldVerifier("[]");
    const events: DocumentProcessingProgressEvent[] = [];

    class ChunkableForProgress implements ChunkableDocumentDefinition<string[]> {
      readonly docType = DOC_TYPE.BANK_STATEMENT;
      readonly maxChunkChars = 4000;
      canChunk(): boolean { return true; }

      parseOutput(raw: string | Record<string, unknown>): string[] {
        const s = typeof raw === "string" ? raw : JSON.stringify(raw);
        return [s];
      }

      mergeChunkOutputs(chunks: string[][]): string[] {
        return chunks.flat();
      }
    }

    const engine = new DocumentProcessingEngine(new ChunkableForProgress(), fieldVerifier, ocrProvider);
    await engine.process(makeCtx(), (evt) => { events.push(evt); });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].stage).toBe("slm-chunk");
    expect(events[0].chunk).toBe(1);
  });
});
