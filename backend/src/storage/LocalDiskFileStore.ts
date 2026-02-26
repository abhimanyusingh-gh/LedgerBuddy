import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileStore, FileStoreObjectRef, FileStorePutInput } from "../core/interfaces/FileStore.js";
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

  async putObject(input: FileStorePutInput): Promise<FileStoreObjectRef> {
    const normalizedKey = normalizeKey(input.key);
    const filePath = path.resolve(this.rootPath, normalizedKey);
    if (!isPathInsideRoot(this.rootPath, filePath)) {
      throw new Error(`Refusing to write object outside local store root: '${input.key}'`);
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.body);

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
