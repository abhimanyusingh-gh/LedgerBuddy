import type { FileStore } from "@/core/interfaces/FileStore.js";
import { S3UploadIngestionSource } from "@/sources/S3UploadIngestionSource.js";
import { toUUID } from "@/types/uuid.js";

const TENANT_ID = toUUID("tenant-s3-checkpoint");

interface MockObject {
  key: string;
  lastModified: Date;
  body?: Buffer;
}

function createFileStore(objects: MockObject[]): { store: FileStore; getCalls: string[] } {
  const getCalls: string[] = [];
  const byKey = new Map(objects.map((object) => [object.key, object]));
  const store: FileStore = {
    name: "mock-s3",
    putObject: jest.fn(async () => ({ key: "", path: "", contentType: "" })),
    deleteObject: jest.fn(async () => {}),
    getObject: jest.fn(async (key: string) => {
      getCalls.push(key);
      const object = byKey.get(key);
      if (!object) {
        throw new Error(`NoSuchKey: ${key}`);
      }
      return { body: object.body ?? Buffer.from(`bytes-${key}`), contentType: "application/pdf" };
    }),
    listObjects: jest.fn(async () => objects.map((object) => ({ key: object.key, lastModified: object.lastModified })))
  };
  return { store, getCalls };
}

describe("S3UploadIngestionSource", () => {
  const tenantPrefix = `uploads/${TENANT_ID}`;

  it("initial poll (null checkpoint) returns every supported object", async () => {
    const { store } = createFileStore([
      { key: `${tenantPrefix}/a.pdf`, lastModified: new Date("2026-04-20T10:00:00.000Z") },
      { key: `${tenantPrefix}/b.pdf`, lastModified: new Date("2026-04-20T11:00:00.000Z") }
    ]);
    const source = new S3UploadIngestionSource(TENANT_ID, store);

    const files = await source.fetchNewFiles(null);

    expect(files).toHaveLength(2);
    expect(files.map((f) => f.sourceDocumentId).sort()).toEqual([
      `${tenantPrefix}/a.pdf`,
      `${tenantPrefix}/b.pdf`
    ]);
    expect(files[files.length - 1].checkpointValue).toBe(`2026-04-20T11:00:00.000Z|${tenantPrefix}/b.pdf`);
  });

  it("subsequent poll with stored checkpoint returns only newer objects", async () => {
    const oldKey = `${tenantPrefix}/old.pdf`;
    const freshKey = `${tenantPrefix}/fresh.pdf`;
    const { store } = createFileStore([
      { key: oldKey, lastModified: new Date("2026-04-20T10:00:00.000Z") },
      { key: freshKey, lastModified: new Date("2026-04-20T12:00:00.000Z") }
    ]);
    const source = new S3UploadIngestionSource(TENANT_ID, store);

    const files = await source.fetchNewFiles(`2026-04-20T11:00:00.000Z|${tenantPrefix}/old.pdf`);

    expect(files).toHaveLength(1);
    expect(files[0].sourceDocumentId).toBe(freshKey);
    expect(files[0].checkpointValue).toBe(`2026-04-20T12:00:00.000Z|${freshKey}`);
  });

  it("returns empty when every object is older than the checkpoint", async () => {
    const { store } = createFileStore([
      { key: `${tenantPrefix}/old.pdf`, lastModified: new Date("2026-04-20T10:00:00.000Z") }
    ]);
    const source = new S3UploadIngestionSource(TENANT_ID, store);

    const files = await source.fetchNewFiles(`2026-04-20T11:00:00.000Z|${tenantPrefix}/zzz.pdf`);

    expect(files).toEqual([]);
  });

  it("sorts batch ascending by lastModified so per-file checkpoint advance is monotonic", async () => {
    const out0 = `${tenantPrefix}/out-of-order-0.pdf`;
    const out1 = `${tenantPrefix}/out-of-order-1.pdf`;
    const out2 = `${tenantPrefix}/out-of-order-2.pdf`;
    const { store } = createFileStore([
      { key: out2, lastModified: new Date("2026-04-20T13:00:00.000Z") },
      { key: out0, lastModified: new Date("2026-04-20T11:00:00.000Z") },
      { key: out1, lastModified: new Date("2026-04-20T12:00:00.000Z") }
    ]);
    const source = new S3UploadIngestionSource(TENANT_ID, store);

    const files = await source.fetchNewFiles(null);

    expect(files.map((f) => f.checkpointValue)).toEqual([
      `2026-04-20T11:00:00.000Z|${out0}`,
      `2026-04-20T12:00:00.000Z|${out1}`,
      `2026-04-20T13:00:00.000Z|${out2}`
    ]);
  });

  it("skips unsupported extensions", async () => {
    const { store } = createFileStore([
      { key: `${tenantPrefix}/notes.txt`, lastModified: new Date("2026-04-20T10:00:00.000Z") },
      { key: `${tenantPrefix}/inv.pdf`, lastModified: new Date("2026-04-20T10:00:00.000Z") }
    ]);
    const source = new S3UploadIngestionSource(TENANT_ID, store);

    const files = await source.fetchNewFiles(null);

    expect(files.map((f) => f.sourceDocumentId)).toEqual([`${tenantPrefix}/inv.pdf`]);
  });

  it("gracefully skips objects deleted between list and get", async () => {
    const ghostKey = `${tenantPrefix}/ghost.pdf`;
    const survivorKey = `${tenantPrefix}/survivor.pdf`;
    const { store } = createFileStore([
      { key: ghostKey, lastModified: new Date("2026-04-20T10:00:00.000Z") },
      { key: survivorKey, lastModified: new Date("2026-04-20T11:00:00.000Z") }
    ]);
    (store.getObject as jest.Mock).mockImplementationOnce(async () => {
      throw new Error("NoSuchKey: deleted between list + get");
    });

    const source = new S3UploadIngestionSource(TENANT_ID, store);
    const files = await source.fetchNewFiles(null);

    expect(files.map((f) => f.sourceDocumentId)).toEqual([survivorKey]);
  });

  it("returns empty when the file store has no listObjects implementation", async () => {
    const limitedStore: FileStore = {
      name: "no-list",
      putObject: jest.fn(async () => ({ key: "", path: "", contentType: "" })),
      deleteObject: jest.fn(async () => {}),
      getObject: jest.fn(async () => ({ body: Buffer.from(""), contentType: "application/pdf" }))
    };

    const source = new S3UploadIngestionSource(TENANT_ID, limitedStore);
    const files = await source.fetchNewFiles(null);

    expect(files).toEqual([]);
  });

  it("treats an unparseable checkpoint as null (relists everything once)", async () => {
    const { store } = createFileStore([
      { key: `${tenantPrefix}/legacy.pdf`, lastModified: new Date("2026-04-20T10:00:00.000Z") }
    ]);
    const source = new S3UploadIngestionSource(TENANT_ID, store);

    const files = await source.fetchNewFiles("uploads/legacy-key-shaped-marker.pdf");

    expect(files).toHaveLength(1);
    expect(files[0].checkpointValue).toBe(`2026-04-20T10:00:00.000Z|${tenantPrefix}/legacy.pdf`);
  });

  it("equal-millisecond uploads: tiebreak by key advances both across consecutive polls", async () => {
    const sameMs = new Date("2026-04-20T14:00:00.000Z");
    const firstKey = `${tenantPrefix}/a-equal.pdf`;
    const secondKey = `${tenantPrefix}/b-equal.pdf`;
    const { store } = createFileStore([
      { key: secondKey, lastModified: sameMs },
      { key: firstKey, lastModified: sameMs }
    ]);
    const source = new S3UploadIngestionSource(TENANT_ID, store);

    const firstPoll = await source.fetchNewFiles(null);
    expect(firstPoll.map((f) => f.sourceDocumentId)).toEqual([firstKey, secondKey]);
    expect(firstPoll[0].checkpointValue).toBe(`2026-04-20T14:00:00.000Z|${firstKey}`);
    expect(firstPoll[1].checkpointValue).toBe(`2026-04-20T14:00:00.000Z|${secondKey}`);

    const secondPoll = await source.fetchNewFiles(firstPoll[0].checkpointValue);
    expect(secondPoll.map((f) => f.sourceDocumentId)).toEqual([secondKey]);

    const thirdPoll = await source.fetchNewFiles(firstPoll[1].checkpointValue);
    expect(thirdPoll).toEqual([]);
  });

  it("legacy ISO-only checkpoint (no key suffix) re-includes equal-ms object once on next poll", async () => {
    const ms = new Date("2026-04-20T15:00:00.000Z");
    const equalKey = `${tenantPrefix}/equal-ms.pdf`;
    const { store } = createFileStore([
      { key: equalKey, lastModified: ms }
    ]);
    const source = new S3UploadIngestionSource(TENANT_ID, store);

    const files = await source.fetchNewFiles("2026-04-20T15:00:00.000Z");

    expect(files.map((f) => f.sourceDocumentId)).toEqual([equalKey]);
    expect(files[0].checkpointValue).toBe(`2026-04-20T15:00:00.000Z|${equalKey}`);
  });
});
