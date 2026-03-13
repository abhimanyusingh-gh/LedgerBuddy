import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileStore, FileStoreGetResult, FileStoreObjectRef, FileStorePutInput } from "../core/interfaces/FileStore.js";
import { isPathInsideRoot } from "../utils/previewStorage.js";

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
    } catch {
      // No metadata file — fall back to generic content type
    }
    return { body, contentType };
  }

  async listObjects(_prefix: string): Promise<{ key: string }[]> {
    return [];
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
