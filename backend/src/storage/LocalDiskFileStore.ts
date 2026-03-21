import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileStore, FileStoreGetResult, FileStoreObjectRef, FileStorePutInput } from "../core/interfaces/FileStore.js";
import { isPathInsideRoot } from "../utils/previewStorage.js";
import { logger } from "../utils/logger.js";

interface LocalDiskFileStoreOptions {
  rootPath: string;
}

export class LocalDiskFileStore implements FileStore {
  readonly name = "local";

  private readonly rootPath: string;

  constructor(options: LocalDiskFileStoreOptions) {
    this.rootPath = path.resolve(options.rootPath);
  }

  async getObject(key: string): Promise<FileStoreGetResult> {
    const normalizedKey = normalizeKey(key);
    const filePath = path.resolve(this.rootPath, normalizedKey);
    if (!isPathInsideRoot(this.rootPath, filePath)) {
      throw new Error(`Refusing to read object outside local store root: '${key}'`);
    }
    const body = await fs.readFile(filePath);
    const metaPath = filePath + ".meta.json";
    let contentType = "application/octet-stream";
    try {
      const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
      if (typeof meta.contentType === "string" && meta.contentType.length > 0) {
        contentType = meta.contentType;
      }
    } catch (error) {
      const isNotFound = error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
      if (!isNotFound) {
        logger.info("filestore.local.metadata.read.failed", {
          metaPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { body, contentType };
  }

  async listObjects(prefix: string): Promise<{ key: string }[]> {
    const normalizedPrefix = normalizeKey(prefix);
    const dirPath = path.resolve(this.rootPath, normalizedPrefix);
    if (!isPathInsideRoot(this.rootPath, dirPath)) {
      return [];
    }

    const results: { key: string }[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        const isNotFound = error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
        if (!isNotFound) {
          logger.warn("filestore.local.listObjects.readdir.failed", {
            dir,
            error: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (!entry.name.endsWith(".meta.json")) {
          const key = path.relative(this.rootPath, fullPath).replace(/\\/g, "/");
          results.push({ key });
        }
      }
    };
    await walk(dirPath);
    return results;
  }

  async deleteObject(key: string): Promise<void> {
    const normalizedKey = normalizeKey(key);
    const filePath = path.resolve(this.rootPath, normalizedKey);
    if (!isPathInsideRoot(this.rootPath, filePath)) {
      throw new Error(`Refusing to delete object outside local store root: '${key}'`);
    }
    await fs.unlink(filePath).catch(() => {});
    await fs.unlink(filePath + ".meta.json").catch(() => {});
  }

  async putObject(input: FileStorePutInput): Promise<FileStoreObjectRef> {
    const normalizedKey = normalizeKey(input.key);
    const filePath = path.resolve(this.rootPath, normalizedKey);
    if (!isPathInsideRoot(this.rootPath, filePath)) {
      throw new Error(`Refusing to write object outside local store root: '${input.key}'`);
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.body);
    await fs.writeFile(filePath + ".meta.json", JSON.stringify({ contentType: input.contentType }));

    return {
      key: normalizedKey,
      path: filePath,
      contentType: input.contentType
    };
  }
}

function normalizeKey(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/");
}
