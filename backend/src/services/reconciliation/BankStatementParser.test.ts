import { BankStatementParser } from "./BankStatementParser.ts";
import { BankStatementModel } from "../../models/BankStatement.ts";
import { BankTransactionModel } from "../../models/BankTransaction.ts";

jest.mock("../../models/BankStatement.ts");
jest.mock("../../models/BankTransaction.ts");

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

describe("BankStatementParser", () => {
  let parser: BankStatementParser;

  beforeEach(() => {
    parser = new BankStatementParser();
    jest.clearAllMocks();
  });

  it("parses standard 4-column CSV into transactions", async () => {
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const csv = `Date,Description,Debit,Credit\n2026-01-10,Vendor Payment,50000,\n2026-01-11,Customer Refund,,10000`;
    const result = await parser.parseCsv("t1", "bank.csv", csv, { date: 0, description: 1, debit: 2, credit: 3 }, "user@test.com");

    expect(result.transactionCount).toBe(2);
    expect(result.duplicatesSkipped).toBe(0);
    expect(BankTransactionModel.insertMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ debitMinor: 5000000 }),
        expect.objectContaining({ creditMinor: 1000000 })
      ])
    );
  });

  it("handles Indian number format (1,08,000.00)", async () => {
    makeStatementCreate();
    makeTransactionInsert();
    makeTransactionFind();

    const csv = `Date,Description,Debit,Credit\n2026-01-10,"Vendor","1,08,000.00",`;
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
