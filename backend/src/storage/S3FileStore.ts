import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { FileStore, FileStoreObjectRef, FileStorePutInput } from "../core/interfaces/FileStore.js";

interface S3FileStoreOptions {
  bucket: string;
  region: string;
  prefix?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

export class S3FileStore implements FileStore {
  readonly name = "s3";

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: S3FileStoreOptions) {
    this.bucket = options.bucket.trim();
    if (this.bucket.length === 0) {
      throw new Error("S3 file store bucket is required.");
    }

    const region = options.region.trim();
    if (region.length === 0) {
      throw new Error("S3 file store region is required.");
    }

    this.prefix = normalizePrefix(options.prefix ?? "");
    this.client = new S3Client({
      region,
      endpoint: options.endpoint?.trim() || undefined,
      forcePathStyle: options.forcePathStyle ?? false
    });
  }

  async putObject(input: FileStorePutInput): Promise<FileStoreObjectRef> {
    const key = this.prefix ? `${this.prefix}/${normalizeKey(input.key)}` : normalizeKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata
      })
    );

    return {
      key,
      path: `s3://${this.bucket}/${key}`,
      contentType: input.contentType
    };
  }
}

function normalizePrefix(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    .join("/");
}

function normalizeKey(value: string): string {
  return normalizePrefix(value);
}
