import { ReconciliationService } from "./ReconciliationService.ts";
import { InvoiceModel } from "../../models/Invoice.ts";
import { BankTransactionModel } from "../../models/BankTransaction.ts";
import { BankStatementModel } from "../../models/BankStatement.ts";
import { TenantTcsConfigModel } from "../../models/TenantTcsConfig.ts";

jest.mock("../../models/Invoice.ts");
jest.mock("../../models/BankTransaction.ts");
jest.mock("../../models/BankStatement.ts");
jest.mock("../../models/TenantTcsConfig.ts");

function makeTxn(overrides: Partial<{
  _id: string;
  debitMinor: number;
  description: string;
  date: string;
  matchedInvoiceId: string | null;
}> = {}) {
  return {
    _id: "txn-1",
    tenantId: "t1",
    statementId: "stmt-1",
    debitMinor: 100000,
    description: "Payment INV-001",
    date: "2026-01-15",
    matchedInvoiceId: null,
    matchStatus: "unmatched",
    ...overrides
  };
}

function makeInvoice(overrides: Partial<{
  _id: string;
  parsed: { invoiceNumber: string; vendorName: string; totalAmountMinor: number };
  compliance: Record<string, unknown>;
  approval: { approvedAt: string };
}> = {}) {
  return {
    _id: "inv-1",
    tenantId: "t1",
    status: "APPROVED",
    parsed: { invoiceNumber: "INV-001", vendorName: "Acme Corp", totalAmountMinor: 100000 },
    compliance: {
      tds: { netPayableMinor: 100000 }
    },
    approval: { approvedAt: "2026-01-14T10:00:00Z" },
    ...overrides
  };
}

describe("ReconciliationService", () => {
  let service: ReconciliationService;

  beforeEach(() => {
    service = new ReconciliationService();
    jest.clearAllMocks();
    (TenantTcsConfigModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
  });

  it("auto-matches when amount exactly equals netPayable", async () => {
    const invoice = makeInvoice();
    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) });
    (BankTransactionModel.updateOne as jest.Mock).mockResolvedValue({});
    (InvoiceModel.updateOne as jest.Mock).mockResolvedValue({});

    const candidates = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Payment INV-001", date: "2026-01-15" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].invoiceId).toBe("inv-1");
    expect(candidates[0].score).toBeGreaterThanOrEqual(50);
  });

  it("scores higher when invoice number appears in description", async () => {
    const invoice = makeInvoice({ parsed: { invoiceNumber: "INV-999", vendorName: "Acme", totalAmountMinor: 100000 } });
    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) });

    const withInvNum = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Ref INV-999 payment", date: "2026-01-15" });

    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) });

    const withoutInvNum = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Wire transfer ref unknown", date: "2026-01-15" });

    expect(withInvNum).toHaveLength(1);
    expect(withInvNum[0].invoiceId).toBe("inv-1");
    expect(withoutInvNum).toHaveLength(1);
    expect(withInvNum[0].score).toBeGreaterThan(withoutInvNum[0].score);
  });

  it("marks as suggested when score is between thresholds", async () => {
    const invoice = makeInvoice({ parsed: { invoiceNumber: "INV-ZZZ", vendorName: "Unknown Vendor XYZ", totalAmountMinor: 100000 } });
    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) });

    const candidates = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Wire transfer", date: "2026-01-20" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].invoiceId).toBe("inv-1");
    expect(candidates[0].score).toBeGreaterThanOrEqual(30);
  });

  it("leaves unmatched when no candidates found", async () => {
    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const candidates = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Unknown", date: "2026-01-15" });

    expect(candidates).toHaveLength(0);
  });

  it("includes TCS rate adjustment in expected bank debit amount", async () => {
    const invoice = makeInvoice({
      compliance: {
        tds: { netPayableMinor: 90909 }
      }
    });
    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) });

    const candidates = await service.findMatchCandidates("t1", { debitMinor: 91818, description: "Payment", date: "2026-01-15" }, 1);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].invoiceId).toBe("inv-1");
    expect(candidates[0].netPayableMinor).toBeGreaterThan(90909);
  });

  it("manual match sets confidence 100 and status manual", async () => {
    (BankTransactionModel.updateOne as jest.Mock).mockResolvedValue({});
    (InvoiceModel.updateOne as jest.Mock).mockResolvedValue({});

    await service.manualMatch("t1", "txn-1", "inv-1");

    expect(BankTransactionModel.updateOne).toHaveBeenCalledWith(
      { _id: "txn-1" },
      expect.objectContaining({ $set: expect.objectContaining({ matchConfidence: 100 }) })
    );
    expect(BankTransactionModel.updateOne).toHaveBeenCalledWith(
      { _id: "txn-1" },
      { $set: { matchStatus: "manual" } }
    );
  });

  it("unmatch clears both transaction and invoice", async () => {
    const txn = makeTxn({ matchedInvoiceId: "inv-1" });
    (BankTransactionModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(txn) });
    (BankTransactionModel.updateOne as jest.Mock).mockResolvedValue({});
    (InvoiceModel.updateOne as jest.Mock).mockResolvedValue({});

    await service.unmatch("t1", "txn-1");

    expect(BankTransactionModel.updateOne).toHaveBeenCalledWith(
      { _id: "txn-1" },
      { $set: { matchedInvoiceId: null, matchConfidence: null, matchStatus: "unmatched" } }
    );
    expect(InvoiceModel.updateOne).toHaveBeenCalledWith(
      { _id: "inv-1", tenantId: "t1" },
      expect.objectContaining({ $unset: { "compliance.reconciliation": 1 } })
    );
  });

  it("adds BANK_PAYMENT_VERIFIED risk signal on match", async () => {
    (BankTransactionModel.updateOne as jest.Mock).mockResolvedValue({});
    (InvoiceModel.updateOne as jest.Mock).mockResolvedValue({});

    await service.applyMatch("t1", "txn-1", "inv-1", 85);

    const invoiceUpdateCall = (InvoiceModel.updateOne as jest.Mock).mock.calls[0];
    const updateDoc = invoiceUpdateCall[1] as Record<string, unknown>;
    const push = updateDoc.$push as Record<string, unknown>;

    expect(push["compliance.riskSignals"]).toMatchObject({
      code: "BANK_PAYMENT_VERIFIED",
      category: "financial",
      severity: "info",
      confidencePenalty: 0,
      status: "open"
    });
  });

  it("passes amount range pre-filter in MongoDB query", async () => {
    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Payment", date: "2026-01-15" }, 0);

    const findCall = (InvoiceModel.find as jest.Mock).mock.calls[0];
    const query = findCall[0] as Record<string, unknown>;
    const amountFilter = query["parsed.totalAmountMinor"] as { $gte: number; $lte: number };

    expect(amountFilter).toBeDefined();
    expect(amountFilter.$gte).toBeLessThan(100000);
    expect(amountFilter.$lte).toBeGreaterThan(100000);
  });

  it("amount pre-filter range widens with TCS rate", async () => {
    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Payment", date: "2026-01-15" }, 10);

    const findCall = (InvoiceModel.find as jest.Mock).mock.calls[0];
    const query = findCall[0] as Record<string, unknown>;
    const amountFilter = query["parsed.totalAmountMinor"] as { $gte: number; $lte: number };

    expect(amountFilter.$gte).toBeLessThan(91000);
    expect(amountFilter.$lte).toBeGreaterThan(109000);
  });

  it("word-overlap vendor scoring gives +20 when a full word matches description", async () => {
    const invoice = makeInvoice({
      parsed: { invoiceNumber: "INV-OVERLAP", vendorName: "Acme Corporation", totalAmountMinor: 100000 }
    });
    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) });

    const withOverlap = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Payment Acme Corporation ref", date: "2026-01-15" });

    (InvoiceModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) });

    const withoutOverlap = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Wire transfer xyz", date: "2026-01-15" });

    expect(withOverlap[0].score).toBeGreaterThan(withoutOverlap[0].score);
  });

  it("reconcileStatement writes suggestedCount to the statement and returns it", async () => {
    const txn1 = makeTxn({ _id: "txn-high", description: "INV-001 payment Acme Corp" });
    const txn2 = makeTxn({ _id: "txn-mid", debitMinor: 100000, description: "Wire transfer unknown" });
    (BankTransactionModel.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([txn1, txn2]) });

    (BankStatementModel.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: "stmt-1", gstin: null }) });
    (BankStatementModel.updateOne as jest.Mock).mockResolvedValue({});
    (BankTransactionModel.updateOne as jest.Mock).mockResolvedValue({});
    (InvoiceModel.updateOne as jest.Mock).mockResolvedValue({});

    const highScoreInvoice = makeInvoice({ _id: "inv-high", parsed: { invoiceNumber: "INV-001", vendorName: "Acme Corp", totalAmountMinor: 100000 } });
    const midScoreInvoice = makeInvoice({ _id: "inv-mid", parsed: { invoiceNumber: "INV-ZZZ", vendorName: "Unknown XYZ", totalAmountMinor: 100000 } });

    (InvoiceModel.find as jest.Mock)
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([highScoreInvoice]) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([midScoreInvoice]) });

    const result = await service.reconcileStatement("t1", "stmt-1");

    expect(result).toHaveProperty("suggested");
    expect(typeof result.suggested).toBe("number");

    const updateCall = (BankStatementModel.updateOne as jest.Mock).mock.calls[0];
    const setDoc = (updateCall[1] as Record<string, unknown>).$set as Record<string, unknown>;
    expect(setDoc).toHaveProperty("suggestedCount");
  });
});
