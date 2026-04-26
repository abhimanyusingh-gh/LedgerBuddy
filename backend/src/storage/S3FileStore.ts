import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FileStore, FileStoreGetResult, FileStoreObjectRef, FileStorePutInput } from "@/core/interfaces/FileStore.js";

interface S3FileStoreOptions {
  bucket: string;
  region: string;
  prefix?: string;
  endpoint?: string;
  publicEndpoint?: string;
  forcePathStyle?: boolean;
}

export class S3FileStore implements FileStore {
  readonly name = "s3";

  private readonly client: S3Client;
  private readonly presignedClient: S3Client;
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
    const endpoint = options.endpoint?.trim() || undefined;
    const forcePathStyle = options.forcePathStyle ?? false;
    const credentials = endpoint
      ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test" }
      : undefined;

    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      ...(credentials ? { credentials } : {})
    });

    const publicEndpoint = options.publicEndpoint?.trim() || undefined;
    if (publicEndpoint) {
      this.presignedClient = new S3Client({
        region,
        endpoint: publicEndpoint,
        forcePathStyle,
        ...(credentials ? { credentials } : {})
      });
    } else {
      this.presignedClient = this.client;
    }
  }

  async getObject(key: string): Promise<FileStoreGetResult> {
    const fullKey = this.prefix ? `${this.prefix}/${normalizeKey(key)}` : normalizeKey(key);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: fullKey
      })
    );
    const bytes = await response.Body?.transformToByteArray();
    return {
      body: Buffer.from(bytes ?? new Uint8Array()),
      contentType: response.ContentType ?? "application/octet-stream"
    };
  }

  async listObjects(prefix: string): Promise<{ key: string; lastModified: Date }[]> {
    const fullPrefix = this.prefix ? `${this.prefix}/${normalizeKey(prefix)}` : normalizeKey(prefix);
    const results: { key: string; lastModified: Date }[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: fullPrefix.endsWith("/") ? fullPrefix : `${fullPrefix}/`,
          ContinuationToken: continuationToken
        })
      );

      for (const object of response.Contents ?? []) {
        if (object.Key) {
          const stripped = this.prefix ? object.Key.slice(this.prefix.length + 1) : object.Key;
          results.push({
            key: stripped,
            lastModified: object.LastModified ?? new Date(0)
          });
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return results;
  }

  async deleteObject(key: string): Promise<void> {
    const fullKey = this.prefix ? `${this.prefix}/${normalizeKey(key)}` : normalizeKey(key);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: fullKey
      })
    );
  }

  async generatePresignedPutUrl(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    const fullKey = this.prefix ? `${this.prefix}/${normalizeKey(key)}` : normalizeKey(key);
    return getSignedUrl(
      this.presignedClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: fullKey, ContentType: contentType }),
      { expiresIn: expiresInSeconds }
    );
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
