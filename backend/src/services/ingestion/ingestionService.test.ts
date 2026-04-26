import type { FileStore } from "@/core/interfaces/FileStore.js";
import type { OcrProvider } from "@/core/interfaces/OcrProvider.js";
import { CheckpointModel } from "@/models/core/Checkpoint.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { IngestionService } from "@/services/ingestion/ingestionService.js";
import type { InvoiceExtractionPipeline } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";
import { S3UploadIngestionSource } from "@/sources/S3UploadIngestionSource.js";
import { describeHarness } from "@/test-utils";
import { EXTRACTION_SOURCE } from "@/core/engine/extractionSource.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { toUUID } from "@/types/uuid.js";
import { logger } from "@/utils/logger.js";

const TENANT_ID = toUUID("tenant-orch-checkpoint");

const noopOcrProvider: OcrProvider = {
  name: "noop",
  async extractText() {
    return { text: "", provider: "noop", blocks: [], pageImages: [] };
  }
};

function buildStubPipeline(parsedSummary: string): InvoiceExtractionPipeline {
  const extract = jest.fn(async () => ({
    provider: "noop",
    text: `extracted-${parsedSummary}`,
    confidence: 0.9,
    source: EXTRACTION_SOURCE.SLM,
    strategy: EXTRACTION_SOURCE.SLM,
    parseResult: { parsed: { invoiceNumber: parsedSummary }, warnings: [] },
    confidenceAssessment: { score: 0.9, tone: "green" as const, autoSelectForApproval: true },
    ocrBlocks: [],
    ocrPageImages: [],
    processingIssues: [],
    metadata: {}
  }));
  return { extract } as unknown as InvoiceExtractionPipeline;
}

function buildFileStore(objects: Array<{ key: string; lastModified: Date }>): FileStore {
  return {
    name: "harness-store",
    putObject: jest.fn(async (input) => ({ key: input.key, path: `/data/${input.key}`, contentType: input.contentType })),
    getObject: jest.fn(async (key: string) => ({ body: Buffer.from(`bytes-${key}`), contentType: "application/pdf" })),
    deleteObject: jest.fn(async () => {}),
    listObjects: jest.fn(async () => objects.slice())
  };
}

describeHarness("IngestionService — S3 checkpoint regression", ({ getHarness }) => {
  beforeAll(async () => {
    await CheckpointModel.syncIndexes();
    await InvoiceModel.syncIndexes();
  });

  afterEach(async () => {
    await getHarness().reset();
  });

  it("advances the persisted checkpoint to the latest LastModified after a successful run", async () => {
    const objects = [
      { key: `uploads/${TENANT_ID}/a.pdf`, lastModified: new Date("2026-04-20T10:00:00.000Z") },
      { key: `uploads/${TENANT_ID}/b.pdf`, lastModified: new Date("2026-04-20T11:00:00.000Z") }
    ];
    const fileStore = buildFileStore(objects);
    const service = new IngestionService([], noopOcrProvider, {
      pipeline: buildStubPipeline("first-run"),
      fileStore
    });

    const summary = await service.runOnce({ tenantId: TENANT_ID });

    expect(summary.totalFiles).toBe(2);
    const sourceKey = new S3UploadIngestionSource(TENANT_ID, fileStore).key;
    const persisted = await InvoiceModel.find({ tenantId: TENANT_ID, sourceKey }).lean();
    expect(persisted.map((row) => row.sourceDocumentId).sort()).toEqual([
      `uploads/${TENANT_ID}/a.pdf`,
      `uploads/${TENANT_ID}/b.pdf`
    ]);
    const checkpoint = await CheckpointModel.findOne({ sourceKey, tenantId: TENANT_ID }).lean();
    expect(checkpoint?.marker).toBe(`2026-04-20T11:00:00.000Z|uploads/${TENANT_ID}/b.pdf`);
  });

  it("does NOT re-process objects whose LastModified is at or below the stored checkpoint", async () => {
    const olderKey = `uploads/${TENANT_ID}/old.pdf`;
    const fresherKey = `uploads/${TENANT_ID}/fresh.pdf`;
    const objects = [
      { key: olderKey, lastModified: new Date("2026-04-20T10:00:00.000Z") }
    ];
    const fileStore = buildFileStore(objects);
    const firstPipeline = buildStubPipeline("first-run");
    await new IngestionService([], noopOcrProvider, { pipeline: firstPipeline, fileStore }).runOnce({ tenantId: TENANT_ID });

    objects.push({ key: fresherKey, lastModified: new Date("2026-04-20T12:00:00.000Z") });
    const secondPipeline = buildStubPipeline("second-run");
    const summary = await new IngestionService([], noopOcrProvider, { pipeline: secondPipeline, fileStore }).runOnce({ tenantId: TENANT_ID });

    expect(summary.totalFiles).toBe(1);
    expect((secondPipeline.extract as jest.Mock).mock.calls).toHaveLength(1);
    expect((secondPipeline.extract as jest.Mock).mock.calls[0][0].sourceKey).toBe(`s3-upload-${TENANT_ID}`);
    expect((secondPipeline.extract as jest.Mock).mock.calls[0][0].attachmentName).toBe("fresh.pdf");
  });

  it("does NOT clobber a human-edited PARSED row on a re-poll (regression for upsertFromPending overwrite-fallback)", async () => {
    const editedKey = `uploads/${TENANT_ID}/edited.pdf`;
    const objects = [{ key: editedKey, lastModified: new Date("2026-04-20T10:00:00.000Z") }];
    const fileStore = buildFileStore(objects);

    const firstPipeline = buildStubPipeline("auto-extracted");
    await new IngestionService([], noopOcrProvider, { pipeline: firstPipeline, fileStore }).runOnce({ tenantId: TENANT_ID });

    const sourceKey = new S3UploadIngestionSource(TENANT_ID, fileStore).key;
    const persisted = await InvoiceModel.findOne({ tenantId: TENANT_ID, sourceDocumentId: editedKey }).lean();
    expect(persisted).not.toBeNull();
    await InvoiceModel.findByIdAndUpdate(persisted!._id, {
      $set: {
        attachmentName: "human-renamed.pdf",
        ocrText: "human-edited-text",
        status: INVOICE_STATUS.PARSED
      }
    });

    const secondPipeline = buildStubPipeline("would-clobber");
    await new IngestionService([], noopOcrProvider, { pipeline: secondPipeline, fileStore }).runOnce({ tenantId: TENANT_ID });

    expect((secondPipeline.extract as jest.Mock)).not.toHaveBeenCalled();
    const after = await InvoiceModel.findOne({ tenantId: TENANT_ID, sourceDocumentId: editedKey, sourceKey }).lean();
    expect(after?.ocrText).toBe("human-edited-text");
    expect(after?.attachmentName).toBe("human-renamed.pdf");
    expect(after?.status).toBe(INVOICE_STATUS.PARSED);
  });

  it("legacy ISO-only marker re-yields an object but upsertFromPending protects the human-edited PARSED row", async () => {
    const editedKey = `uploads/${TENANT_ID}/legacy.pdf`;
    const lastModified = new Date("2026-04-20T10:00:00.000Z");
    const objects = [{ key: editedKey, lastModified }];
    const fileStore = buildFileStore(objects);

    const firstPipeline = buildStubPipeline("auto-extracted");
    await new IngestionService([], noopOcrProvider, { pipeline: firstPipeline, fileStore }).runOnce({ tenantId: TENANT_ID });

    const sourceKey = new S3UploadIngestionSource(TENANT_ID, fileStore).key;
    const persisted = await InvoiceModel.findOne({ tenantId: TENANT_ID, sourceDocumentId: editedKey }).lean();
    expect(persisted).not.toBeNull();
    await InvoiceModel.findByIdAndUpdate(persisted!._id, {
      $set: {
        attachmentName: "human-renamed.pdf",
        ocrText: "human-edited-text",
        "parsed.invoiceNumber": "human-edited-invoice-number",
        status: INVOICE_STATUS.PARSED
      }
    });

    await CheckpointModel.findOneAndUpdate(
      { sourceKey, tenantId: TENANT_ID },
      { sourceKey, tenantId: TENANT_ID, marker: lastModified.toISOString() },
      { upsert: true, new: true }
    );

    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      const secondPipeline = buildStubPipeline("would-clobber");
      await new IngestionService([], noopOcrProvider, { pipeline: secondPipeline, fileStore }).runOnce({ tenantId: TENANT_ID });

      expect((secondPipeline.extract as jest.Mock)).toHaveBeenCalledTimes(1);
      const after = await InvoiceModel.findOne({ tenantId: TENANT_ID, sourceDocumentId: editedKey, sourceKey }).lean();
      expect(after?.ocrText).toBe("human-edited-text");
      expect(after?.attachmentName).toBe("human-renamed.pdf");
      expect(after?.status).toBe(INVOICE_STATUS.PARSED);
      expect((after?.parsed as { invoiceNumber?: string } | null | undefined)?.invoiceNumber).toBe("human-edited-invoice-number");

      const protectedLog = warnSpy.mock.calls.find(([msg]) => msg === "ingestion.upsert.skipped.protected");
      expect(protectedLog).toBeDefined();
      expect(protectedLog?.[1]).toMatchObject({
        sourceDocumentId: editedKey,
        existingStatus: INVOICE_STATUS.PARSED
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not advance the checkpoint when the source returns an empty batch", async () => {
    const fileStore = buildFileStore([]);
    const sourceKey = new S3UploadIngestionSource(TENANT_ID, fileStore).key;
    await CheckpointModel.create({
      sourceKey,
      tenantId: TENANT_ID,
      marker: "2026-04-20T09:00:00.000Z"
    });

    await new IngestionService([], noopOcrProvider, {
      pipeline: buildStubPipeline("noop"),
      fileStore
    }).runOnce({ tenantId: TENANT_ID });

    const checkpoint = await CheckpointModel.findOne({ sourceKey, tenantId: TENANT_ID }).lean();
    expect(checkpoint?.marker).toBe("2026-04-20T09:00:00.000Z");
  });
});

