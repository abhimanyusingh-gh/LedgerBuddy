import { ReconciliationService } from "./ReconciliationService.ts";
import { InvoiceModel } from "../../models/Invoice.ts";
import { BankTransactionModel } from "../../models/BankTransaction.ts";
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
    (InvoiceModel.find as jest.Mock).mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) }) });
    (BankTransactionModel.updateOne as jest.Mock).mockResolvedValue({});
    (InvoiceModel.updateOne as jest.Mock).mockResolvedValue({});

    const candidates = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Payment INV-001", date: "2026-01-15" });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].score).toBeGreaterThanOrEqual(50);
  });

  it("scores higher when invoice number appears in description", async () => {
    const invoice = makeInvoice({ parsed: { invoiceNumber: "INV-999", vendorName: "Acme", totalAmountMinor: 100000 } });
    (InvoiceModel.find as jest.Mock).mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) }) });

    const candidates = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Ref INV-999 payment", date: "2026-01-15" });

    expect(candidates[0].score).toBeGreaterThan(50);
  });

  it("marks as suggested when score is between thresholds", async () => {
    const invoice = makeInvoice({ parsed: { invoiceNumber: "INV-ZZZ", vendorName: "Unknown Vendor XYZ", totalAmountMinor: 100000 } });
    (InvoiceModel.find as jest.Mock).mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) }) });

    const candidates = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Wire transfer", date: "2026-02-28" });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].score).toBeGreaterThanOrEqual(30);
    expect(candidates[0].score).toBeLessThanOrEqual(50);
  });

  it("leaves unmatched when no candidates found", async () => {
    (InvoiceModel.find as jest.Mock).mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });

    const candidates = await service.findMatchCandidates("t1", { debitMinor: 100000, description: "Unknown", date: "2026-01-15" });

    expect(candidates).toHaveLength(0);
  });

  it("includes TCS rate adjustment in expected bank debit amount", async () => {
    const invoice = makeInvoice({
      compliance: {
        tds: { netPayableMinor: 90909 }
      }
    });
    (InvoiceModel.find as jest.Mock).mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([invoice]) }) });

    const candidates = await service.findMatchCandidates("t1", { debitMinor: 91818, description: "Payment", date: "2026-01-15" }, 1);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].netPayableMinor).toBe(91818);
  });

  it("manual match sets confidence 100 and status manual", async () => {
    (BankTransactionModel.updateOne as jest.Mock).mockResolvedValue({});
    (InvoiceModel.updateOne as jest.Mock).mockResolvedValue({});

    await service.manualMatch("t1", "txn-1", "inv-1");

    const txnUpdateCalls = (BankTransactionModel.updateOne as jest.Mock).mock.calls;
    const confidenceCall = txnUpdateCalls.find(
      (c: unknown[]) => (c[1] as Record<string, Record<string, unknown>>).$set?.matchConfidence === 100
    );
    const statusCall = txnUpdateCalls.find(
      (c: unknown[]) => (c[1] as Record<string, Record<string, unknown>>).$set?.matchStatus === "manual"
    );

    expect(confidenceCall).toBeDefined();
    expect(confidenceCall[0]).toEqual({ _id: "txn-1" });

    expect(statusCall).toBeDefined();
    expect(statusCall[0]).toEqual({ _id: "txn-1" });
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
});
