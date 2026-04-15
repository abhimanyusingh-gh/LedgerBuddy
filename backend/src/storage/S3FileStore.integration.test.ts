import { CreateBucketCommand, DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { S3FileStore } from "@/storage/S3FileStore.js";

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT;
const TEST_BUCKET = "billforge-integration-test";
const TEST_REGION = "us-east-1";

const describeIf = LOCALSTACK_ENDPOINT ? describe : describe.skip;

describeIf("S3FileStore (LocalStack integration)", () => {
  let s3Client: S3Client;
  let store: S3FileStore;

  beforeAll(async () => {
    s3Client = new S3Client({
      region: TEST_REGION,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" }
    });

    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
    } catch {
    }

    store = new S3FileStore({
      bucket: TEST_BUCKET,
      region: TEST_REGION,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true
    });
  });

  afterAll(async () => {
    try {
      let continuationToken: string | undefined;
      do {
        const listed = await s3Client.send(
          new ListObjectsV2Command({ Bucket: TEST_BUCKET, ContinuationToken: continuationToken })
        );
        if (listed.Contents && listed.Contents.length > 0) {
          await s3Client.send(new DeleteObjectsCommand({
            Bucket: TEST_BUCKET,
            Delete: { Objects: listed.Contents.map((obj) => ({ Key: obj.Key! })) }
          }));
        }
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch {
    }
  });

  it("putObject returns a FileStoreObjectRef with correct key and path", async () => {
    const ref = await store.putObject({
      key: "ref-test/invoice.pdf",
      body: Buffer.from("pdf-bytes"),
      contentType: "application/pdf"
    });

    expect(ref.key).toBe("ref-test/invoice.pdf");
    expect(ref.path).toBe(`s3://${TEST_BUCKET}/ref-test/invoice.pdf`);
    expect(ref.contentType).toBe("application/pdf");
  });

  it("putObject + getObject round-trip", async () => {
    const body = Buffer.from("invoice-content-pdf-bytes");
    await store.putObject({
      key: "roundtrip/test-invoice.pdf",
      body,
      contentType: "application/pdf",
      metadata: { tenantId: "t1" }
    });

    const result = await store.getObject("roundtrip/test-invoice.pdf");
    expect(Buffer.from(result.body).toString()).toBe("invoice-content-pdf-bytes");
    expect(result.contentType).toBe("application/pdf");
  });

  it("getObject throws on missing key", async () => {
    await expect(store.getObject("does-not-exist/missing.pdf")).rejects.toThrow();
  });

  it("listObjects returns correct keys under a prefix", async () => {
    await store.putObject({ key: "list-test/a.pdf", body: Buffer.from("a"), contentType: "application/pdf" });
    await store.putObject({ key: "list-test/b.pdf", body: Buffer.from("b"), contentType: "application/pdf" });
    await store.putObject({ key: "other/c.pdf", body: Buffer.from("c"), contentType: "application/pdf" });

    const results = await store.listObjects("list-test");
    const keys = results.map((r) => r.key);
    expect(keys).toContain("list-test/a.pdf");
    expect(keys).toContain("list-test/b.pdf");
    expect(keys).not.toContain("other/c.pdf");
  });

  it("listObjects returns empty array for a prefix with no objects", async () => {
    const results = await store.listObjects("absolutely-not-here");
    expect(results).toEqual([]);
  });

  it("listObjects with constructor prefix strips prefix from returned keys", async () => {
    const tenantPrefix = "tenant-prefix-test";
    const prefixedStore = new S3FileStore({
      bucket: TEST_BUCKET,
      region: TEST_REGION,
      prefix: tenantPrefix,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true
    });

    await prefixedStore.putObject({ key: "folder/doc.pdf", body: Buffer.from("doc"), contentType: "application/pdf" });

    const results = await prefixedStore.listObjects("folder");
    const keys = results.map((r) => r.key);
    expect(keys).toContain("folder/doc.pdf");
    expect(keys.every((k) => !k.startsWith(tenantPrefix))).toBe(true);
  });

  it("putObject with constructor prefix encodes prefix into stored path", async () => {
    const tenantPrefix = "tenant-ref-prefix";
    const prefixedStore = new S3FileStore({
      bucket: TEST_BUCKET,
      region: TEST_REGION,
      prefix: tenantPrefix,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true
    });

    const ref = await prefixedStore.putObject({
      key: "invoices/inv-999.pdf",
      body: Buffer.from("data"),
      contentType: "application/pdf"
    });

    expect(ref.key).toBe(`${tenantPrefix}/invoices/inv-999.pdf`);
    expect(ref.path).toBe(`s3://${TEST_BUCKET}/${tenantPrefix}/invoices/inv-999.pdf`);
  });

  it("deleteObject removes object and subsequent getObject throws", async () => {
    await store.putObject({ key: "delete-test/file.pdf", body: Buffer.from("data"), contentType: "application/pdf" });

    await store.deleteObject("delete-test/file.pdf");

    await expect(store.getObject("delete-test/file.pdf")).rejects.toThrow();
  });

  it("deleteObject is idempotent on non-existent key", async () => {
    await expect(store.deleteObject("nonexistent/key.pdf")).resolves.toBeUndefined();
  });

  it("full upload → list → retrieve pipeline across content types", async () => {
    const tenantId = "integration-tenant";
    const files = [
      { key: `uploads/${tenantId}/inv-001.pdf`, body: Buffer.from("pdf-001"), contentType: "application/pdf" },
      { key: `uploads/${tenantId}/inv-002.png`, body: Buffer.from("png-002"), contentType: "image/png" }
    ];

    for (const file of files) {
      await store.putObject({ key: file.key, body: file.body, contentType: file.contentType });
    }

    const listed = await store.listObjects(`uploads/${tenantId}`);
    expect(listed.length).toBe(2);
    expect(listed.map((r) => r.key)).toContain(`uploads/${tenantId}/inv-001.pdf`);
    expect(listed.map((r) => r.key)).toContain(`uploads/${tenantId}/inv-002.png`);

    const retrieved = await store.getObject(`uploads/${tenantId}/inv-001.pdf`);
    expect(Buffer.from(retrieved.body).toString()).toBe("pdf-001");
    expect(retrieved.contentType).toBe("application/pdf");

    const retrievedPng = await store.getObject(`uploads/${tenantId}/inv-002.png`);
    expect(Buffer.from(retrievedPng.body).toString()).toBe("png-002");
    expect(retrievedPng.contentType).toBe("image/png");
  });
});
