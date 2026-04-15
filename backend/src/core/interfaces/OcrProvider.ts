export interface OcrBlock {
  text: string;
  page: number;
  bbox: [number, number, number, number];
  bboxNormalized?: [number, number, number, number];
  bboxModel?: [number, number, number, number];
  blockType?: string;
  cropPath?: string;
}

export interface OcrPageImage {
  page: number;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
  dpi?: number;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ExtractedField {
  key: string;
  value: string | number | boolean | null;
  page?: number;
  bbox?: [number, number, number, number];
  bboxNormalized?: [number, number, number, number];
  confidence?: number;
}

export type OcrProviderType = "auto" | "deepseek" | "mock" | "llamaparse" | "native-pdf" | "apple_vision";

export interface OcrResult {
  text: string;
  confidence?: number;
  provider: OcrProviderType | string;
  blocks?: OcrBlock[];
  pageImages?: OcrPageImage[];
  tokenUsage?: TokenUsage;
  fields?: ExtractedField[];
  extractedLineItems?: Array<Record<string, unknown>>;
}

export interface OcrExtractionOptions {
  languageHint?: string;
}

export interface OcrProvider {
  readonly name: string;
  extractText(buffer: Buffer, mimeType: string, options?: OcrExtractionOptions): Promise<OcrResult>;
}
