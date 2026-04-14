import type { BBox, ParsingGetResponse } from "@llamaindex/llama-cloud/resources/parsing";
import LlamaCloud from "@llamaindex/llama-cloud";
import type { OcrBlock, OcrExtractionOptions, OcrPageImage, OcrProvider, OcrResult, ExtractedField } from "@/core/interfaces/OcrProvider.js";
import { logger } from "@/utils/logger.js";
import { buildOcrRequestError } from "./OcrProviderSupport.js";
import { LLAMA_EXTRACT_INVOICE_SCHEMA } from "@/ai/schemas/invoice/llamaExtractInvoiceSchema.js";

const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/x-png"
]);

type LlamaParseOcrTier = "fast" | "cost_effective" | "agentic" ;
type LlamaExtractTier = "cost_effective" | "agentic";

type AnyItem =
  | ParsingGetResponse.Items.StructuredResultPage["items"][number];

interface LlamaParseOcrProviderOptions {
  apiKey?: string;
  tier?: LlamaParseOcrTier;
  optimizeMode?: LlamaParseOcrTier;
  customPrompt?: string;
  extractEnabled?: boolean;
  extractTier?: LlamaExtractTier;
  extractSystemPrompt?: string;
}

export class LlamaParseOcrProvider implements OcrProvider {
  readonly name = "llamaparse";
  private readonly client: LlamaCloud;
  private readonly tier: LlamaParseOcrTier;
  private readonly customPrompt: string | undefined;
  private readonly extractEnabled: boolean;
  private readonly extractTier: LlamaExtractTier;
  private readonly extractSystemPrompt: string | undefined;

  constructor(options?: LlamaParseOcrProviderOptions) {
    const apiKey = options?.apiKey ?? process.env.LLAMA_CLOUD_API_KEY ?? "";
    const optimizeModeEnv = process.env.LLAMA_PARSE_OPTIMIZE_MODE as LlamaParseOcrTier | undefined;
    const tierEnv = process.env.LLAMA_PARSE_TIER as LlamaParseOcrTier | undefined;
    this.tier = options?.optimizeMode ?? options?.tier ?? optimizeModeEnv ?? tierEnv ?? "cost_effective";
    this.customPrompt = options?.customPrompt ?? process.env.LLAMA_PARSE_CUSTOM_PROMPT;
    this.client = new LlamaCloud({ apiKey });
    this.extractEnabled = options?.extractEnabled ?? (process.env.LLAMA_PARSE_EXTRACT_ENABLED === "true");
    this.extractTier = options?.extractTier ?? (process.env.LLAMA_PARSE_EXTRACT_TIER as LlamaExtractTier | undefined) ?? "agentic";
    this.extractSystemPrompt = options?.extractSystemPrompt ?? process.env.LLAMA_EXTRACT_SYSTEM_PROMPT;
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
      const supportsAgenticOptions = this.tier === "cost_effective" || this.tier === "agentic" ;
      const result = await this.client.parsing.parse({
        file_id: fileObj.id,
        tier: this.tier,
        version: "latest",
        expand: ["markdown_full", "items", "images_content_metadata"],
        output_options: {
          images_to_save: ["screenshot"],
          markdown: {
            tables: {
              merge_continued_tables: true,
              output_tables_as_markdown: true,
            },
          },
        },
        processing_options: {
          aggressive_table_extraction: true,
          ignore: { ignore_text_in_image: true },
        },
        ...(supportsAgenticOptions && this.customPrompt !== undefined
          ? { agentic_options: { custom_prompt: this.customPrompt } }
          : {}),
      });
      const text = result.markdown_full ?? "";
      const blocks = buildBlocks(result.items);
      const pageImages = await downloadScreenshots(result.images_content_metadata);

      let fields: ExtractedField[] | undefined;
      let extractedLineItems: Array<Record<string, unknown>> | undefined;
      if (this.extractEnabled) {
        const parseJobId = result.job?.id ?? fileObj.id;
        const extracted = await this.runExtract(parseJobId);
        if (extracted.fields.length > 0) {
          fields = extracted.fields;
        }
        if (extracted.lineItems.length > 0) {
          extractedLineItems = extracted.lineItems;
        }
      }

      try {
        await this.client.files.delete(fileObj.id);
      } catch (deleteErr) {
        logger.warn("ocr.file.delete.failed", { provider: this.name, fileId: fileObj.id, error: String(deleteErr) });
      }
      logger.info("ocr.request.end", { provider: this.name, mimeType, latencyMs: Date.now() - startedAt, chars: text.length, blockCount: blocks.length, pageImageCount: pageImages.length });
      return { text, provider: this.name, blocks, pageImages, fields, extractedLineItems };
    } catch (error) {
      logger.error("ocr.request.failed", { provider: this.name, mimeType, latencyMs: Date.now() - startedAt, error: buildOcrRequestError(this.name, error) });
      throw new Error(buildOcrRequestError(this.name, error));
    }
  }

  private async runExtract(fileInput: string): Promise<{ fields: ExtractedField[]; lineItems: Array<Record<string, unknown>> }> {
    try {
      const job = await this.client.extract.create({
        file_input: fileInput,
        configuration: {
          data_schema: LLAMA_EXTRACT_INVOICE_SCHEMA,
          cite_sources: true,
          confidence_scores: true,
          tier: this.extractTier,
          extraction_target: "per_doc",
          ...(this.extractSystemPrompt ? { system_prompt: this.extractSystemPrompt } : {})
        },
      });
      const completed = await this.client.extract.waitForCompletion(job.id, { expand: ["extract_metadata"] });
      return mapExtractResult(completed.extract_result, completed.extract_metadata?.field_metadata?.document_metadata);
    } catch (err) {
      logger.warn("ocr.extract.failed", { provider: this.name, fileInput, error: String(err) });
      return { fields: [], lineItems: [] };
    }
  }
}

function mapExtractResult(
  extractResult: unknown,
  documentMetadata: unknown
): { fields: ExtractedField[]; lineItems: Array<Record<string, unknown>> } {
  if (!extractResult || typeof extractResult !== "object" || Array.isArray(extractResult)) {
    return { fields: [], lineItems: [] };
  }
  const result = extractResult as Record<string, unknown>;
  const meta = (documentMetadata && typeof documentMetadata === "object" && !Array.isArray(documentMetadata))
    ? (documentMetadata as Record<string, unknown>)
    : {};

  const lineItems: Array<Record<string, unknown>> = [];
  if (Array.isArray(result["line_items"])) {
    for (const item of result["line_items"]) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        lineItems.push(item as Record<string, unknown>);
      }
    }
  }

  const fields: ExtractedField[] = [];
  for (const key of Object.keys(result)) {
    if (key === "line_items") continue;
    const raw = result[key];
    if (raw === null || raw === undefined) {
      continue;
    }
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
      continue;
    }
    const field: ExtractedField = { key, value: raw };
    const fieldMeta = meta[key];
    if (fieldMeta && typeof fieldMeta === "object" && !Array.isArray(fieldMeta)) {
      const fm = fieldMeta as Record<string, unknown>;
      const citations = Array.isArray(fm["citations"]) ? fm["citations"] : (Array.isArray(fm["citation"]) ? fm["citation"] : []);
      if (citations.length > 0) {
        let bestBbox: Record<string, unknown> | undefined;
        let bestCitation: Record<string, unknown> | undefined;
        let bestArea = Infinity;
        for (const c of citations) {
          const cit = c as Record<string, unknown>;
          const bboxArr = Array.isArray(cit["bounding_boxes"]) ? cit["bounding_boxes"] : [];
          for (const b of bboxArr) {
            const bRaw = b as Record<string, unknown>;
            if (typeof bRaw["x"] !== "number" || typeof bRaw["y"] !== "number" || typeof bRaw["w"] !== "number" || typeof bRaw["h"] !== "number") {
              continue;
            }
            const area = (bRaw["w"] as number) * (bRaw["h"] as number);
            if (area < bestArea) {
              bestArea = area;
              bestBbox = bRaw;
              bestCitation = cit;
            }
          }
        }
        if (bestCitation && typeof bestCitation["page"] === "number") {
          field.page = bestCitation["page"];
        }
        if (bestBbox && bestCitation) {
          const dims = bestCitation["page_dimensions"] as Record<string, unknown> | undefined;
          const x1 = bestBbox["x"] as number;
          const y1 = bestBbox["y"] as number;
          const x2 = x1 + (bestBbox["w"] as number);
          const y2 = y1 + (bestBbox["h"] as number);
          field.bbox = [x1, y1, x2, y2];
          const pw = typeof dims?.["width"] === "number" ? (dims["width"] as number) : 0;
          const ph = typeof dims?.["height"] === "number" ? (dims["height"] as number) : 0;
          if (pw > 0 && ph > 0) {
            field.bboxNormalized = [x1 / pw, y1 / ph, x2 / pw, y2 / ph];
          }
        }
      }
      if (typeof fm["confidence"] === "number") {
        field.confidence = fm["confidence"];
      }
    }
    fields.push(field);
  }
  return { fields, lineItems };
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
    const sorted = [...pageItems].sort((a, b) => {
      const ay = (a as { bbox?: Array<BBox> }).bbox?.[0]?.y ?? 0;
      const by = (b as { bbox?: Array<BBox> }).bbox?.[0]?.y ?? 0;
      return ay - by;
    });
    for (const item of sorted) {
      const bboxList = (item as { bbox?: Array<BBox> | null }).bbox;
      if (!bboxList || bboxList.length === 0) {
        continue;
      }
      const text = pickText(item);
      if (!text || !text.trim()) {
        continue;
      }
      for (const bboxEntry of bboxList) {
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
  }
  return blocks;
}

function pickText(item: AnyItem): string {
  const typed = item as {
    type?: string;
    md?: string;
    value?: string;
    text?: string;
    caption?: string;
  };
  switch (typed.type) {
    case "table":
      return typed.md ?? "";
    case "image":
      return typed.caption ?? typed.md ?? "";
    case "link":
      return typed.text ?? typed.md ?? "";
    case "list":
    case "header":
    case "footer":
      return typed.md ?? "";
    case "heading":
    case "text":
    case "code":
    default:
      return typed.value ?? typed.text ?? typed.md ?? "";
  }
}

async function downloadScreenshots(
  meta: ParsingGetResponse["images_content_metadata"] | null | undefined
): Promise<OcrPageImage[]> {
  const screenshots = (meta?.images ?? []).filter(
    (img) => img.category === "screenshot" && img.presigned_url
  );
  if (screenshots.length === 0) {
    return [];
  }

  const results: OcrPageImage[] = [];
  await Promise.all(
    screenshots.map(async (img) => {
      try {
        const response = await fetch(img.presigned_url!);
        if (!response.ok) return;
        const buffer = Buffer.from(await response.arrayBuffer());
        const mimeType = img.content_type ?? "image/png";
        results.push({
          page: img.index + 1,
          mimeType,
          dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
        });
      } catch {
      }
    })
  );
  results.sort((a, b) => a.page - b.page);
  return results;
}
