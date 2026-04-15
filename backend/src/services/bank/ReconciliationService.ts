import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { BankTransactionModel, type BankTransaction } from "@/models/bank/BankTransaction.js";
import { TenantTcsConfigModel } from "@/models/integration/TenantTcsConfig.js";
import { logger } from "@/utils/logger.js";
import { isRecord } from "@/utils/validation.js";

interface MatchCandidate {
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  netPayableMinor: number;
  score: number;
}

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  let matches = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) matches++;
  }
  return matches;
}

export class ReconciliationService {
  async reconcileStatement(tenantId: string, statementId: string): Promise<{ matched: number; suggested: number; unmatched: number }> {
    const transactions = await BankTransactionModel.find({
      tenantId,
      statementId,
      matchStatus: "unmatched",
      debitMinor: { $gt: 0 }
    }).lean();

    const { BankStatementModel } = await import("@/models/bank/BankStatement.js");
    const statement = await BankStatementModel.findOne({ _id: statementId, tenantId }).lean();
    const statementGstin = statement?.gstin ?? undefined;

    const tcsConfig = await TenantTcsConfigModel.findOne({ tenantId }).lean();
    const tcsRatePercent = tcsConfig?.enabled ? (tcsConfig.ratePercent ?? 0) : 0;

    let matched = 0;
    let suggested = 0;
    let unmatched = 0;

    // Batch-fetch all candidate invoices in a single query to avoid N+1
    const allCandidateInvoices = await this.batchFetchCandidateInvoices(tenantId, transactions, tcsRatePercent, statementGstin);

    for (const txn of transactions) {
      const candidates = this.scoreMatchCandidates(txn, allCandidateInvoices, tcsRatePercent);

      if (candidates.length === 0) {
        unmatched++;
        continue;
      }

      const best = candidates[0];
      if (best.score > 50) {
        await this.applyMatch(tenantId, String(txn._id), best.invoiceId, best.score);
        matched++;
      } else if (best.score >= 30) {
        await BankTransactionModel.updateOne(
          { _id: txn._id },
          { $set: { matchedInvoiceId: best.invoiceId, matchConfidence: best.score, matchStatus: "suggested" } }
        );
        suggested++;
      } else {
        unmatched++;
      }
    }

    await BankStatementModel.updateOne(
      { _id: statementId },
      { $set: { matchedCount: matched, suggestedCount: suggested, unmatchedCount: unmatched } }
    );

    logger.info("reconciliation.complete", { tenantId, statementId, matched, suggested, unmatched });
    return { matched, suggested, unmatched };
  }

  /**
   * Batch-fetch all candidate invoices for a set of transactions in a single DB query.
   * Computes the global min/max amount range across all transactions to avoid N+1 queries.
   */
  private async batchFetchCandidateInvoices(
    tenantId: string,
    transactions: Pick<BankTransaction, "debitMinor" | "description" | "date">[],
    tcsRatePercent: number,
    gstin?: string
  ): Promise<Record<string, unknown>[]> {
    const validTxns = transactions.filter(t => t.debitMinor && t.debitMinor > 0);
    if (validTxns.length === 0) return [];

    const tolerance = 100;
    const tcsMultiplier = 1 + tcsRatePercent / 100;

    let globalMin = Infinity;
    let globalMax = -Infinity;
    for (const txn of validTxns) {
      const min = Math.round(txn.debitMinor! / tcsMultiplier) - tolerance;
      const max = Math.round(txn.debitMinor! * tcsMultiplier) + tolerance;
      if (min < globalMin) globalMin = min;
      if (max > globalMax) globalMax = max;
    }

    const invoiceQuery: Record<string, unknown> = {
      tenantId,
      status: { $nin: ["EXPORTED"] },
      "parsed.totalAmountMinor": { $gte: globalMin, $lte: globalMax }
    };

    if (gstin) {
      invoiceQuery["parsed.gst.gstin"] = gstin;
    }

    return InvoiceModel.find(invoiceQuery).lean();
  }

  /**
   * Score pre-fetched candidate invoices against a single transaction in-memory.
   */
  private scoreMatchCandidates(
    txn: Pick<BankTransaction, "debitMinor" | "description" | "date">,
    invoices: Record<string, unknown>[],
    tcsRatePercent: number
  ): MatchCandidate[] {
    if (!txn.debitMinor || txn.debitMinor <= 0) return [];

    const tolerance = 100;
    const candidates: MatchCandidate[] = [];
    const descLower = txn.description.toLowerCase();
    const txnDate = txn.date instanceof Date ? txn.date : new Date(txn.date);

    for (const inv of invoices) {
      const parsed = (inv as Record<string, unknown>).parsed as Record<string, unknown> | undefined;
      let score = 0;
      const invObj = inv as unknown as Record<string, unknown>;
      const compliance = isRecord(invObj.compliance) ? invObj.compliance : undefined;
      const tds = isRecord(compliance?.tds) ? compliance.tds : undefined;
      const baseNetPayable = (tds?.netPayableMinor as number) ?? (parsed?.totalAmountMinor as number) ?? 0;
      const tcsAdjustment = tcsRatePercent > 0 ? Math.round(baseNetPayable * tcsRatePercent / 100) : 0;
      const netPayable = baseNetPayable + tcsAdjustment;

      if (Math.abs(netPayable - txn.debitMinor) > tolerance) continue;

      if (Math.abs(netPayable - txn.debitMinor) <= 1) {
        score += 50;
      } else {
        score += 30;
      }

      const invoiceNumber = (parsed?.invoiceNumber as string) ?? "";
      if (invoiceNumber && descLower.includes(invoiceNumber.toLowerCase())) {
        score += 30;
      }

      const vendorName = (parsed?.vendorName as string) ?? "";
      if (vendorName && wordOverlap(vendorName, descLower) >= 1) {
        score += 20;
      }

      const invoiceDate = parsed?.invoiceDate instanceof Date ? parsed.invoiceDate : null;
      const dueDate = parsed?.dueDate instanceof Date ? parsed.dueDate : null;
      const approval = isRecord(invObj.approval) ? invObj.approval : undefined;
      const approvedAt = approval?.approvedAt instanceof Date ? approval.approvedAt : null;

      if (!isNaN(txnDate.getTime())) {
        let bestDateScore = 0;
        for (const refDate of [approvedAt, invoiceDate, dueDate]) {
          if (!refDate || isNaN(refDate.getTime())) continue;
          const daysDiff = Math.abs((txnDate.getTime() - refDate.getTime()) / 86400000);
          if (daysDiff <= 3) bestDateScore = Math.max(bestDateScore, 10);
          else if (daysDiff <= 7) bestDateScore = Math.max(bestDateScore, 5);
          else if (daysDiff <= 30) bestDateScore = Math.max(bestDateScore, 2);
        }
        score += bestDateScore;
      }

      candidates.push({
        invoiceId: String((inv as Record<string, unknown>)._id),
        invoiceNumber,
        vendorName,
        netPayableMinor: netPayable,
        score
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  async findMatchCandidates(
    tenantId: string,
    txn: Pick<BankTransaction, "debitMinor" | "description" | "date">,
    tcsRatePercent: number = 0,
    gstin?: string
  ): Promise<MatchCandidate[]> {
    const invoices = await this.batchFetchCandidateInvoices(tenantId, [txn], tcsRatePercent, gstin);
    return this.scoreMatchCandidates(txn, invoices, tcsRatePercent);
  }

  async applyMatch(tenantId: string, transactionId: string, invoiceId: string, confidence: number): Promise<void> {
    await BankTransactionModel.updateOne(
      { _id: transactionId },
      { $set: { matchedInvoiceId: invoiceId, matchConfidence: confidence, matchStatus: "matched" } }
    );

    await InvoiceModel.updateOne(
      { _id: invoiceId, tenantId },
      {
        $set: {
          "compliance.reconciliation": {
            bankTransactionId: transactionId,
            verifiedByStatement: true,
            matchedAt: new Date()
          }
        },
        $push: {
          processingIssues: `Bank payment verified: matched to transaction ${transactionId} (confidence ${confidence})`,
          "compliance.riskSignals": {
            code: "BANK_PAYMENT_VERIFIED",
            category: "financial",
            severity: "info",
            message: `Payment verified against bank statement transaction (confidence: ${confidence})`,
            confidencePenalty: 0,
            status: "open"
          }
        }
      }
    );
  }

  async manualMatch(tenantId: string, transactionId: string, invoiceId: string): Promise<void> {
    await this.applyMatch(tenantId, transactionId, invoiceId, 100);
    await BankTransactionModel.updateOne(
      { _id: transactionId },
      { $set: { matchStatus: "manual" } }
    );
  }

  async unmatch(tenantId: string, transactionId: string): Promise<void> {
    const txn = await BankTransactionModel.findOne({ _id: transactionId, tenantId }).lean();
    if (!txn) return;

    const invoiceId = txn.matchedInvoiceId;

    await BankTransactionModel.updateOne(
      { _id: transactionId },
      { $set: { matchedInvoiceId: null, matchConfidence: null, matchStatus: "unmatched" } }
    );

    if (invoiceId) {
      await InvoiceModel.updateOne(
        { _id: invoiceId, tenantId },
        {
          $unset: { "compliance.reconciliation": 1 },
          $pull: { "compliance.riskSignals": { code: "BANK_PAYMENT_VERIFIED" } } as unknown as Record<string, unknown>
        }
      );
    }
  }
}
