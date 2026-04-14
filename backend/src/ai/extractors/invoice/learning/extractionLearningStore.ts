import { ExtractionLearningModel } from "../../../../models/invoice/ExtractionLearning.js";
import { logger } from "../../../../utils/logger.js";

const MAX_CORRECTIONS_PER_DOCUMENT = 6;
const MAX_HINT_LENGTH = 80;

export interface CorrectionEntry {
  field: string;
  hint: string;
  count: number;
  lastSeen: Date;
}

export interface ExtractionLearningStore {
  findCorrections(tenantId: string, invoiceType: string, fingerprintKey: string): Promise<CorrectionEntry[]>;
  recordCorrections(
    tenantId: string,
    groupKey: string,
    groupType: "invoice-type" | "vendor",
    corrections: CorrectionEntry[]
  ): Promise<void>;
}

export class MongoExtractionLearningStore implements ExtractionLearningStore {
  async findCorrections(tenantId: string, invoiceType: string, fingerprintKey: string): Promise<CorrectionEntry[]> {
    try {
      const [typeDoc, vendorDoc] = await Promise.all([
        ExtractionLearningModel.findOne({ tenantId, groupKey: invoiceType, groupType: "invoice-type" }).lean(),
        ExtractionLearningModel.findOne({ tenantId, groupKey: fingerprintKey, groupType: "vendor" }).lean()
      ]);

      const typeCorrections = normalizeCorrections(typeDoc?.corrections);
      const vendorCorrections = normalizeCorrections(vendorDoc?.corrections);
      return mergeCorrections(typeCorrections, vendorCorrections);
    } catch (error) {
      logger.warn("extraction.learning.lookup.failed", { tenantId, invoiceType, fingerprintKey, error: toErrorMessage(error) });
      return [];
    }
  }

  async recordCorrections(
    tenantId: string,
    groupKey: string,
    groupType: "invoice-type" | "vendor",
    corrections: CorrectionEntry[]
  ): Promise<void> {
    try {
      const doc = await ExtractionLearningModel.findOne({ tenantId, groupKey, groupType });
      const existing = normalizeCorrections(doc?.corrections);
      const merged = upsertCorrections(existing, corrections);

      await ExtractionLearningModel.findOneAndUpdate(
        { tenantId, groupKey, groupType },
        { $set: { corrections: merged } },
        { upsert: true }
      );
    } catch (error) {
      logger.warn("extraction.learning.persist.failed", { tenantId, groupKey, groupType, error: toErrorMessage(error) });
    }
  }
}

const IN_MEMORY_MAX_KEYS = 500;

export class InMemoryExtractionLearningStore implements ExtractionLearningStore {
  private readonly store = new Map<string, CorrectionEntry[]>();

  async findCorrections(tenantId: string, invoiceType: string, fingerprintKey: string): Promise<CorrectionEntry[]> {
    const typeCorrections = this.store.get(`${tenantId}|invoice-type|${invoiceType}`) ?? [];
    const vendorCorrections = this.store.get(`${tenantId}|vendor|${fingerprintKey}`) ?? [];
    return mergeCorrections(typeCorrections, vendorCorrections);
  }

  async recordCorrections(
    tenantId: string,
    groupKey: string,
    groupType: "invoice-type" | "vendor",
    corrections: CorrectionEntry[]
  ): Promise<void> {
    const key = `${tenantId}|${groupType}|${groupKey}`;
    const existing = this.store.get(key) ?? [];
    this.store.set(key, upsertCorrections(existing, corrections));
    if (this.store.size > IN_MEMORY_MAX_KEYS) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }
}

function normalizeCorrections(raw: unknown): CorrectionEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is { field: string; hint: string; count?: number; lastSeen?: Date } =>
      typeof entry?.field === "string" && typeof entry?.hint === "string"
    )
    .map((entry) => ({
      field: entry.field,
      hint: entry.hint.slice(0, MAX_HINT_LENGTH),
      count: typeof entry.count === "number" ? entry.count : 1,
      lastSeen: entry.lastSeen instanceof Date ? entry.lastSeen : new Date()
    }));
}

function mergeCorrections(typeLevel: CorrectionEntry[], vendorLevel: CorrectionEntry[]): CorrectionEntry[] {
  const merged = new Map<string, CorrectionEntry>();
  for (const entry of typeLevel) {
    merged.set(entry.field, entry);
  }
  for (const entry of vendorLevel) {
    merged.set(entry.field, entry);
  }
  return [...merged.values()];
}

function upsertCorrections(existing: CorrectionEntry[], incoming: CorrectionEntry[]): CorrectionEntry[] {
  const byField = new Map<string, CorrectionEntry>();
  for (const entry of existing) {
    byField.set(entry.field, entry);
  }

  for (const entry of incoming) {
    const prev = byField.get(entry.field);
    const entryLastSeen = entry.lastSeen instanceof Date ? entry.lastSeen : new Date();
    if (prev) {
      byField.set(entry.field, {
        field: entry.field,
        hint: entry.hint.slice(0, MAX_HINT_LENGTH),
        count: prev.count + 1,
        lastSeen: entryLastSeen > prev.lastSeen ? entryLastSeen : prev.lastSeen
      });
    } else {
      byField.set(entry.field, {
        field: entry.field,
        hint: entry.hint.slice(0, MAX_HINT_LENGTH),
        count: 1,
        lastSeen: entryLastSeen
      });
    }
  }

  const all = [...byField.values()];
  if (all.length <= MAX_CORRECTIONS_PER_DOCUMENT) return all;

  all.sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());
  return all.slice(0, MAX_CORRECTIONS_PER_DOCUMENT);
}

export function buildCorrectionHint(field: string, before: unknown, after: unknown): string {
  const afterStr = formatValue(after);
  const beforeStr = formatValue(before);
  if (!afterStr) return "";

  let hint: string;
  if (beforeStr && beforeStr !== afterStr) {
    hint = `${afterStr} not ${beforeStr}`;
  } else {
    hint = afterStr;
  }

  return hint.slice(0, MAX_HINT_LENGTH);
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  return String(value);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
