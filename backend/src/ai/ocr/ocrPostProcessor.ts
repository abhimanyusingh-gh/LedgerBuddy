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

export interface OcrTable {
  rows: string[][];
  page: number;
  bboxNormalized: [number, number, number, number];
}

export interface NormalizedAmount {
  raw: string;
  minorUnits: number;
  blockIndex: number;
}

export interface NormalizedDate {
  raw: string;
  normalized: string;
  blockIndex: number;
}

export interface NormalizedCurrency {
  symbol: string;
  code: string;
  blockIndex: number;
}

export interface EnhancedOcrResult extends OcrResult {
  mergedBlocks: MergedBlock[];
  lines: OcrLine[];
  tables: OcrTable[];
  normalized: {
    amounts: NormalizedAmount[];
    dates: NormalizedDate[];
    currencies: NormalizedCurrency[];
  };
}

export function postProcessOcrResult(result: OcrResult): EnhancedOcrResult {
  const blocks = result.blocks ?? [];
  const mergedBlocks = mergeBlocks(blocks);
  const lines = buildLines(mergedBlocks);
  const tables = detectTables(lines);
  const normalized = normalizeValues(mergedBlocks);
  return {
    ...result,
    mergedBlocks,
    lines,
    tables,
    normalized
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

const NUMERIC_TOKEN_RE = /^[\d,.\-\/]+$|^\d[\d,.\s]*$/;

function isNumericToken(token: string): boolean {
  return NUMERIC_TOKEN_RE.test(token);
}

export function detectTables(lines: OcrLine[]): OcrTable[] {
  if (lines.length === 0) {
    return [];
  }

  const byPage = new Map<number, OcrLine[]>();
  for (const line of lines) {
    let pageLines = byPage.get(line.page);
    if (!pageLines) {
      pageLines = [];
      byPage.set(line.page, pageLines);
    }
    pageLines.push(line);
  }

  const tables: OcrTable[] = [];

  for (const [page, pageLines] of byPage) {
    const sorted = [...pageLines].sort((a, b) => a.bboxNormalized[1] - b.bboxNormalized[1]);

    const candidateRows: Array<{ line: OcrLine; tokens: string[]; tokenCenters: number[] }> = [];
    for (const line of sorted) {
      const tokens = line.text.split(/\s+/).filter((t) => t.length > 0);
      if (tokens.length < 3) {
        continue;
      }
      const numericCount = tokens.filter((t) => isNumericToken(t)).length;
      if (numericCount < 1) {
        continue;
      }
      const lineWidth = line.bboxNormalized[2] - line.bboxNormalized[0];
      const tokenWidth = lineWidth / tokens.length;
      const tokenCenters = tokens.map((_, idx) => {
        return line.bboxNormalized[0] + tokenWidth * (idx + 0.5);
      });
      candidateRows.push({ line, tokens, tokenCenters });
    }

    if (candidateRows.length < 2) {
      continue;
    }

    const allCenters = candidateRows.flatMap((r) => r.tokenCenters);
    const bucketWidth = 0.05;
    const minCenter = Math.min(...allCenters);
    const maxCenter = Math.max(...allCenters);
    const bucketCount = Math.ceil((maxCenter - minCenter) / bucketWidth) + 1;
    const buckets: number[] = new Array(bucketCount).fill(0);

    for (const center of allCenters) {
      const bucketIdx = Math.floor((center - minCenter) / bucketWidth);
      buckets[Math.min(bucketIdx, bucketCount - 1)]++;
    }

    const activeBuckets: number[] = [];
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i] >= 2) {
        activeBuckets.push(i);
      }
    }

    if (activeBuckets.length < 2) {
      continue;
    }

    const columnCenters = activeBuckets.map((idx) => minCenter + idx * bucketWidth + bucketWidth / 2);

    let runStart = 0;
    while (runStart < candidateRows.length) {
      let runEnd = runStart;
      while (runEnd + 1 < candidateRows.length) {
        const sharedBuckets = countSharedBuckets(
          candidateRows[runEnd].tokenCenters,
          candidateRows[runEnd + 1].tokenCenters,
          minCenter,
          bucketWidth,
          bucketCount
        );
        if (sharedBuckets >= 2) {
          runEnd++;
        } else {
          break;
        }
      }

      if (runEnd - runStart + 1 >= 2) {
        const runRows = candidateRows.slice(runStart, runEnd + 1);
        const grid = buildGrid(runRows, columnCenters, minCenter, bucketWidth, bucketCount);
        if (grid.length >= 2 && grid[0].length >= 2) {
          const bboxNormalized: [number, number, number, number] = [
            Math.min(...runRows.map((r) => r.line.bboxNormalized[0])),
            Math.min(...runRows.map((r) => r.line.bboxNormalized[1])),
            Math.max(...runRows.map((r) => r.line.bboxNormalized[2])),
            Math.max(...runRows.map((r) => r.line.bboxNormalized[3]))
          ];
          tables.push({ rows: grid, page, bboxNormalized });
        }
      }

      runStart = runEnd + 1;
    }
  }

  return tables;
}

function countSharedBuckets(
  centersA: number[],
  centersB: number[],
  minCenter: number,
  bucketWidth: number,
  bucketCount: number
): number {
  const bucketsA = new Set(centersA.map((c) => Math.min(Math.floor((c - minCenter) / bucketWidth), bucketCount - 1)));
  const bucketsB = new Set(centersB.map((c) => Math.min(Math.floor((c - minCenter) / bucketWidth), bucketCount - 1)));
  let count = 0;
  for (const b of bucketsA) {
    if (bucketsB.has(b)) {
      count++;
    }
  }
  return count;
}

function buildGrid(
  rows: Array<{ tokens: string[]; tokenCenters: number[] }>,
  columnCenters: number[],
  minCenter: number,
  bucketWidth: number,
  bucketCount: number
): string[][] {
  return rows.map(({ tokens, tokenCenters }) => {
    const row: string[] = new Array(columnCenters.length).fill("");
    for (let ti = 0; ti < tokens.length; ti++) {
      const center = tokenCenters[ti];
      const bucketIdx = Math.min(Math.floor((center - minCenter) / bucketWidth), bucketCount - 1);
      const colIdx = columnCenters.findIndex(
        (_, ci) => Math.min(Math.floor((columnCenters[ci] - minCenter) / bucketWidth), bucketCount - 1) === bucketIdx
      );
      if (colIdx >= 0) {
        row[colIdx] = row[colIdx] ? `${row[colIdx]} ${tokens[ti]}` : tokens[ti];
      }
    }
    return row;
  });
}

const AMOUNT_RE = /\d{1,3}(?:[,\s]\d{2,3})*(?:\.\d{2})?/g;
const DATE_PATTERNS: Array<{ re: RegExp; parse: (m: RegExpMatchArray) => string | null }> = [
  {
    re: /\b(\d{2})[\/-](\d{2})[\/-](\d{4})\b/g,
    parse: (m) => `${m[3]}-${padTwo(m[2])}-${padTwo(m[1])}`
  },
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    parse: (m) => `${m[1]}-${padTwo(m[2])}-${padTwo(m[3])}`
  },
  {
    re: /\b(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})\b/g,
    parse: (m) => {
      const monthNum = parseMonthName(m[2]);
      if (monthNum === null) {
        return null;
      }
      const year = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${year}-${padTwo(String(monthNum))}-${padTwo(m[1])}`;
    }
  }
];

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function parseMonthName(name: string): number | null {
  const lower = name.toLowerCase().slice(0, 3);
  return MONTH_MAP[lower] ?? null;
}

function padTwo(value: string): string {
  return value.padStart(2, "0");
}

const CURRENCY_PATTERNS: Array<{ re: RegExp; symbol: string; code: string }> = [
  { re: /₹|Rs\.?|INR/g, symbol: "₹", code: "INR" },
  { re: /\$|USD/g, symbol: "$", code: "USD" },
  { re: /€|EUR/g, symbol: "€", code: "EUR" },
  { re: /£|GBP/g, symbol: "£", code: "GBP" }
];

export function normalizeValues(mergedBlocks: MergedBlock[]): {
  amounts: NormalizedAmount[];
  dates: NormalizedDate[];
  currencies: NormalizedCurrency[];
} {
  const amounts: NormalizedAmount[] = [];
  const dates: NormalizedDate[] = [];
  const currencies: NormalizedCurrency[] = [];

  for (let blockIdx = 0; blockIdx < mergedBlocks.length; blockIdx++) {
    const block = mergedBlocks[blockIdx];
    const text = block.text;

    const amountMatches = [...text.matchAll(AMOUNT_RE)];
    for (const match of amountMatches) {
      const raw = match[0];
      const minorUnits = parseAmountToMinorUnits(raw);
      if (minorUnits !== null) {
        amounts.push({ raw, minorUnits, blockIndex: blockIdx });
      }
    }

    for (const { re, parse } of DATE_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpMatchArray | null;
      while ((match = re.exec(text)) !== null) {
        const normalized = parse(match);
        if (normalized && isValidDate(normalized)) {
          dates.push({ raw: match[0], normalized, blockIndex: blockIdx });
        }
      }
    }

    for (const { re, symbol, code } of CURRENCY_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(text)) {
        currencies.push({ symbol, code, blockIndex: blockIdx });
      }
    }
  }

  return { amounts, dates, currencies };
}

function parseAmountToMinorUnits(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(/,/g, "");
  const parsed = parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 100);
}

function isValidDate(normalized: string): boolean {
  const parts = normalized.split("-");
  if (parts.length !== 3) {
    return false;
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (year < 1900 || year > 2100) {
    return false;
  }
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > 31) {
    return false;
  }
  return true;
}
