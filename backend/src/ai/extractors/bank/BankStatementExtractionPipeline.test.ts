import { BankStatementExtractionPipeline } from "@/ai/extractors/bank/BankStatementExtractionPipeline.ts";
import { BankStatementModel, BANK_STATEMENT_SOURCE } from "@/models/bank/BankStatement.ts";
import { BankTransactionModel, BANK_TRANSACTION_SOURCE } from "@/models/bank/BankTransaction.ts";
import * as nativePdfText from "@/ai/extractors/stages/nativePdfText.ts";
import { toUUID } from "@/types/uuid.js";

jest.mock("@/models/bank/BankStatement.ts");
jest.mock("@/models/bank/BankTransaction.ts");
jest.mock("../stages/nativePdfText.ts");

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

const csvColumns = { date: 0, description: 1, debit: 2, credit: 3 };

describe("BankStatementExtractionPipeline (CSV)", () => {
  let parser: BankStatementExtractionPipeline;

  beforeEach(() => {
    parser = new BankStatementExtractionPipeline();
    jest.clearAllMocks();
    makeNativePdfText("");
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();
  });

  it.each<{
    name: string;
    csv: string;
    expectedCount: number;
    expectedTxn?: Record<string, unknown>;
  }>([
    {
      name: "standard 4-column CSV",
      csv: `Date,Description,Debit,Credit\n2026-01-10,Vendor Payment,50000,\n2026-01-11,Customer Refund,,10000`,
      expectedCount: 2,
      expectedTxn: {
        date: new Date("2026-01-10"),
        description: "Vendor Payment",
        debitMinor: 5000000,
        creditMinor: null,
        matchStatus: "unmatched"
      }
    },
    {
      name: "Indian number format (1,08,000.00)",
      csv: `Date,Description,Debit,Credit\n2026-01-10,Vendor,"1,08,000.00",`,
      expectedCount: 1,
      expectedTxn: { debitMinor: 10800000 }
    },
    {
      name: "DD/MM/YYYY dates normalized to ISO",
      csv: `Date,Description,Debit,Credit\n10/01/2026,Vendor Payment,50000,`,
      expectedCount: 1,
      expectedTxn: { date: new Date("2026-01-10") }
    },
    {
      name: "skips rows with neither debit nor credit",
      csv: `Date,Description,Debit,Credit\n2026-01-10,Opening Balance,,\n2026-01-11,Real Txn,50000,`,
      expectedCount: 1
    },
    {
      name: "quoted CSV fields with embedded commas",
      csv: `Date,Description,Debit,Credit\n2026-01-10,"Payment for invoice, Jan",50000,`,
      expectedCount: 1,
      expectedTxn: { description: "Payment for invoice, Jan" }
    }
  ])("parses CSV variant: $name", async ({ csv, expectedCount, expectedTxn }) => {
    const result = await parser.parseCsv(
      toUUID("t1"),
      "bank.csv",
      csv,
      csvColumns,
      "user@test.com"
    );

    expect(result.transactionCount).toBe(expectedCount);

    if (expectedTxn) {
      expect(BankTransactionModel.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining(expectedTxn)])
      );
    }
  });

  it("skips duplicate transactions on re-upload", async () => {
    makeTransactionFind([
      {
        date: new Date("2026-01-10"),
        description: "Vendor Payment",
        debitMinor: 5000000,
        creditMinor: null,
        reference: null
      }
    ]);

    const csv = `Date,Description,Debit,Credit\n2026-01-10,Vendor Payment,50000,\n2026-01-11,New Payment,20000,`;
    const result = await parser.parseCsv(toUUID("t1"), "bank.csv", csv, csvColumns, "user@test.com");

    expect(result.duplicatesSkipped).toBe(1);
    expect(result.transactionCount).toBe(1);
  });

  it("rejects CSV with only headers", async () => {
    const csv = `Date,Description,Debit,Credit`;
    await expect(
      parser.parseCsv(toUUID("t1"), "bank.csv", csv, csvColumns, "user@test.com")
    ).rejects.toThrow("CSV must have at least a header row and one data row.");
  });
});

describe("BankStatementExtractionPipeline.parsePdf", () => {
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
    const ocrProvider = {
      name: "mock-ocr",
      extractText: jest.fn().mockResolvedValue({ text: "should not be called", blocks: [] })
    };

    const parser = new BankStatementExtractionPipeline({ ocrProvider: ocrProvider as never, fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const result = await parser.parsePdf(toUUID("t1"), "statement.pdf", Buffer.from("pdf-content"), "application/pdf", "user@test.com");

    expect(result.transactionCount).toBe(1);
    expect(result.bankName).toBe("ICICI Bank");
    expect(result.accountNumber).toBe("9732");
    expect(ocrProvider.extractText).not.toHaveBeenCalled();
    expect(fieldVerifier.verify).toHaveBeenCalledTimes(1);
  });

  it("throws when SLM field verifier is not available", async () => {
    const parser = new BankStatementExtractionPipeline();

    await expect(
      parser.parsePdf(toUUID("t1"), "test.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com")
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

    const parser = new BankStatementExtractionPipeline({ fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const result = await parser.parsePdf(toUUID("t1"), "large.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com");

    expect(result.transactionCount).toBe(3);
    expect(result.bankName).toBe("ICICI Bank");
    expect(result.accountNumber).toBe("9732");
    expect(fieldVerifier.verify).toHaveBeenCalledTimes(2);
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
    const parser = new BankStatementExtractionPipeline({ fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    await parser.parsePdf(toUUID("t1"), "test.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com");

    const insertCall = (BankTransactionModel.insertMany as jest.Mock).mock.calls[0][0];
    expect(insertCall[0]).toMatchObject({
      date: new Date("2026-01-01")
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
    const parser = new BankStatementExtractionPipeline({ fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const result = await parser.parsePdf(toUUID("t1"), "test.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com");

    expect(result.transactionCount).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("stores pdf-parsed source constant on statement and transactions", async () => {
    const nativeText = "Bank statement with sufficient text content " + "x".repeat(200);
    makeNativePdfText(nativeText);

    const slmData = {
      bankName: "ICICI Bank",
      accountNumber: "9732",
      accountHolder: "John Doe",
      transactions: [
        { date: "2026-01-10", description: "UPI Payment", debit: 500.00, credit: null, balance: 1000.00 }
      ]
    };
    const fieldVerifier = makeSlmResponse(slmData);
    const parser = new BankStatementExtractionPipeline({ fieldVerifier: fieldVerifier as never });
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    await parser.parsePdf(toUUID("t1"), "statement.pdf", Buffer.from("pdf"), "application/pdf", "user@test.com");

    const createCall = (BankStatementModel.create as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(createCall["source"]).toBe(BANK_STATEMENT_SOURCE.PDF);

    const insertCall = (BankTransactionModel.insertMany as jest.Mock).mock.calls[0][0];
    expect(insertCall[0].source).toBe(BANK_TRANSACTION_SOURCE.PDF);
  });
});
