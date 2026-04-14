import { BankStatementParser } from "./BankStatementParser.ts";
import { BankStatementModel } from "../../../models/bank/BankStatement.ts";
import { BankTransactionModel } from "../../../models/bank/BankTransaction.ts";
import * as nativePdfText from "../invoice/stages/nativePdfText.ts";

jest.mock("../../../models/bank/BankStatement.ts");
jest.mock("../../../models/bank/BankTransaction.ts");
jest.mock("../invoice/stages/nativePdfText.ts");

function makeStatementCreate(id = "stmt-1") {
  (BankStatementModel.create as jest.Mock).mockResolvedValue({ _id: id });
}

function makeTransactionInsert() {
  (BankTransactionModel.insertMany as jest.Mock).mockResolvedValue([]);
}

function makeTransactionFind(results: unknown[] = []) {
  (BankTransactionModel.find as jest.Mock).mockReturnValue({
    lean: jest.fn().mockResolvedValue(results)
  });
}

function makeNativePdfText(text: string) {
  (nativePdfText.extractNativePdfText as jest.Mock).mockReturnValue(text);
}

function makeSlmResponse(data: Record<string, unknown>) {
  return {
    name: "mock-slm",
    verify: jest.fn().mockResolvedValue({
      parsed: {},
      issues: [],
      changedFields: [],
      contract: { rawJson: JSON.stringify(data) }
    })
  };
}

function makeOcrProvider(text: string) {
  return {
    name: "mock-ocr",
    extractText: jest.fn().mockResolvedValue({ text, blocks: [] })
  };
}

describe("BankStatementParser", () => {
  let parser: BankStatementParser;

  beforeEach(() => {
    parser = new BankStatementParser();
    jest.clearAllMocks();
    makeNativePdfText("");
  });

  it("parses standard 4-column CSV into transactions", async () => {
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const csv = `Date,Description,Debit,Credit\n2026-01-10,Vendor Payment,50000,\n2026-01-11,Customer Refund,,10000`;
    const result = await parser.parseCsv("t1", "bank.csv", csv, { date: 0, description: 1, debit: 2, credit: 3 }, "user@test.com");

    expect(result.transactionCount).toBe(2);
    expect(result.duplicatesSkipped).toBe(0);

    const insertCall = (BankTransactionModel.insertMany as jest.Mock).mock.calls[0][0];
    expect(insertCall).toHaveLength(2);

    expect(insertCall[0]).toMatchObject({
      tenantId: "t1",
      date: "2026-01-10",
      description: "Vendor Payment",
      debitMinor: 5000000,
      creditMinor: null,
      matchStatus: "unmatched"
    });

    expect(insertCall[1]).toMatchObject({
      tenantId: "t1",
      date: "2026-01-11",
      description: "Customer Refund",
      debitMinor: null,
      creditMinor: 1000000,
      matchStatus: "unmatched"
    });
  });

  it("handles Indian number format (1,08,000.00)", async () => {
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const csv = `Date,Description,Debit,Credit\n2026-01-10,Vendor,"1,08,000.00",`;
    const result = await parser.parseCsv("t1", "bank.csv", csv, { date: 0, description: 1, debit: 2, credit: 3 }, "user@test.com");

    expect(result.transactionCount).toBe(1);
    expect(BankTransactionModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ debitMinor: 10800000 })
      ])
    );
  });

  it("normalizes DD/MM/YYYY dates to ISO", async () => {
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const csv = `Date,Description,Debit,Credit\n10/01/2026,Vendor Payment,50000,`;
    await parser.parseCsv("t1", "bank.csv", csv, { date: 0, description: 1, debit: 2, credit: 3 }, "user@test.com");

    expect(BankTransactionModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-01-10" })
      ])
    );
  });

  it("skips rows with no debit and no credit", async () => {
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const csv = `Date,Description,Debit,Credit\n2026-01-10,Opening Balance,,\n2026-01-11,Real Txn,50000,`;
    const result = await parser.parseCsv("t1", "bank.csv", csv, { date: 0, description: 1, debit: 2, credit: 3 }, "user@test.com");

    expect(result.transactionCount).toBe(1);
  });

  it("handles quoted CSV fields with commas", async () => {
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const csv = `Date,Description,Debit,Credit\n2026-01-10,"Payment for invoice, Jan",50000,`;
    const result = await parser.parseCsv("t1", "bank.csv", csv, { date: 0, description: 1, debit: 2, credit: 3 }, "user@test.com");

    expect(result.transactionCount).toBe(1);
    expect(BankTransactionModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ description: "Payment for invoice, Jan" })
      ])
    );
  });

  it("skips duplicate transactions on re-upload", async () => {
    const existingTxns = [
      {
        date: "2026-01-10",
        description: "Vendor Payment",
        debitMinor: 5000000,
        creditMinor: null,
        reference: null
      }
    ];
    makeTransactionFind(existingTxns);
    makeStatementCreate();
    makeTransactionInsert();

    const csv = `Date,Description,Debit,Credit\n2026-01-10,Vendor Payment,50000,\n2026-01-11,New Payment,20000,`;
    const result = await parser.parseCsv("t1", "bank.csv", csv, { date: 0, description: 1, debit: 2, credit: 3 }, "user@test.com");

    expect(result.duplicatesSkipped).toBe(1);
    expect(result.transactionCount).toBe(1);
  });

  it("rejects CSV with only headers", async () => {
    const csv = `Date,Description,Debit,Credit`;
    await expect(
      parser.parseCsv("t1", "bank.csv", csv, { date: 0, description: 1, debit: 2, credit: 3 }, "user@test.com")
    ).rejects.toThrow("CSV must have at least a header row and one data row.");
  });
});

describe("BankStatementParser.parsePdf", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    makeNativePdfText("");
  });

  it("uses native PDF text when sufficient content is available (skips OCR)", async () => {
    const nativeText = "ICICI Bank Statement\nAccount: 056901509732\n" + "x".repeat(200);
    makeNativePdfText(nativeText);

    const slmData = {
      bankName: "ICICI Bank",
      accountNumber: "9732",
      periodFrom: "2026-01-01",
      periodTo: "2026-03-07",
      transactions: [
        { date: "2026-01-01", description: "UPI/EKTA SINGH", debit: 1001.00, credit: null, balance: 2618.73 }
      ]
    };
    const fieldVerifier = makeSlmResponse(slmData);
    const ocrProvider = makeOcrProvider("should not be called");

    const parser = new BankStatementParser({ ocrProvider: ocrProvider as never, fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const result = await parser.parsePdf("t1", "statement.pdf", Buffer.from("pdf-content"), "application/pdf", "user@test.com");

    expect(result.transactionCount).toBe(1);
    expect(result.bankName).toBe("ICICI Bank");
    expect(result.accountNumber).toBe("9732");
    expect(ocrProvider.extractText).not.toHaveBeenCalled();
    expect(fieldVerifier.verify).toHaveBeenCalledTimes(1);

    const insertCall = (BankTransactionModel.insertMany as jest.Mock).mock.calls[0][0];
    expect(insertCall[0]).toMatchObject({
      debitMinor: 100100,
      creditMinor: null,
      balanceMinor: 261873
    });
  });

  it("falls back to OCR when native text is insufficient", async () => {
    makeNativePdfText("short");

    const slmData = {
      bankName: "HDFC Bank",
      accountNumber: "1234",
      transactions: [
        { date: "2026-02-15", description: "NEFT Transfer", debit: null, credit: 50000.00, balance: 75000.00 }
      ]
    };
    const fieldVerifier = makeSlmResponse(slmData);
    const ocrProvider = makeOcrProvider("HDFC Bank Statement\nAccount details and transactions...");

    const parser = new BankStatementParser({ ocrProvider: ocrProvider as never, fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const result = await parser.parsePdf("t1", "hdfc.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com");

    expect(result.transactionCount).toBe(1);
    expect(result.bankName).toBe("HDFC Bank");
    expect(ocrProvider.extractText).toHaveBeenCalledTimes(1);
  });

  it("throws when native text is insufficient and no OCR provider is available", async () => {
    makeNativePdfText("short");

    const fieldVerifier = makeSlmResponse({ transactions: [] });
    const parser = new BankStatementParser({ fieldVerifier: fieldVerifier as never });

    await expect(
      parser.parsePdf("t1", "scan.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com")
    ).rejects.toThrow("Native PDF text extraction yielded insufficient text and OCR provider is not available.");
  });

  it("throws when SLM field verifier is not available", async () => {
    const parser = new BankStatementParser();

    await expect(
      parser.parsePdf("t1", "test.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com")
    ).rejects.toThrow("SLM field verifier is not available.");
  });

  it("processes large text in chunks", async () => {
    const largeText = "ICICI Bank\nAccount: 9732\n" + Array.from({ length: 200 }, (_, i) =>
      `${String(i + 1).padStart(3, "0")} 01.01.2026 UPI/Payment-${i + 1} 100.00 0.00 ${1000 + i}.00`
    ).join("\n");
    makeNativePdfText(largeText);

    const chunk1Response = {
      bankName: "ICICI Bank",
      accountNumber: "9732",
      periodFrom: "2026-01-01",
      periodTo: "2026-01-01",
      transactions: [
        { date: "2026-01-01", description: "UPI/Payment-1", debit: 100.00, credit: null, balance: 1000.00 },
        { date: "2026-01-01", description: "UPI/Payment-2", debit: 100.00, credit: null, balance: 1001.00 }
      ]
    };
    const chunk2Response = {
      transactions: [
        { date: "2026-01-01", description: "UPI/Payment-3", debit: 100.00, credit: null, balance: 1002.00 }
      ]
    };

    let callCount = 0;
    const fieldVerifier = {
      name: "mock-slm",
      verify: jest.fn().mockImplementation(() => {
        callCount++;
        const data = callCount === 1 ? chunk1Response : chunk2Response;
        return Promise.resolve({
          parsed: {},
          issues: [],
          changedFields: [],
          contract: { rawJson: JSON.stringify(data) }
        });
      })
    };

    const parser = new BankStatementParser({ fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const result = await parser.parsePdf("t1", "large.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com");

    expect(result.transactionCount).toBe(3);
    expect(result.bankName).toBe("ICICI Bank");
    expect(result.accountNumber).toBe("9732");
    expect(fieldVerifier.verify).toHaveBeenCalledTimes(2);
  });

  it("converts SLM rupee amounts to paise (minor units)", async () => {
    const nativeText = "Bank statement with sufficient text content for extraction " + "x".repeat(200);
    makeNativePdfText(nativeText);

    const slmData = {
      bankName: "SBI",
      transactions: [
        { date: "2026-01-16", description: "NEFT L AND T FINANCE", debit: null, credit: 685300.00, balance: 685916.73 }
      ]
    };
    const fieldVerifier = makeSlmResponse(slmData);
    const parser = new BankStatementParser({ fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    await parser.parsePdf("t1", "sbi.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com");

    const insertCall = (BankTransactionModel.insertMany as jest.Mock).mock.calls[0][0];
    expect(insertCall[0]).toMatchObject({
      creditMinor: 68530000,
      balanceMinor: 68591673
    });
  });

  it("handles DD.MM.YYYY date format from SLM output", async () => {
    const nativeText = "Statement text " + "x".repeat(200);
    makeNativePdfText(nativeText);

    const slmData = {
      transactions: [
        { date: "01.01.2026", description: "UPI Payment", debit: 500.00, credit: null, balance: 1000.00 }
      ]
    };
    const fieldVerifier = makeSlmResponse(slmData);
    const parser = new BankStatementParser({ fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    await parser.parsePdf("t1", "test.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com");

    const insertCall = (BankTransactionModel.insertMany as jest.Mock).mock.calls[0][0];
    expect(insertCall[0]).toMatchObject({
      date: "2026-01-01"
    });
  });

  it("reports warnings for invalid transactions without failing", async () => {
    const nativeText = "Statement text " + "x".repeat(200);
    makeNativePdfText(nativeText);

    const slmData = {
      transactions: [
        { date: "2026-01-01", description: "Valid", debit: 100.00, credit: null, balance: 900.00 },
        { date: "", description: "Missing date", debit: 50.00, credit: null },
        { date: "2026-01-02", description: "No amounts", debit: null, credit: null },
        "not-an-object"
      ]
    };
    const fieldVerifier = makeSlmResponse(slmData);
    const parser = new BankStatementParser({ fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const result = await parser.parsePdf("t1", "test.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com");

    expect(result.transactionCount).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
