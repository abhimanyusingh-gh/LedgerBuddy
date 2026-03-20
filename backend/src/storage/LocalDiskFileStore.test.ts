import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalDiskFileStore } from "./LocalDiskFileStore.js";

let tmpDir: string;
let store: LocalDiskFileStore;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localfilestore-test-"));
  store = new LocalDiskFileStore({ rootPath: tmpDir });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("LocalDiskFileStore", () => {
  test("name property returns 'local'", () => {
    expect(store.name).toBe("local");
  });

  test("putObject + getObject round-trip", async () => {
    const body = Buffer.from("invoice content");
    const contentType = "application/pdf";

    await store.putObject({ key: "invoices/inv-001.pdf", body, contentType });
    const result = await store.getObject("invoices/inv-001.pdf");

    expect(Buffer.compare(result.body, body)).toBe(0);
    expect(result.contentType).toBe(contentType);
  });

  test("putObject creates nested directories", async () => {
    const body = Buffer.from("nested file");
    await store.putObject({
      key: "a/b/c/deep.txt",
      body,
      contentType: "text/plain",
    });

    const filePath = path.join(tmpDir, "a", "b", "c", "deep.txt");
    expect(fs.existsSync(filePath)).toBe(true);

    const result = await store.getObject("a/b/c/deep.txt");
    expect(result.body.toString()).toBe("nested file");
  });

  test("getObject throws for non-existent key", async () => {
    await expect(store.getObject("does/not/exist.pdf")).rejects.toThrow();
  });

  test("listObjects returns correct keys under prefix", async () => {
    await store.putObject({
      key: "tenant-a/file1.pdf",
      body: Buffer.from("1"),
      contentType: "application/pdf",
    });
    await store.putObject({
      key: "tenant-a/file2.pdf",
      body: Buffer.from("2"),
      contentType: "application/pdf",
    });
    await store.putObject({
      key: "tenant-b/file3.pdf",
      body: Buffer.from("3"),
      contentType: "application/pdf",
    });

    const results = await store.listObjects("tenant-a");
    const keys = results.map((r) => r.key);

    expect(keys).toContain("tenant-a/file1.pdf");
    expect(keys).toContain("tenant-a/file2.pdf");
    expect(keys).not.toContain("tenant-b/file3.pdf");
  });

  test("listObjects returns empty array for non-existent prefix", async () => {
    const results = await store.listObjects("no-such-prefix");
    expect(results).toEqual([]);
  });

  test("listObjects handles nested prefixes", async () => {
    await store.putObject({
      key: "org/dept/sub/report.pdf",
      body: Buffer.from("report"),
      contentType: "application/pdf",
    });
    await store.putObject({
      key: "org/dept/sub/deep/nested.pdf",
      body: Buffer.from("nested"),
      contentType: "application/pdf",
    });
    await store.putObject({
      key: "org/other/unrelated.pdf",
      body: Buffer.from("unrelated"),
      contentType: "application/pdf",
    });

    const results = await store.listObjects("org/dept/sub");
    const keys = results.map((r) => r.key);

    expect(keys).toContain("org/dept/sub/report.pdf");
    expect(keys).toContain("org/dept/sub/deep/nested.pdf");
    expect(keys).not.toContain("org/other/unrelated.pdf");
  });

  test("deleteObject removes the file", async () => {
    await store.putObject({
      key: "to-delete/temp.pdf",
      body: Buffer.from("temporary"),
      contentType: "application/pdf",
    });

    const before = await store.getObject("to-delete/temp.pdf");
    expect(before.body.toString()).toBe("temporary");

    await store.deleteObject("to-delete/temp.pdf");

    await expect(store.getObject("to-delete/temp.pdf")).rejects.toThrow();
  });

  test("deleteObject is idempotent", async () => {
    await expect(
      store.deleteObject("never-existed/phantom.pdf")
    ).resolves.toBeUndefined();
  });

  test("putObject with metadata writes sidecar", async () => {
    await store.putObject({
      key: "meta-test/doc.pdf",
      body: Buffer.from("with meta"),
      contentType: "application/pdf",
      metadata: { source: "upload", tenant: "t-1" },
    });

    const metaPath = path.join(tmpDir, "meta-test", "doc.pdf.meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    expect(meta.contentType).toBe("application/pdf");

    const result = await store.getObject("meta-test/doc.pdf");
    expect(result.contentType).toBe("application/pdf");
    expect(result.body.toString()).toBe("with meta");
  });
});
