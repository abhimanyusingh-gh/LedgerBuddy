import fs from 'node:fs';
import path from 'node:path';
import { parseInvoiceText } from './src/parser/invoiceParser.ts';
import { recoverParsedFromOcr } from './src/services/extraction/pipeline/ocrRecovery.ts';

type Spec = {
  files: Array<{
    file: string;
    invoiceNumber?: string;
    vendorNameContains?: string;
    invoiceDate?: string;
    dueDate?: string;
    currency?: string;
    totalAmountMinor?: number;
    lineItemAmountsMinor?: number[];
    gst?: {
      subtotalMinor?: number;
      cgstMinor?: number;
      sgstMinor?: number;
      igstMinor?: number;
      totalTaxMinor?: number;
    };
  }>;
};

type OCRFile = { rawText?: string; blocks?: any[]; ocrBlocks?: any[] };

const root = path.resolve(process.cwd(), '..');
const specPath = path.join(root, 'sample-invoices/ground-truth.json');
const rawDir = path.join(root, '.local-run/benchmark/ocr-raw');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as Spec;

const normalizeDate = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  const yyyy = parsed.getUTCFullYear();
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const mismatches: string[] = [];

for (const expected of spec.files) {
  const rawPath = path.join(rawDir, expected.file.replace('.pdf', '.json'));
  if (!fs.existsSync(rawPath)) {
    continue;
  }

  const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8')) as OCRFile;
  const blocks = (raw.blocks ?? raw.ocrBlocks ?? []) as any[];
  const rawText = (raw.rawText ?? '') as string;

  const deterministic = parseInvoiceText(rawText, { languageHint: 'en' });
  const parsed = recoverParsedFromOcr(deterministic.parsed, blocks, rawText);

  const checks: Array<[string, unknown, unknown]> = [
    ['invoiceNumber', expected.invoiceNumber, parsed.invoiceNumber],
    ['invoiceDate', expected.invoiceDate, normalizeDate(parsed.invoiceDate)],
    ['dueDate', expected.dueDate, normalizeDate(parsed.dueDate)],
    ['currency', expected.currency, parsed.currency],
    ['totalAmountMinor', expected.totalAmountMinor, parsed.totalAmountMinor],
    ['cgstMinor', expected.gst?.cgstMinor, parsed.gst?.cgstMinor],
    ['sgstMinor', expected.gst?.sgstMinor, parsed.gst?.sgstMinor],
    ['igstMinor', expected.gst?.igstMinor, parsed.gst?.igstMinor],
    ['subtotalMinor', expected.gst?.subtotalMinor, parsed.gst?.subtotalMinor],
    ['totalTaxMinor', expected.gst?.totalTaxMinor, parsed.gst?.totalTaxMinor]
  ];

  for (const [field, expectedValue, actualValue] of checks) {
    if (expectedValue === undefined) {
      continue;
    }
    if (expectedValue !== actualValue) {
      mismatches.push(`${expected.file} | ${field} | expected=${JSON.stringify(expectedValue)} | actual=${JSON.stringify(actualValue)}`);
    }
  }

  if (expected.vendorNameContains) {
    const actualVendor = (parsed.vendorName ?? '').toLowerCase();
    if (!actualVendor.includes(expected.vendorNameContains.toLowerCase())) {
      mismatches.push(`${expected.file} | vendorNameContains | expected=${expected.vendorNameContains} | actual=${parsed.vendorName ?? null}`);
    }
  }

  if (expected.lineItemAmountsMinor) {
    const expectedLineItems = [...expected.lineItemAmountsMinor].sort((a, b) => a - b);
    const actualLineItems = (parsed.lineItems ?? [])
      .map((entry) => entry.amountMinor)
      .filter((value): value is number => Number.isInteger(value))
      .sort((a, b) => a - b);

    if (JSON.stringify(expectedLineItems) !== JSON.stringify(actualLineItems)) {
      mismatches.push(`${expected.file} | lineItemAmountsMinor | expected=${JSON.stringify(expectedLineItems)} | actual=${JSON.stringify(actualLineItems)}`);
    }
  }
}

console.log(`mismatches=${mismatches.length}`);
for (const line of mismatches) {
  console.log(line);
}
