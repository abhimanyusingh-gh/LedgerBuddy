import type { BBox, ParsingGetResponse } from "@llamaindex/llama-cloud/resources/parsing";
import LlamaCloud from "@llamaindex/llama-cloud";
import type { OcrBlock, OcrExtractionOptions, OcrProvider, OcrResult } from "../core/interfaces/OcrProvider.js";
import { logger } from "../utils/logger.js";
import { buildOcrRequestError } from "./OcrProviderSupport.js";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/x-png"
]);

type LlamaParseOcrTier = "fast" | "cost_effective" | "agentic" | "agentic_plus";

type AnyItem =
  | ParsingGetResponse.Items.StructuredResultPage["items"][number];

interface LlamaParseOcrProviderOptions {
  apiKey?: string;
  tier?: LlamaParseOcrTier;
}

export class LlamaParseOcrProvider implements OcrProvider {
  readonly name = "llamaparse";
  private readonly client: LlamaCloud;
  private readonly tier: LlamaParseOcrTier;

  constructor(options?: LlamaParseOcrProviderOptions) {
    const apiKey = options?.apiKey ?? process.env.LLAMA_CLOUD_API_KEY ?? "";
    this.tier = options?.tier ?? (process.env.LLAMA_PARSE_TIER as LlamaParseOcrTier) ?? "cost_effective";
    this.client = new LlamaCloud({ apiKey });
  }

  async extractText(buffer: Buffer, mimeType: string, _options?: OcrExtractionOptions): Promise<OcrResult> {
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      return { text: "", confidence: 0, provider: this.name };
    }
    const startedAt = Date.now();
    logger.info("ocr.request.start", { provider: this.name, mimeType, tier: this.tier, payloadBytes: buffer.length });
    try {
      const file = new File([new Uint8Array(buffer)], "invoice.pdf", { type: mimeType });
      const fileObj = await this.client.files.create({ file, purpose: "parse" });
      const result = await this.client.parsing.parse({
        file_id: fileObj.id,
        tier: this.tier,
        version: "latest",
        expand: ["markdown_full", "items"],
      });
      const text = result.markdown_full ?? "";
      const blocks = buildBlocks(result.items);
      logger.info("ocr.request.end", { provider: this.name, mimeType, latencyMs: Date.now() - startedAt, chars: text.length, blockCount: blocks.length });
      return { text, provider: this.name, blocks };
    } catch (error) {
      logger.error("ocr.request.failed", { provider: this.name, mimeType, latencyMs: Date.now() - startedAt, error: buildOcrRequestError(this.name, error) });
      throw new Error(buildOcrRequestError(this.name, error));
    }
  }
}

function buildBlocks(items: ParsingGetResponse["items"] | null | undefined): OcrBlock[] {
  if (!items?.pages) {
    return [];
  }
  const blocks: OcrBlock[] = [];
  for (const page of items.pages) {
    if (!page.success) {
      continue;
    }
    const { page_number, page_width, page_height, items: pageItems } = page;
    for (const item of pageItems) {
      const bboxEntry = pickBbox(item);
      if (!bboxEntry) {
        continue;
      }
      const text = pickText(item);
      if (!text) {
        continue;
      }
      const x1 = bboxEntry.x;
      const y1 = bboxEntry.y;
      const x2 = bboxEntry.x + bboxEntry.w;
      const y2 = bboxEntry.y + bboxEntry.h;
      const block: OcrBlock = {
        text,
        page: page_number,
        bbox: [x1, y1, x2, y2],
        blockType: item.type ?? "text",
      };
      if (page_width > 0 && page_height > 0) {
        block.bboxNormalized = [x1 / page_width, y1 / page_height, x2 / page_width, y2 / page_height];
      }
      blocks.push(block);
    }
  }
  return blocks;
}

function pickBbox(item: AnyItem): BBox | null {
  const bboxList = (item as { bbox?: Array<BBox> | null }).bbox;
  return bboxList?.[0] ?? null;
}

function pickText(item: AnyItem): string {
  if (item.type === "table") {
    return (item as { md: string }).md;
  }
  const v = (item as { value?: string }).value;
  return v ?? "";
}
