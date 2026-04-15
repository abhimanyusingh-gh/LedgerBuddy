import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { OcrLine } from "@/ai/ocr/ocrPostProcessor.js";
import { buildLayoutText } from "@/ai/ocr/ocrPostProcessor.js";
import { BLOCK_SCALE, type BlockScale, type OcrTextCandidateId } from "@/types/ocrRecovery.js";

export interface RankedOcrTextCandidate {
  id: OcrTextCandidateId;
  text: string;
  score: number;
  metrics: {
    tokenCount: number;
    lineCount: number;
    lowQualityTokenRatio: number;
    duplicateLineRatio: number;
    numericTokenRatio: number;
    labelSignalCount: number;
  };
}

interface RankedOcrTextCandidates {
  primary: RankedOcrTextCandidate;
  ranked: RankedOcrTextCandidate[];
  keyValueText: string;
  augmentedText: string;
}

const STRUCTURAL_LINE_RE = /^(text|table|title|line|image)$/i;
const LABEL_SIGNAL_RE =
  /\b(invoice|bill|receipt|vendor|supplier|date|due|total|amount|currency|gst|tax|net|grand)\b/gi;
const MAX_LINES = 850;

export function buildRankedOcrTextCandidates(params: {
  rawText: string;
  blocks: OcrBlock[];
  layoutLines: OcrLine[];
  enableKeyValueGrounding: boolean;
}): RankedOcrTextCandidates {
  const rawText = normalizeOcrTextForSlm(params.rawText);
  const blockText = normalizeOcrTextForSlm(buildBlocksText(params.blocks));
  const layoutText = normalizeOcrTextForSlm(buildLayoutText(params.layoutLines));
  const keyValueText = params.enableKeyValueGrounding
    ? normalizeOcrTextForSlm(buildKeyValueGroundingText(params.blocks))
    : "";
  const augmentedText = normalizeOcrTextForSlm(buildAugmentedGroundingText(keyValueText, layoutText || blockText, rawText));

  const ranked = rankUniqueCandidates([
    { id: "layout", text: layoutText },
    { id: "blocks", text: blockText },
    { id: "raw", text: rawText },
    { id: "keyValue", text: keyValueText },
    { id: "augmented", text: augmentedText }
  ]);

  const primary = ranked[0] ?? {
    id: "raw" as const,
    text: rawText,
    score: 0,
    metrics: {
      tokenCount: 0,
      lineCount: 0,
      lowQualityTokenRatio: 1,
      duplicateLineRatio: 1,
      numericTokenRatio: 0,
      labelSignalCount: 0
    }
  };

  return {
    primary,
    ranked,
    keyValueText,
    augmentedText
  };
}

export function normalizeOcrTextForSlm(text: string): string {
  if (!text.trim()) {
    return "";
  }

  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) =>
      line
        .replace(/[^\S\n]+/g, " ")
        .replace(/[|]{3,}/g, " | ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim()
    )
    .filter((line) => line.length > 0)
    .filter((line) => !STRUCTURAL_LINE_RE.test(line))
    .filter((line) => !/^[\s\-_=.:;,*'"|]+$/.test(line))
    .slice(0, MAX_LINES);

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) {
      continue;
    }
    deduped.push(line);
  }

  return deduped.join("\n").trim();
}

function rankUniqueCandidates(candidates: Array<{ id: RankedOcrTextCandidate["id"]; text: string }>): RankedOcrTextCandidate[] {
  const byText = new Map<string, RankedOcrTextCandidate>();
  for (const candidate of candidates) {
    const text = candidate.text.trim();
    if (!text) {
      continue;
    }
    const key = dedupeKey(text);
    const scored = scoreCandidate(candidate.id, text);
    const previous = byText.get(key);
    if (!previous || scored.score > previous.score) {
      byText.set(key, scored);
    }
  }

  return [...byText.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.text.length - left.text.length;
  });
}

function dedupeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCandidate(id: RankedOcrTextCandidate["id"], text: string): RankedOcrTextCandidate {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const tokens = text.split(/\s+/).map((token) => token.trim()).filter((token) => token.length > 0);
  const tokenCount = tokens.length;
  const lineCount = lines.length;
  const lowQualityTokenCount = tokens.filter((token) => isLowQualityToken(token)).length;
  const lowQualityTokenRatio = tokenCount > 0 ? lowQualityTokenCount / tokenCount : 1;
  const uniqueLineCount = new Set(lines.map((line) => line.toLowerCase())).size;
  const duplicateLineRatio = lineCount > 0 ? 1 - uniqueLineCount / lineCount : 1;
  const numericTokenCount = tokens.filter((token) => /\d/.test(token)).length;
  const numericTokenRatio = tokenCount > 0 ? numericTokenCount / tokenCount : 0;
  const labelSignalCount = new Set((text.toLowerCase().match(LABEL_SIGNAL_RE) ?? []).map((entry) => entry.trim())).size;

  let score = 0;
  score += Math.min(42, tokenCount * 0.08);
  score += Math.min(14, lineCount * 0.5);
  score += Math.min(20, labelSignalCount * 3.2);
  score += Math.max(0, 16 - Math.abs(numericTokenRatio - 0.24) * 55);
  score -= lowQualityTokenRatio * 26;
  score -= duplicateLineRatio * 15;
  score += variantBias(id);

  return {
    id,
    text,
    score: Number(score.toFixed(3)),
    metrics: {
      tokenCount,
      lineCount,
      lowQualityTokenRatio: Number(lowQualityTokenRatio.toFixed(4)),
      duplicateLineRatio: Number(duplicateLineRatio.toFixed(4)),
      numericTokenRatio: Number(numericTokenRatio.toFixed(4)),
      labelSignalCount
    }
  };
}

function variantBias(id: RankedOcrTextCandidate["id"]): number {
  if (id === "augmented") {
    return 8;
  }
  if (id === "layout") {
    return 5;
  }
  if (id === "blocks") {
    return 2;
  }
  return 0;
}

function isLowQualityToken(token: string): boolean {
  const normalized = token.replace(/[^\p{L}\p{N}$₹€£.,\-/_]/gu, "");
  if (!normalized) {
    return true;
  }
  if (normalized.length === 1 && !/[\p{L}\p{N}]/u.test(normalized)) {
    return true;
  }
  const symbolRatio = (token.match(/[^A-Za-z0-9]/g) ?? []).length / Math.max(1, token.length);
  if (symbolRatio > 0.6 && !/\d/.test(token)) {
    return true;
  }
  return false;
}

export function buildBlocksText(blocks: OcrBlock[]): string {
  if (blocks.length === 0) {
    return "";
  }

  return blocks
    .map((block) => block.text.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(text|table|title|line|image)$/i.test(line))
    .join("\n");
}

export function buildKeyValueGroundingText(blocks: OcrBlock[]): string {
  if (blocks.length < 2) {
    return "";
  }

  const labelPattern =
    /\b(invoice(?:\s*number)?|facture|factuurnummer|rechnungsnummer|vendor|supplier|fournisseur|due(?:\s*date)?|date|total|amount|currency|betrag|montant|numero)\b/i;

  const normalizedBlocks = blocks
    .map((block) => ({
      block,
      bbox: block.bboxNormalized ?? block.bboxModel ?? block.bbox,
      text: block.text.trim()
    }))
    .filter((entry) => entry.text.length > 0)
    .sort((left, right) => {
      if (left.block.page !== right.block.page) {
        return left.block.page - right.block.page;
      }
      return left.bbox[1] - right.bbox[1];
    });

  const lines: string[] = [];
  for (const entry of normalizedBlocks) {
    const labelText = entry.text.replace(/[:\-]+$/, "").trim();
    if (!labelPattern.test(labelText)) {
      continue;
    }

    const scale = inferBlockScale(entry.bbox);
    const maxYDrift = scale === "normalized" ? 0.06 : 42;
    const minXDrift = scale === "normalized" ? -0.03 : -24;
    const labelRight = entry.bbox[2];
    const labelCenterY = (entry.bbox[1] + entry.bbox[3]) / 2;
    const candidate = normalizedBlocks
      .filter((blockEntry) => blockEntry.block.page === entry.block.page && blockEntry.block !== entry.block)
      .map((blockEntry) => {
        const valueCenterY = (blockEntry.bbox[1] + blockEntry.bbox[3]) / 2;
        const yDrift = Math.abs(valueCenterY - labelCenterY);
        const xDrift = blockEntry.bbox[0] - labelRight;
        return {
          ...blockEntry,
          yDrift,
          xDrift
        };
      })
      .filter((blockEntry) => blockEntry.xDrift >= minXDrift && blockEntry.yDrift <= maxYDrift)
      .sort((left, right) => {
        if (left.yDrift !== right.yDrift) {
          return left.yDrift - right.yDrift;
        }
        return left.xDrift - right.xDrift;
      })[0];

    if (!candidate) {
      continue;
    }

    const valueText = candidate.text.replace(/\s+/g, " ").trim();
    if (!valueText || labelPattern.test(valueText) || valueText.length > 100) {
      continue;
    }

    lines.push(`${labelText}: ${valueText}`);
  }

  return [...new Set(lines)].join("\n");
}

export function buildAugmentedGroundingText(keyValueText: string, blockText: string, rawText: string): string {
  const sections = [keyValueText, blockText, rawText]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (sections.length < 2) {
    return "";
  }

  return sections.join("\n\n");
}

function inferBlockScale(bbox: [number, number, number, number]): BlockScale {
  if (bbox.every((value) => Number.isFinite(value) && Math.abs(value) <= 2.5)) {
    return BLOCK_SCALE.NORMALIZED;
  }
  return BLOCK_SCALE.PIXEL;
}
