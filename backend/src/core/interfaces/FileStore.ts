export interface FileStorePutInput {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface FileStoreObjectRef {
  key: string;
  path: string;
  contentType: string;
}

export interface FileStoreGetResult {
  body: Buffer;
  contentType: string;
}

export interface FileStore {
  readonly name: string;
  putObject(input: FileStorePutInput): Promise<FileStoreObjectRef>;
  getObject(key: string): Promise<FileStoreGetResult>;
  deleteObject(key: string): Promise<void>;
  listObjects?(prefix: string): Promise<{ key: string; lastModified: Date }[]>;
  generatePresignedPutUrl?(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
}
