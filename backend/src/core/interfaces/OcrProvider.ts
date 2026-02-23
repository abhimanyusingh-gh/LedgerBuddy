export interface OcrBlock {
  text: string;
  page: number;
  bbox: [number, number, number, number];
  bboxNormalized?: [number, number, number, number];
  bboxModel?: [number, number, number, number];
  blockType?: string;
}

export interface OcrResult {
  text: string;
  confidence?: number;
  provider: string;
  blocks?: OcrBlock[];
}

export interface OcrProvider {
  readonly name: string;
  extractText(buffer: Buffer, mimeType: string): Promise<OcrResult>;
}
