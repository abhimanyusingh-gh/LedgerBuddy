jest.mock("../../utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getCorrelationId: jest.fn(() => "corr-test-001"),
  runWithLogContext: jest.fn((_id: unknown, cb: () => void) => cb())
}));

import { defaultAuth, findHandler, mockRequest, mockResponse, createMockFileStore } from "@/routes/testHelpers.ts";
import type { FileStore } from "@/core/interfaces/FileStore.ts";

let createUploadsRouter: typeof import("./uploads.ts").createUploadsRouter;

beforeEach(async () => {
  jest.resetModules();

  jest.mock("../../utils/logger.js", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    getCorrelationId: jest.fn(() => "corr-test-001"),
    runWithLogContext: jest.fn((_id: unknown, cb: () => void) => cb())
  }));

  const mod = await import("./uploads.ts");
  createUploadsRouter = mod.createUploadsRouter;
});

function createPresignableFileStore(): FileStore {
  return {
    ...createMockFileStore(),
    generatePresignedPutUrl: jest.fn(async (key: string) => `https://minio.local/${key}?signed=1`)
  } as unknown as FileStore;
}

describe("uploads routes", () => {
  describe("POST /uploads/presign", () => {
    it("returns presigned URLs for valid files", async () => {
      const fileStore = createPresignableFileStore();
      const router = createUploadsRouter(fileStore);
      const res = mockResponse();

      await findHandler(router, "post", "/uploads/presign")(
        mockRequest({
          authContext: defaultAuth,
          body: {
            files: [
              { name: "invoice.pdf", contentType: "application/pdf", sizeBytes: 1024 },
              { name: "receipt.png", contentType: "image/png", sizeBytes: 2048 }
            ]
          }
        }),
        res, jest.fn()
      );

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as { uploads: Array<{ key: string; uploadUrl: string; expiresAt: string }> };
      expect(body.uploads).toHaveLength(2);
      expect(body.uploads[0].key).toMatch(/^uploads\/tenant-a\/.+\.pdf$/);
      expect(body.uploads[0].uploadUrl).toContain("signed=1");
      expect(body.uploads[0].expiresAt).toBeDefined();
      expect(body.uploads[1].key).toMatch(/^uploads\/tenant-a\/.+\.png$/);
    });

    it("returns 400 when file store does not support presigned URLs", async () => {
      const router = createUploadsRouter(createMockFileStore());
      const res = mockResponse();

      await findHandler(router, "post", "/uploads/presign")(
        mockRequest({
          authContext: defaultAuth,
          body: { files: [{ name: "a.pdf", contentType: "application/pdf", sizeBytes: 100 }] }
        }),
        res, jest.fn()
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("presigned");
    });

    it("returns 400 when no file store is configured", async () => {
      const router = createUploadsRouter();
      const res = mockResponse();

      await findHandler(router, "post", "/uploads/presign")(
        mockRequest({
          authContext: defaultAuth,
          body: { files: [{ name: "a.pdf", contentType: "application/pdf", sizeBytes: 100 }] }
        }),
        res, jest.fn()
      );

      expect(res.statusCode).toBe(400);
    });

    it.each([
      ["empty files array", [], null],
      ["unsupported content type", [{ name: "malware.exe", contentType: "application/octet-stream", sizeBytes: 100 }], "Unsupported content type"],
      ["file exceeds size limit", [{ name: "big.pdf", contentType: "application/pdf", sizeBytes: 30 * 1024 * 1024 }], "size limit"],
      ["file has no name", [{ name: "", contentType: "application/pdf", sizeBytes: 100 }], null],
      ["more than 50 files", Array.from({ length: 51 }, (_, i) => ({ name: `f${i}.pdf`, contentType: "application/pdf", sizeBytes: 100 })), "50"],
    ])("returns 400 for %s", async (_label, files, messageSubstring) => {
      const router = createUploadsRouter(createPresignableFileStore());
      const res = mockResponse();

      await findHandler(router, "post", "/uploads/presign")(
        mockRequest({ authContext: defaultAuth, body: { files } }),
        res, jest.fn()
      );

      expect(res.statusCode).toBe(400);
      if (messageSubstring) {
        expect((res.jsonBody as { message: string }).message).toContain(messageSubstring);
      }
    });

    it("supports WEBP content type", async () => {
      const fileStore = createPresignableFileStore();
      const router = createUploadsRouter(fileStore);
      const res = mockResponse();

      await findHandler(router, "post", "/uploads/presign")(
        mockRequest({
          authContext: defaultAuth,
          body: { files: [{ name: "photo.webp", contentType: "image/webp", sizeBytes: 512 }] }
        }),
        res, jest.fn()
      );

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as { uploads: Array<{ key: string }> };
      expect(body.uploads[0].key).toMatch(/\.webp$/);
    });
  });
});
