import { promises as fs } from "node:fs";
import path from "node:path";
import type { IngestedFile, IngestionSource } from "@/core/interfaces/IngestionSource.js";
import type { WorkloadTier } from "@/types/tenant.js";

interface FolderSourceConfig {
  key: string;
  tenantId?: string;
  workloadTier?: WorkloadTier;
  folderPath: string;
  recursive?: boolean;
}

interface FolderEntry {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  mtimeMs: number;
  mimeType: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

export class FolderIngestionSource implements IngestionSource {
  readonly type = "folder";

  readonly key: string;
  readonly tenantId: string;
  readonly workloadTier: WorkloadTier;

  private readonly folderPath: string;

  private readonly recursive: boolean;

  constructor(config: FolderSourceConfig) {
    this.key = config.key;
    this.tenantId = config.tenantId ?? "default";
    this.workloadTier = config.workloadTier ?? "standard";
    this.folderPath = path.resolve(config.folderPath);
    this.recursive = config.recursive ?? false;
  }

  async fetchNewFiles(_lastCheckpoint: string | null): Promise<IngestedFile[]> {
    const stats = await fs.stat(this.folderPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
      throw new Error(`Folder source path '${this.folderPath}' does not exist or is not a directory.`);
    }

    const entries = await collectInvoiceFiles(this.folderPath, this.recursive);

    entries.sort((a, b) => {
      if (a.mtimeMs !== b.mtimeMs) {
        return a.mtimeMs - b.mtimeMs;
      }

      return a.relativePath.localeCompare(b.relativePath);
    });

    const files: IngestedFile[] = [];
    for (const entry of entries) {
      const buffer = await fs.readFile(entry.absolutePath);
      files.push({
        tenantId: this.tenantId,
        workloadTier: this.workloadTier,
        sourceKey: this.key,
        sourceType: this.type,
        sourceDocumentId: entry.relativePath,
        attachmentName: entry.fileName,
        mimeType: entry.mimeType,
        receivedAt: new Date(entry.mtimeMs),
        buffer,
        checkpointValue: buildCheckpoint(entry),
        metadata: {
          absolutePath: entry.absolutePath,
          relativePath: entry.relativePath
        }
      });
    }

    return files;
  }
}

async function collectInvoiceFiles(rootPath: string, recursive: boolean): Promise<FolderEntry[]> {
  const queue: string[] = [rootPath];
  const entries: FolderEntry[] = [];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      break;
    }

    const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const dirEntry of dirEntries) {
      const absolutePath = path.join(currentDir, dirEntry.name);
      if (dirEntry.isDirectory()) {
        if (recursive) {
          queue.push(absolutePath);
        }
        continue;
      }

      const extension = path.extname(dirEntry.name).toLowerCase();
      const mimeType = MIME_BY_EXTENSION[extension];
      if (!mimeType) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      const relativePath = path.relative(rootPath, absolutePath);

      entries.push({
        absolutePath,
        relativePath,
        fileName: dirEntry.name,
        mtimeMs: stat.mtimeMs,
        mimeType
      });
    }
  }

  return entries;
}

function buildCheckpoint(entry: FolderEntry): string {
  return `${entry.mtimeMs}|${encodeURIComponent(entry.relativePath)}`;
}
