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

export interface OcrResult {
  text: string;
  confidence?: number;
  provider: string;
  blocks?: OcrBlock[];
  pageImages?: OcrPageImage[];
}

export interface OcrProvider {
  readonly name: string;
  extractText(buffer: Buffer, mimeType: string): Promise<OcrResult>;
}
