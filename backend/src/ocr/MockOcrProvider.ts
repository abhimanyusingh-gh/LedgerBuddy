import type { OcrProvider, OcrResult } from "../core/interfaces/OcrProvider.js";

interface MockOcrProviderOptions {
  text?: string;
  confidence?: number;
}

export class MockOcrProvider implements OcrProvider {
  readonly name = "mock";

  private readonly text: string;
  private readonly confidence: number;

  constructor(options?: MockOcrProviderOptions) {
    this.text = options?.text ?? process.env.MOCK_OCR_TEXT ?? "";
    this.confidence = parseConfidence(options?.confidence ?? process.env.MOCK_OCR_CONFIDENCE);
  }

  async extractText(_buffer: Buffer, _mimeType: string): Promise<OcrResult> {
    return {
      text: this.text,
      confidence: this.text ? this.confidence : 0,
      provider: this.name
    };
  }
}

function parseConfidence(rawValue: string | number | undefined): number {
  if (rawValue === undefined || rawValue === "") {
    return 0.95;
  }

  const parsed = Number(rawValue);
  if (Number.isNaN(parsed)) {
    return 0.95;
  }

  if (parsed > 1) {
    return Math.max(0, Math.min(1, parsed / 100));
  }

  return Math.max(0, Math.min(1, parsed));
}
