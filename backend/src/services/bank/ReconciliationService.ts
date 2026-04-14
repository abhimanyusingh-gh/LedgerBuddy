import { InvoiceModel } from "../../models/Invoice.js";
import { BankTransactionModel } from "../../models/BankTransaction.js";
import { TenantTcsConfigModel } from "../../models/TenantTcsConfig.js";
import { logger } from "../../utils/logger.js";

interface MatchCandidate {
  invoiceId: string;
  invoiceNumber: string;
  vendorName: string;
  netPayableMinor: number;
  score: number;
}

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export class ReconciliationService {
  async reconcileStatement(tenantId: string, statementId: string): Promise<{ matched: number; suggested: number; unmatched: number }> {
    const transactions = await BankTransactionModel.find({
      tenantId,
      statementId,
      matchStatus: "unmatched",
      debitMinor: { $gt: 0 }
    }).lean();

    const { BankStatementModel } = await import("../../models/BankStatement.js");
    const statement = await BankStatementModel.findOne({ _id: statementId, tenantId }).lean();
    const statementGstin = statement?.gstin ?? undefined;

    const tcsConfig = await TenantTcsConfigModel.findOne({ tenantId }).lean();
    const tcsRatePercent = tcsConfig?.enabled ? (tcsConfig.ratePercent ?? 0) : 0;

    let matched = 0;
    let suggested = 0;
    let unmatched = 0;

    for (const txn of transactions) {
      const candidates = await this.findMatchCandidates(tenantId, txn, tcsRatePercent, statementGstin);

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
      { $set: { matchedCount: matched, unmatchedCount: unmatched } }
    );

    logger.info("reconciliation.complete", { tenantId, statementId, matched, suggested, unmatched });
    return { matched, suggested, unmatched };
  }

  async findMatchCandidates(
    tenantId: string,
    txn: { debitMinor?: number | null; description: string; date: string },
    tcsRatePercent: number = 0,
    gstin?: string
  ): Promise<MatchCandidate[]> {
    if (!txn.debitMinor || txn.debitMinor <= 0) return [];

    const tolerance = 100;
    const invoiceQuery: Record<string, unknown> = {
      tenantId,
      status: { $nin: ["EXPORTED"] }
    };

    if (gstin) {
      invoiceQuery["parsed.gst.gstin"] = gstin;
    }

    const invoices = await InvoiceModel.find(invoiceQuery).lean();

    const candidates: MatchCandidate[] = [];
    const descLower = txn.description.toLowerCase();
    const txnDate = new Date(txn.date);

    for (const inv of invoices) {
      let score = 0;
      const compliance = (inv as unknown as Record<string, unknown>).compliance as Record<string, unknown> | undefined;
      const tds = compliance?.tds as Record<string, unknown> | undefined;
      const baseNetPayable = (tds?.netPayableMinor as number) ?? inv.parsed?.totalAmountMinor ?? 0;
      const tcsAdjustment = tcsRatePercent > 0 ? Math.round(baseNetPayable * tcsRatePercent / 100) : 0;
      const netPayable = baseNetPayable + tcsAdjustment;

      if (Math.abs(netPayable - txn.debitMinor) > tolerance) continue;

      if (Math.abs(netPayable - txn.debitMinor) <= 1) {
        score += 50;
      } else {
        score += 30;
      }

      const invoiceNumber = inv.parsed?.invoiceNumber ?? "";
      if (invoiceNumber && descLower.includes(invoiceNumber.toLowerCase())) {
        score += 30;
      }

      const vendorName = inv.parsed?.vendorName ?? "";
      if (vendorName && descLower.includes(vendorName.substring(0, 10).toLowerCase())) {
        score += 20;
      }

      const invoiceDate = inv.parsed?.invoiceDate ? new Date(inv.parsed.invoiceDate) : null;
      const dueDate = inv.parsed?.dueDate ? new Date(inv.parsed.dueDate) : null;
      const approval = (inv as unknown as Record<string, unknown>).approval as Record<string, unknown> | undefined;
      const approvedAt = approval?.approvedAt ? new Date(approval.approvedAt as string) : null;

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
        invoiceId: String(inv._id),
        invoiceNumber,
        vendorName,
        netPayableMinor: netPayable,
        score
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates;
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
