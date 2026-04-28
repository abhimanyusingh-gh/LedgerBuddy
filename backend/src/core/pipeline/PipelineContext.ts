import type { Types } from "mongoose";
import type { DocumentMimeType } from "@/types/mime.js";
import type { UUID } from "@/types/uuid.js";

export interface PipelineInput {
  tenantId: UUID;
  clientOrgId: Types.ObjectId | string | null;
  fileName: string;
  mimeType: DocumentMimeType;
  fileBuffer: Buffer;
  [key: string]: unknown;
}

export interface PipelineContext {
  readonly input: PipelineInput;
  readonly store: ContextStore;
  readonly metadata: Record<string, string>;
  readonly issues: string[];
}

export class ContextStore {
  private data = new Map<string, unknown>();

  set<T>(key: string, value: T): void {
    this.data.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  require<T>(key: string): T {
    const value = this.data.get(key);
    if (value === undefined) {
      throw new Error(`Pipeline context missing required key: "${key}"`);
    }
    return value as T;
  }

  has(key: string): boolean {
    return this.data.has(key);
  }
}
