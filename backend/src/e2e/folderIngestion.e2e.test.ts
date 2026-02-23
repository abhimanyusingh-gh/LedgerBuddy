import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { FolderIngestionSource } from "../sources/FolderIngestionSource.ts";
import { IngestionService } from "../services/ingestionService.ts";
import { MockOcrProvider } from "../ocr/MockOcrProvider.ts";
import { InvoiceService, InvoiceUpdateError } from "../services/invoiceService.ts";
import { CheckpointModel } from "../models/Checkpoint.ts";
import { InvoiceModel } from "../models/Invoice.ts";

const mongoUri = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/invoice_processor_e2e";
jest.setTimeout(30_000);

describe("folder ingestion e2e", () => {
  let fixtureDir = "";

  beforeAll(async () => {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5_000 });
    } catch (error) {
      throw new Error(
        `Could not connect to MongoDB at '${mongoUri}'. Start local services with 'docker compose up -d'. Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("MongoDB database is not initialized for e2e test.");
    }
    await db.dropDatabase();

    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "invoice-e2e-"));

    process.env.MOCK_OCR_TEXT = [
      "Invoice Number: E2E-1001",
      "Vendor: Local Vendor Pvt Ltd",
      "Invoice Date: 2026-02-10",
      "Due Date: 2026-02-25",
      "Currency: USD",
      "Grand Total: 1250.00"
    ].join("\n");
    process.env.MOCK_OCR_CONFIDENCE = "0.97";

    await fs.writeFile(path.join(fixtureDir, "invoice-1.jpg"), Buffer.from("fake-jpeg-content"));
    await fs.writeFile(path.join(fixtureDir, "invoice-2.png"), Buffer.from("fake-png-content"));
  });

  afterEach(async () => {
    delete process.env.MOCK_OCR_TEXT;
    delete process.env.MOCK_OCR_CONFIDENCE;

    if (fixtureDir) {
      await fs.rm(fixtureDir, { recursive: true, force: true });
      fixtureDir = "";
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  it("processes invoices from folder and prepares dashboard review data", async () => {
    const source = new FolderIngestionSource({
      key: "e2e-folder",
      folderPath: fixtureDir,
      recursive: false
    });

    const ingestionService = new IngestionService([source], new MockOcrProvider());

    const firstRun = await ingestionService.runOnce();
    expect(firstRun.totalFiles).toBe(2);
    expect(firstRun.newInvoices).toBe(2);
    expect(firstRun.failures).toBe(0);

    const checkpoint = await CheckpointModel.findOne({ sourceKey: "e2e-folder" }).lean();
    expect(checkpoint?.marker).toBeTruthy();

    const secondRun = await ingestionService.runOnce();
    expect(secondRun.totalFiles).toBe(0);
    expect(secondRun.newInvoices).toBe(0);

    const invoiceService = new InvoiceService();
    const list = await invoiceService.listInvoices({ page: 1, limit: 20 });

    expect(list.total).toBe(2);
    expect(list.items).toHaveLength(2);
    expect(list.items.every((item) => item.status === "PARSED" || item.status === "NEEDS_REVIEW")).toBe(true);
    expect(list.items.every((item) => item.confidenceScore >= 80)).toBe(true);
    expect(list.items.every((item) => Number.isInteger(item.parsed?.totalAmountMinor))).toBe(true);
  });

  it("stores checkpoint after each processed file so a crash can resume from last marker", async () => {
    const source = new FolderIngestionSource({
      key: "e2e-folder",
      folderPath: fixtureDir,
      recursive: false
    });

    let fileCount = 0;
    const crashingService = new IngestionService([source], new MockOcrProvider(), {
      afterFileProcessed: async () => {
        fileCount += 1;
        if (fileCount === 1) {
          throw new Error("Simulated worker crash after first file");
        }
      }
    });

    await expect(crashingService.runOnce()).rejects.toThrow("Simulated worker crash after first file");

    const checkpointAfterCrash = await CheckpointModel.findOne({ sourceKey: "e2e-folder" }).lean();
    expect(checkpointAfterCrash?.marker).toBeTruthy();

    const resumeService = new IngestionService([source], new MockOcrProvider());
    const resumedRun = await resumeService.runOnce();
    expect(resumedRun.totalFiles).toBe(1);
    expect(resumedRun.newInvoices).toBe(1);

    const invoiceService = new InvoiceService();
    const list = await invoiceService.listInvoices({ page: 1, limit: 20 });
    expect(list.total).toBe(2);
  });

  it("allows approver edits before export and blocks edits after export", async () => {
    const source = new FolderIngestionSource({
      key: "e2e-folder",
      folderPath: fixtureDir,
      recursive: false
    });

    const ingestionService = new IngestionService([source], new MockOcrProvider());
    await ingestionService.runOnce();

    const invoiceService = new InvoiceService();
    const list = await invoiceService.listInvoices({ page: 1, limit: 5 });
    expect(list.items.length).toBeGreaterThan(0);

    const invoiceId = String(list.items[0]._id);
    const updatedInvoice = await invoiceService.updateInvoiceParsedFields(
      invoiceId,
      {
        vendorName: "Edited Vendor Pvt Ltd",
        currency: "USD",
        totalAmountMajor: "1500.75"
      },
      "e2e-user"
    );

    expect(updatedInvoice.parsed?.vendorName).toBe("Edited Vendor Pvt Ltd");
    expect(updatedInvoice.parsed?.totalAmountMinor).toBe(150075);

    await InvoiceModel.findByIdAndUpdate(invoiceId, { status: "EXPORTED" });
    await expect(
      invoiceService.updateInvoiceParsedFields(invoiceId, { vendorName: "Should Fail" }, "e2e-user")
    ).rejects.toThrow(InvoiceUpdateError);
  });

  it("changes NEEDS_REVIEW invoices to APPROVED when approved", async () => {
    const source = new FolderIngestionSource({
      key: "e2e-folder",
      folderPath: fixtureDir,
      recursive: false
    });

    const ingestionService = new IngestionService([source], new MockOcrProvider());
    await ingestionService.runOnce();

    const invoiceService = new InvoiceService();
    const list = await invoiceService.listInvoices({ page: 1, limit: 5 });
    expect(list.items.length).toBeGreaterThan(0);

    const invoiceId = String(list.items[0]._id);
    await InvoiceModel.findByIdAndUpdate(invoiceId, { status: "NEEDS_REVIEW" });

    const modifiedCount = await invoiceService.approveInvoices([invoiceId], "e2e-approver");
    expect(modifiedCount).toBe(1);

    const updatedInvoice = await invoiceService.getInvoiceById(invoiceId);
    expect(updatedInvoice?.status).toBe("APPROVED");
    expect(updatedInvoice?.approval?.approvedBy).toBe("e2e-approver");
    expect(updatedInvoice?.approval?.approvedAt).toBeTruthy();
  });

  it("ingests new files even when copied with mtime older than last checkpoint", async () => {
    const source = new FolderIngestionSource({
      key: "e2e-folder",
      folderPath: fixtureDir,
      recursive: false
    });

    const ingestionService = new IngestionService([source], new MockOcrProvider());

    const firstRun = await ingestionService.runOnce();
    expect(firstRun.newInvoices).toBe(2);

    const oldTimestamp = new Date("2000-01-01T00:00:00.000Z");
    const delayedFilePath = path.join(fixtureDir, "invoice-older-mtime.jpg");
    await fs.writeFile(delayedFilePath, Buffer.from("older-mtime-content"));
    await fs.utimes(delayedFilePath, oldTimestamp, oldTimestamp);

    const secondRun = await ingestionService.runOnce();
    expect(secondRun.totalFiles).toBe(1);
    expect(secondRun.newInvoices).toBe(1);
    expect(secondRun.failures).toBe(0);

    const invoiceService = new InvoiceService();
    const list = await invoiceService.listInvoices({ page: 1, limit: 20 });
    expect(list.total).toBe(3);
  });

  it("routes PDF files through OCR provider extraction path", async () => {
    const source = new FolderIngestionSource({
      key: "e2e-folder",
      folderPath: fixtureDir,
      recursive: false
    });

    const samplePdfPath = path.join(
      process.cwd(),
      "..",
      "sample-invoices",
      "inbox",
      "invoice2data__AmazonWebServices.pdf"
    );
    await fs.rm(path.join(fixtureDir, "invoice-1.jpg"));
    await fs.rm(path.join(fixtureDir, "invoice-2.png"));
    await fs.copyFile(samplePdfPath, path.join(fixtureDir, "invoice-source.pdf"));

    process.env.MOCK_OCR_TEXT = [
      "Invoice Number: PDF-901",
      "Vendor: PDF Vendor Pvt Ltd",
      "Invoice Date: 2026-02-10",
      "Due Date: 2026-02-20",
      "Currency: USD",
      "Grand Total: 10.00"
    ].join("\n");
    process.env.MOCK_OCR_CONFIDENCE = "0.92";

    const ingestionService = new IngestionService([source], new MockOcrProvider());
    const result = await ingestionService.runOnce();
    expect(result.newInvoices).toBe(1);
    expect(result.failures).toBe(0);

    const invoiceService = new InvoiceService();
    const list = await invoiceService.listInvoices({ page: 1, limit: 20 });
    const pdfInvoice = list.items.find((item) => item.attachmentName === "invoice-source.pdf");

    expect(pdfInvoice).toBeTruthy();
    expect(pdfInvoice?.ocrProvider).toBe("mock");
    expect((pdfInvoice?.metadata as Record<string, string | undefined> | undefined)?.extractionSource).toBe(
      "ocr-provider"
    );
  });
});
