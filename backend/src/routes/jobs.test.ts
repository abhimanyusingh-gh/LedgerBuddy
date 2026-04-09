jest.mock("../models/Invoice.js", () => ({
  InvoiceModel: {
    create: jest.fn(async () => ({ _id: "inv-1" }))
  }
}));

jest.mock("../utils/logger.js", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getCorrelationId: jest.fn(() => "corr-test-001"),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runWithLogContext: jest.fn((_id, cb) => cb())
}));

import type { IngestionService } from "../services/ingestionService.ts";
import { defaultAuth, findHandler, findSecondHandler, mockRequest, mockResponse, createMockFileStore } from "./testHelpers.ts";

let createJobsRouter: typeof import("./jobs.ts").createJobsRouter;

beforeEach(async () => {
  jest.resetModules();

  jest.mock("../models/Invoice.js", () => ({
    InvoiceModel: { create: jest.fn(async () => ({ _id: "inv-1" })) }
  }));

  jest.mock("../utils/logger.js", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    getCorrelationId: jest.fn(() => "corr-test-001"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runWithLogContext: jest.fn((_id, cb) => cb())
  }));

  const mod = await import("./jobs.ts");
  createJobsRouter = mod.createJobsRouter;
});

function createMockIngestionService(overrides?: Partial<IngestionService>): IngestionService {
  return {
    runOnce: jest.fn(async () => ({
      totalFiles: 3, newInvoices: 2, duplicates: 1, failures: 0, paused: false
    })),
    requestPause: jest.fn(),
    ...overrides
  } as unknown as IngestionService;
}

describe("jobs routes", () => {
  describe("GET /jobs/ingest/status", () => {
    it("returns idle status for unknown tenant", () => {
      const router = createJobsRouter(createMockIngestionService());
      const handler = findHandler(router, "get", "/jobs/ingest/status");
      const res = mockResponse();

      handler(mockRequest({ authContext: defaultAuth }), res);

      const body = res.jsonBody as { state: string; running: boolean };
      expect(body.state).toBe("idle");
      expect(body.running).toBe(false);
    });

    it("returns running status after job starts", async () => {
      const service = createMockIngestionService({ runOnce: jest.fn(() => new Promise(() => {})) });
      const router = createJobsRouter(service);

      await findHandler(router, "post", "/jobs/ingest")(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());

      const res = mockResponse();
      findHandler(router, "get", "/jobs/ingest/status")(mockRequest({ authContext: defaultAuth }), res);
      expect((res.jsonBody as { state: string }).state).toBe("running");
    });
  });

  describe("GET /jobs/ingest/sse", () => {
    it("sets SSE headers and sends keepalive comment", () => {
      const router = createJobsRouter(createMockIngestionService());
      const res = mockResponse();

      findHandler(router, "get", "/jobs/ingest/sse")(mockRequest({ authContext: defaultAuth }), res);

      expect((res.headers as Record<string, string>)["Content-Type"]).toBe("text/event-stream");
      expect((res.headers as Record<string, string>)["Cache-Control"]).toBe("no-cache, no-transform");

      const written = res.written as string[];
      expect(written.length).toBeGreaterThanOrEqual(1);
      expect(written[0]).toBe(":\n\n");

      for (const msg of written) {
        const isKeepalive = msg === ":\n\n";
        const isDataMessage = msg.startsWith("data: ") && msg.endsWith("\n\n");
        expect(isKeepalive || isDataMessage).toBe(true);
      }
    });

    it("sends current status on connect when job exists", async () => {
      const service = createMockIngestionService({ runOnce: jest.fn(() => new Promise(() => {})) });
      const router = createJobsRouter(service);

      await findHandler(router, "post", "/jobs/ingest")(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());

      const res = mockResponse();
      findHandler(router, "get", "/jobs/ingest/sse")(mockRequest({ authContext: defaultAuth }), res);

      const written = res.written as string[];
      expect(written.length).toBe(2);
      expect(JSON.parse(written[1].replace("data: ", "").trim()).state).toBe("running");
    });

    it("broadcasts to subscribers when status changes", async () => {
      const service = createMockIngestionService({ runOnce: jest.fn(() => new Promise(() => {})) });
      const router = createJobsRouter(service);

      await findHandler(router, "post", "/jobs/ingest")(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());

      const sseRes = mockResponse();
      findHandler(router, "get", "/jobs/ingest/sse")(mockRequest({ authContext: defaultAuth }), sseRes);
      const beforePause = (sseRes.written as string[]).length;

      findHandler(router, "post", "/jobs/ingest/pause")(mockRequest({ authContext: defaultAuth }), mockResponse());
      expect((sseRes.written as string[]).length).toBeGreaterThan(beforePause);
    });
  });

  describe("POST /jobs/ingest", () => {
    it("starts ingestion job and returns 202", async () => {
      const service = createMockIngestionService({ runOnce: jest.fn(() => new Promise(() => {})) });
      const router = createJobsRouter(service);
      const res = mockResponse();

      await findHandler(router, "post", "/jobs/ingest")(mockRequest({ authContext: defaultAuth }), res, jest.fn());

      expect(res.statusCode).toBe(202);
      expect((res.jsonBody as { state: string }).state).toBe("running");
      expect(service.runOnce).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }));
    });

    it("returns existing status and sets pendingRerun when already running", async () => {
      const service = createMockIngestionService({ runOnce: jest.fn(() => new Promise(() => {})) });
      const router = createJobsRouter(service);
      const handler = findHandler(router, "post", "/jobs/ingest");

      await handler(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());
      const res = mockResponse();
      await handler(mockRequest({ authContext: defaultAuth }), res, jest.fn());

      expect((res.jsonBody as { state: string }).state).toBe("running");
      expect(service.runOnce).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /jobs/upload", () => {
    it("uploads files and creates invoice records", async () => {
      const fileStore = createMockFileStore();
      const router = createJobsRouter(createMockIngestionService(), undefined, fileStore);
      const files = [
        { originalname: "a.pdf", buffer: Buffer.from("a"), mimetype: "application/pdf" },
        { originalname: "b.pdf", buffer: Buffer.from("b"), mimetype: "application/pdf" }
      ];
      const res = mockResponse();

      await findSecondHandler(router, "post", "/jobs/upload")(mockRequest({ authContext: defaultAuth, files }), res, jest.fn());

      expect(res.statusCode).toBe(201);
      expect((res.jsonBody as { count: number }).count).toBe(2);
      expect(fileStore.putObject).toHaveBeenCalledTimes(2);
    });

    it("returns 400 when file store is not configured", async () => {
      const router = createJobsRouter(createMockIngestionService());
      const res = mockResponse();
      await findSecondHandler(router, "post", "/jobs/upload")(
        mockRequest({ authContext: defaultAuth, files: [{ originalname: "f.pdf", buffer: Buffer.from("x"), mimetype: "application/pdf" }] }),
        res, jest.fn()
      );
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when no files provided", async () => {
      const router = createJobsRouter(createMockIngestionService(), undefined, createMockFileStore());
      const res = mockResponse();
      await findSecondHandler(router, "post", "/jobs/upload")(mockRequest({ authContext: defaultAuth, files: [] }), res, jest.fn());
      expect(res.statusCode).toBe(400);
    });

    it("rejects unsupported file extensions", async () => {
      const fileStore = createMockFileStore();
      const router = createJobsRouter(createMockIngestionService(), undefined, fileStore);
      const files = [{ originalname: "malware.exe", buffer: Buffer.from("bad"), mimetype: "application/octet-stream" }];
      const res = mockResponse();

      await findSecondHandler(router, "post", "/jobs/upload")(mockRequest({ authContext: defaultAuth, files }), res, jest.fn());

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("Unsupported file type");
    });

    it("sets pendingRerun instead of inflating totalFiles during running job", async () => {
      const service = createMockIngestionService({ runOnce: jest.fn(() => new Promise(() => {})) });
      const fileStore = createMockFileStore();
      const router = createJobsRouter(service, undefined, fileStore);

      const ingestRes = mockResponse();
      await findHandler(router, "post", "/jobs/ingest")(mockRequest({ authContext: defaultAuth }), ingestRes, jest.fn());
      const initialTotal = (ingestRes.jsonBody as { totalFiles: number }).totalFiles;

      for (let i = 0; i < 3; i++) {
        await findSecondHandler(router, "post", "/jobs/upload")(
          mockRequest({ authContext: defaultAuth, files: [{ originalname: `f${i}.pdf`, buffer: Buffer.from(`d${i}`), mimetype: "application/pdf" }] }),
          mockResponse(), jest.fn()
        );
      }

      const statusRes = mockResponse();
      findHandler(router, "get", "/jobs/ingest/status")(mockRequest({ authContext: defaultAuth }), statusRes);
      expect((statusRes.jsonBody as { totalFiles: number }).totalFiles).toBe(initialTotal);
    });

    it("handles E11000 duplicate invoice creation gracefully", async () => {
      const router = createJobsRouter(createMockIngestionService(), undefined, createMockFileStore());
      const { InvoiceModel } = await import("../models/Invoice.ts");
      const dupError = Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
      (InvoiceModel.create as jest.Mock).mockResolvedValueOnce({ _id: "inv-1" }).mockRejectedValueOnce(dupError);

      const res = mockResponse();
      await findSecondHandler(router, "post", "/jobs/upload")(
        mockRequest({ authContext: defaultAuth, files: [
          { originalname: "a.pdf", buffer: Buffer.from("a"), mimetype: "application/pdf" },
          { originalname: "b.pdf", buffer: Buffer.from("b"), mimetype: "application/pdf" }
        ] }),
        res, jest.fn()
      );
      expect(res.statusCode).toBe(201);
      expect((res.jsonBody as { count: number }).count).toBe(2);
    });
  });

  describe("POST /jobs/ingest/pause", () => {
    it("pauses running job and clears pendingRerun", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let resolveRunOnce: (value: any) => void;
      const service = createMockIngestionService({
        runOnce: jest.fn(() => new Promise((resolve) => { resolveRunOnce = resolve; }))
      });
      const fileStore = createMockFileStore();
      const router = createJobsRouter(service, undefined, fileStore);

      await findHandler(router, "post", "/jobs/ingest")(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());

      await findSecondHandler(router, "post", "/jobs/upload")(
        mockRequest({ authContext: defaultAuth, files: [{ originalname: "f.pdf", buffer: Buffer.from("d"), mimetype: "application/pdf" }] }),
        mockResponse(), jest.fn()
      );

      const pauseRes = mockResponse();
      findHandler(router, "post", "/jobs/ingest/pause")(mockRequest({ authContext: defaultAuth }), pauseRes);

      expect((pauseRes.jsonBody as { state: string }).state).toBe("paused");
      expect(service.requestPause).toHaveBeenCalledTimes(1);

      resolveRunOnce!({ totalFiles: 1, newInvoices: 1, duplicates: 0, failures: 0, paused: true });
      await new Promise(process.nextTick);
      expect(service.runOnce).toHaveBeenCalledTimes(1);
    });

    it("returns idle status when not running", () => {
      const service = createMockIngestionService();
      const router = createJobsRouter(service);
      const res = mockResponse();

      findHandler(router, "post", "/jobs/ingest/pause")(mockRequest({ authContext: defaultAuth }), res);

      expect((res.jsonBody as { state: string }).state).toBe("idle");
      expect(service.requestPause).not.toHaveBeenCalled();
    });
  });

  describe("POST /jobs/ingest/email-simulate", () => {
    it("returns 400 when email simulation service is unavailable", async () => {
      const router = createJobsRouter(createMockIngestionService());
      const res = mockResponse();
      await findHandler(router, "post", "/jobs/ingest/email-simulate")(mockRequest({ authContext: defaultAuth }), res, jest.fn());
      expect(res.statusCode).toBe(400);
    });

    it("seeds emails and starts ingestion", async () => {
      const emailService = { seedSampleEmails: jest.fn(async () => ({ emailsSeeded: 3, attachmentsSeeded: 5 })) };
      const service = createMockIngestionService({ runOnce: jest.fn(() => new Promise(() => {})) });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const router = createJobsRouter(service, emailService as any);
      const res = mockResponse();

      await findHandler(router, "post", "/jobs/ingest/email-simulate")(mockRequest({ authContext: defaultAuth }), res, jest.fn());

      expect(res.statusCode).toBe(202);
      const body = res.jsonBody as { emailSimulation: { emailsSeeded: number } };
      expect(body.emailSimulation.emailsSeeded).toBe(3);
    });
  });

  describe("pendingRerun lifecycle", () => {
    it("triggers rerun on completion when pendingRerun is set", async () => {
      let resolveFirst: (value: unknown) => void;
      const runOnceFn = jest.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(async () => ({ totalFiles: 1, newInvoices: 1, duplicates: 0, failures: 0, paused: false }));

      const service = createMockIngestionService({ runOnce: runOnceFn });
      const router = createJobsRouter(service);
      const handler = findHandler(router, "post", "/jobs/ingest");

      await handler(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());
      await handler(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());

      resolveFirst!({ totalFiles: 2, newInvoices: 2, duplicates: 0, failures: 0, paused: false });
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(runOnceFn).toHaveBeenCalledTimes(2);
    });

    it("does not rerun when flag is not set", async () => {
      let resolveFirst: (value: unknown) => void;
      const runOnceFn = jest.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
      const router = createJobsRouter(createMockIngestionService({ runOnce: runOnceFn }));

      await findHandler(router, "post", "/jobs/ingest")(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());

      resolveFirst!({ totalFiles: 2, newInvoices: 2, duplicates: 0, failures: 0, paused: false });
      await new Promise(process.nextTick);

      expect(runOnceFn).toHaveBeenCalledTimes(1);
    });

    it("clears pendingRerun on job failure", async () => {
      let rejectFirst: (reason: unknown) => void;
      const runOnceFn = jest.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
      const router = createJobsRouter(createMockIngestionService({ runOnce: runOnceFn }));
      const handler = findHandler(router, "post", "/jobs/ingest");

      await handler(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());
      await handler(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());

      rejectFirst!(new Error("ingestion crash"));
      await new Promise(process.nextTick);

      const statusRes = mockResponse();
      findHandler(router, "get", "/jobs/ingest/status")(mockRequest({ authContext: defaultAuth }), statusRes);
      expect((statusRes.jsonBody as { state: string }).state).toBe("failed");
      expect(runOnceFn).toHaveBeenCalledTimes(1);
    });

    it("caps reruns at 5", async () => {
      const resolvers: Array<(value: unknown) => void> = [];
      const runOnceFn = jest.fn().mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
      const router = createJobsRouter(createMockIngestionService({ runOnce: runOnceFn }));
      const handler = findHandler(router, "post", "/jobs/ingest");

      await handler(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());
      await handler(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());

      const summary = { totalFiles: 1, newInvoices: 1, duplicates: 0, failures: 0, paused: false };
      for (let i = 0; i < 6; i++) {
        resolvers[i]!(summary);
        await new Promise(process.nextTick);
        await new Promise(process.nextTick);
        if (i < 5 && runOnceFn.mock.calls.length > i + 1) {
          await handler(mockRequest({ authContext: defaultAuth }), mockResponse(), jest.fn());
        }
      }

      expect(runOnceFn.mock.calls.length).toBeLessThanOrEqual(7);
    });
  });
});
