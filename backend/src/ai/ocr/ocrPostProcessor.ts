import type { OcrBlock, OcrResult } from "@/core/interfaces/OcrProvider.js";

export interface MergedBlock {
  text: string;
  page: number;
  blockIndices: number[];
  bboxNormalized: [number, number, number, number];
}

export interface OcrLine {
  text: string;
  page: number;
  blockIndices: number[];
  bboxNormalized: [number, number, number, number];
}

export interface EnhancedOcrResult extends OcrResult {
  mergedBlocks: MergedBlock[];
  lines: OcrLine[];
}

export function postProcessOcrResult(result: OcrResult): EnhancedOcrResult {
  const blocks = result.blocks ?? [];
  const mergedBlocks = mergeBlocks(blocks);
  const lines = buildLines(mergedBlocks);
  return {
    ...result,
    mergedBlocks,
    lines,
  };
}

export function mergeBlocks(blocks: OcrBlock[]): MergedBlock[] {
  if (blocks.length === 0) {
    return [];
  }

  const byPage = new Map<number, Array<{ block: OcrBlock; originalIndex: number }>>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const bbox = block.bboxNormalized;
    if (!bbox) {
      continue;
    }
    const page = block.page;
    let pageBlocks = byPage.get(page);
    if (!pageBlocks) {
      pageBlocks = [];
      byPage.set(page, pageBlocks);
    }
    pageBlocks.push({ block, originalIndex: i });
  }

  const result: MergedBlock[] = [];

  for (const [page, pageEntries] of byPage) {
    pageEntries.sort((a, b) => {
      const bboxA = a.block.bboxNormalized!;
      const bboxB = b.block.bboxNormalized!;
      const yDiff = bboxA[1] - bboxB[1];
      if (Math.abs(yDiff) > 1e-9) {
        return yDiff;
      }
      return bboxA[0] - bboxB[0];
    });

    const merged: MergedBlock[] = pageEntries.map((entry) => {
      const bbox = entry.block.bboxNormalized!;
      return {
        text: entry.block.text,
        page,
        blockIndices: [entry.originalIndex],
        bboxNormalized: [bbox[0], bbox[1], bbox[2], bbox[3]]
      };
    });

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < merged.length; i++) {
        if (merged[i].blockIndices.length === 0) {
          continue;
        }
        for (let j = i + 1; j < merged.length; j++) {
          if (merged[j].blockIndices.length === 0) {
            continue;
          }
          if (shouldMerge(merged[i].bboxNormalized, merged[j].bboxNormalized)) {
            merged[i] = combineMergedBlocks(merged[i], merged[j]);
            merged[j] = { text: "", page, blockIndices: [], bboxNormalized: [0, 0, 0, 0] };
            changed = true;
          }
        }
      }
    }

    for (const block of merged) {
      if (block.blockIndices.length > 0) {
        result.push({
          ...block,
          text: fixOcrDigits(block.text)
        });
      }
    }
  }

  return result;
}

function shouldMerge(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  const aHeight = a[3] - a[1];
  const bHeight = b[3] - b[1];
  const shorterHeight = Math.min(aHeight, bHeight);
  if (shorterHeight <= 0) {
    return false;
  }

  const overlapY1 = Math.max(a[1], b[1]);
  const overlapY2 = Math.min(a[3], b[3]);
  const overlapHeight = overlapY2 - overlapY1;
  if (overlapHeight <= 0) {
    return false;
  }

  const verticalOverlapRatio = overlapHeight / shorterHeight;
  if (verticalOverlapRatio <= 0.7) {
    return false;
  }

  const horizontalGap = Math.max(a[0], b[0]) - Math.min(a[2], b[2]);
  return horizontalGap < 0.02;
}

function combineMergedBlocks(a: MergedBlock, b: MergedBlock): MergedBlock {
  const isALeft = a.bboxNormalized[0] <= b.bboxNormalized[0];
  const text = isALeft ? `${a.text} ${b.text}`.trim() : `${b.text} ${a.text}`.trim();
  const mergedBbox: [number, number, number, number] = [
    Math.min(a.bboxNormalized[0], b.bboxNormalized[0]),
    Math.min(a.bboxNormalized[1], b.bboxNormalized[1]),
    Math.max(a.bboxNormalized[2], b.bboxNormalized[2]),
    Math.max(a.bboxNormalized[3], b.bboxNormalized[3])
  ];
  return {
    text,
    page: a.page,
    blockIndices: [...a.blockIndices, ...b.blockIndices].sort((x, y) => x - y),
    bboxNormalized: mergedBbox
  };
}

function fixOcrDigits(text: string): string {
  return text.replace(/\b[\dOlIoiL,.\s]+\b/g, (match) => {
    if (!/\d/.test(match)) {
      return match;
    }
    return match.replace(/O/g, "0").replace(/l/g, "1");
  });
}

export function buildLines(mergedBlocks: MergedBlock[]): OcrLine[] {
  if (mergedBlocks.length === 0) {
    return [];
  }

  const byPage = new Map<number, MergedBlock[]>();
  for (const block of mergedBlocks) {
    let pageBlocks = byPage.get(block.page);
    if (!pageBlocks) {
      pageBlocks = [];
      byPage.set(block.page, pageBlocks);
    }
    pageBlocks.push(block);
  }

  const lines: OcrLine[] = [];

  for (const [page, pageBlocks] of byPage) {
    const validHeights = pageBlocks
      .map((b) => b.bboxNormalized[3] - b.bboxNormalized[1])
      .filter((h) => h > 0);
    let tolerance = 0.015;
    if (validHeights.length > 0) {
      const sortedHeights = [...validHeights].sort((a, b) => a - b);
      const mid = Math.floor(sortedHeights.length / 2);
      const medianBlockHeight =
        sortedHeights.length % 2 === 1
          ? sortedHeights[mid]
          : (sortedHeights[mid - 1] + sortedHeights[mid]) / 2;
      tolerance = Math.max(0.010, medianBlockHeight * 0.55);
    }

    const sorted = [...pageBlocks].sort((a, b) => {
      const aCenterY = (a.bboxNormalized[1] + a.bboxNormalized[3]) / 2;
      const bCenterY = (b.bboxNormalized[1] + b.bboxNormalized[3]) / 2;
      return aCenterY - bCenterY;
    });

    const lineGroups: MergedBlock[][] = [];
    for (const block of sorted) {
      const centerY = (block.bboxNormalized[1] + block.bboxNormalized[3]) / 2;
      let placed = false;
      for (const group of lineGroups) {
        const groupCenterY = (group[0].bboxNormalized[1] + group[0].bboxNormalized[3]) / 2;
        if (Math.abs(centerY - groupCenterY) <= tolerance) {
          group.push(block);
          placed = true;
          break;
        }
      }
      if (!placed) {
        lineGroups.push([block]);
      }
    }

    for (const group of lineGroups) {
      group.sort((a, b) => a.bboxNormalized[0] - b.bboxNormalized[0]);
      let text = group[0].text;
      for (let i = 1; i < group.length; i++) {
        const gap = group[i].bboxNormalized[0] - group[i - 1].bboxNormalized[2];
        text += gap > 0.02 ? ` | ${group[i].text}` : ` ${group[i].text}`;
      }
      const blockIndices = group.flatMap((b) => b.blockIndices).sort((a, b) => a - b);
      const bboxNormalized: [number, number, number, number] = [
        Math.min(...group.map((b) => b.bboxNormalized[0])),
        Math.min(...group.map((b) => b.bboxNormalized[1])),
        Math.max(...group.map((b) => b.bboxNormalized[2])),
        Math.max(...group.map((b) => b.bboxNormalized[3]))
      ];
      lines.push({ text, page, blockIndices, bboxNormalized });
    }
  }

  return lines;
}

export function buildLayoutText(lines: OcrLine[]): string {
  if (lines.length === 0) {
    return "";
  }

  const byPage = new Map<number, string[]>();
  for (const line of lines) {
    const text = line.text.trim();
    if (!text || /^(text|table|title|line|image)$/i.test(text)) {
      continue;
    }
    let pageLines = byPage.get(line.page);
    if (!pageLines) {
      pageLines = [];
      byPage.set(line.page, pageLines);
    }
    pageLines.push(text);
  }

  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, pageLines]) => pageLines.join("\n"))
    .join("\n\n");
}

