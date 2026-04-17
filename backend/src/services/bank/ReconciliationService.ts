import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { BankTransactionModel, BANK_TRANSACTION_MATCH_STATUS, type BankTransaction } from "@/models/bank/BankTransaction.js";
import { TenantTcsConfigModel } from "@/models/integration/TenantTcsConfig.js";
import { logger } from "@/utils/logger.js";
import { isRecord } from "@/utils/validation.js";
import { type UUID, toUUID } from "@/types/uuid.js";
import { resolveTenantComplianceConfig } from "@/services/compliance/tenantConfigResolver.js";
import { createRiskSignal } from "@/services/compliance/riskSignalFactory.js";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals.js";

const DEFAULT_AUTO_MATCH_THRESHOLD = 50;
const DEFAULT_SUGGEST_THRESHOLD = 30;
const DEFAULT_AMOUNT_TOLERANCE_MINOR = 100;

interface ReconciliationWeights {
  exactAmount: number;
  closeAmount: number;
  invoiceNumber: number;
  vendorName: number;
  dateProximity: number;
}

const DEFAULT_WEIGHTS: ReconciliationWeights = {
  exactAmount: 50,
  closeAmount: 10,
  invoiceNumber: 30,
  vendorName: 20,
  dateProximity: 10
};

interface MatchCandidate {
  invoiceId: UUID;
  invoiceNumber: string;
  vendorName: string;
  netPayableMinor: number;
  score: number;
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  let matches = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) matches++;
  }
  return matches;
}

function prefixMatch(candidate: string, reference: string): boolean {
  const candidateLower = candidate.toLowerCase().trim();
  const referenceLower = reference.toLowerCase().trim();
  if (candidateLower.length < 3 || referenceLower.length < 3) return false;
  return referenceLower.startsWith(candidateLower) || candidateLower.startsWith(referenceLower);
}

function sequentialCharMatch(candidate: string, reference: string): boolean {
  const candidateLower = candidate.toLowerCase().replace(/\s+/g, "");
  const referenceLower = reference.toLowerCase().replace(/\s+/g, "");
  if (candidateLower.length < 3 || referenceLower.length < 3) return false;
  const shorter = candidateLower.length <= referenceLower.length ? candidateLower : referenceLower;
  const longer = candidateLower.length <= referenceLower.length ? referenceLower : candidateLower;
  let matchCount = 0;
  let longerIdx = 0;
  for (const ch of shorter) {
    while (longerIdx < longer.length) {
      if (longer[longerIdx] === ch) {
        matchCount++;
        longerIdx++;
        break;
      }
      longerIdx++;
    }
  }
  return matchCount / shorter.length >= 0.8;
}

export function scoreAmountMatch(debitMinor: number, netPayable: number, tolerance: number, weights: ReconciliationWeights): number {
  if (Math.abs(netPayable - debitMinor) > tolerance) return -1;
  if (Math.abs(netPayable - debitMinor) <= 1) return weights.exactAmount;
  return weights.closeAmount;
}

export function scoreInvoiceNumberMatch(description: string, invoiceNumber: string, weight: number): number {
  if (!invoiceNumber) return 0;
  if (description.toLowerCase().includes(invoiceNumber.toLowerCase())) return weight;
  return 0;
}

export function scoreVendorNameMatch(description: string, vendorName: string, weight: number): number {
  if (!vendorName) return 0;
  if (wordOverlap(vendorName, description) >= 1) return weight;
  if (prefixMatch(vendorName, description)) return weight;
  if (sequentialCharMatch(vendorName, description)) return Math.round(weight * 0.75);
  return 0;
}

export function scoreDateProximity(
  txnDate: Date,
  invoiceDate: Date | null,
  approvalDate: Date | null,
  dueDate: Date | null,
  weight: number
): number {
  if (isNaN(txnDate.getTime())) return 0;
  let bestScore = 0;
  for (const refDate of [approvalDate, invoiceDate, dueDate]) {
    if (!refDate || isNaN(refDate.getTime())) continue;
    const daysDiff = Math.abs((txnDate.getTime() - refDate.getTime()) / 86400000);
    if (daysDiff <= 3) bestScore = Math.max(bestScore, weight);
    else if (daysDiff <= 7) bestScore = Math.max(bestScore, Math.round(weight * 0.5));
    else if (daysDiff <= 30) bestScore = Math.max(bestScore, Math.round(weight * 0.2));
  }
  return bestScore;
}

export class ReconciliationService {
  async reconcileStatement(tenantId: UUID, statementId: string): Promise<{ matched: number; suggested: number; unmatched: number }> {
    const transactions = await BankTransactionModel.find({
      tenantId,
      statementId,
      matchStatus: BANK_TRANSACTION_MATCH_STATUS.UNMATCHED,
      debitMinor: { $gt: 0 }
    }).lean();

    const { BankStatementModel } = await import("@/models/bank/BankStatement.js");
    const statement = await BankStatementModel.findOne({ _id: statementId, tenantId }).lean();
    const statementGstin = statement?.gstin ?? undefined;

    const tcsConfig = await TenantTcsConfigModel.findOne({ tenantId }).lean();
    const tcsRatePercent = tcsConfig?.enabled ? (tcsConfig.ratePercent ?? 0) : 0;

    const tenantConfig = await resolveTenantComplianceConfig(tenantId);
    const autoMatchThreshold = tenantConfig?.reconciliationAutoMatchThreshold ?? DEFAULT_AUTO_MATCH_THRESHOLD;
    const suggestThreshold = tenantConfig?.reconciliationSuggestThreshold ?? DEFAULT_SUGGEST_THRESHOLD;
    const tolerance = tenantConfig?.reconciliationAmountToleranceMinor ?? DEFAULT_AMOUNT_TOLERANCE_MINOR;
    const weights = resolveWeights(tenantConfig);

    let matched = 0;
    let suggested = 0;
    let unmatched = 0;

    const allCandidateInvoices = await this.batchFetchCandidateInvoices(tenantId, transactions, tcsRatePercent, statementGstin, tolerance);

    for (const txn of transactions) {
      const candidates = this.scoreMatchCandidates(txn, allCandidateInvoices, tcsRatePercent, tolerance, weights);

      if (candidates.length === 0) {
        unmatched++;
        continue;
      }

      const best = candidates[0];
      if (best.score > autoMatchThreshold) {
        await this.applyMatch(tenantId, String(txn._id), best.invoiceId, best.score);
        matched++;
      } else if (best.score >= suggestThreshold) {
        await BankTransactionModel.updateOne(
          { _id: txn._id },
          { $set: { matchedInvoiceId: best.invoiceId, matchConfidence: best.score, matchStatus: BANK_TRANSACTION_MATCH_STATUS.SUGGESTED } }
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

  private async batchFetchCandidateInvoices(
    tenantId: UUID,
    transactions: Pick<BankTransaction, "debitMinor" | "description" | "date">[],
    tcsRatePercent: number,
    gstin?: string,
    tolerance: number = DEFAULT_AMOUNT_TOLERANCE_MINOR
  ): Promise<Record<string, unknown>[]> {
    const validTxns = transactions.filter(t => t.debitMinor && t.debitMinor > 0);
    if (validTxns.length === 0) return [];

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
      status: { $nin: [INVOICE_STATUS.EXPORTED] },
      "parsed.totalAmountMinor": { $gte: globalMin, $lte: globalMax }
    };

    if (gstin) {
      invoiceQuery["parsed.gst.gstin"] = gstin;
    }

    return InvoiceModel.find(invoiceQuery).lean();
  }

  private scoreMatchCandidates(
    txn: Pick<BankTransaction, "debitMinor" | "description" | "date">,
    invoices: Record<string, unknown>[],
    tcsRatePercent: number,
    tolerance: number = DEFAULT_AMOUNT_TOLERANCE_MINOR,
    weights: ReconciliationWeights = DEFAULT_WEIGHTS
  ): MatchCandidate[] {
    if (!txn.debitMinor || txn.debitMinor <= 0) return [];

    const candidates: MatchCandidate[] = [];
    const txnDate = txn.date instanceof Date ? txn.date : new Date(txn.date);

    for (const inv of invoices) {
      const parsed = (inv as Record<string, unknown>).parsed as Record<string, unknown> | undefined;
      const invObj = inv as unknown as Record<string, unknown>;
      const compliance = isRecord(invObj.compliance) ? invObj.compliance : undefined;
      const tds = isRecord(compliance?.tds) ? compliance.tds : undefined;
      const baseNetPayable = (tds?.netPayableMinor as number) ?? (parsed?.totalAmountMinor as number) ?? 0;
      const tcsAdjustment = tcsRatePercent > 0 ? Math.round(baseNetPayable * tcsRatePercent / 100) : 0;
      const netPayable = baseNetPayable + tcsAdjustment;

      const amountScore = scoreAmountMatch(txn.debitMinor, netPayable, tolerance, weights);
      if (amountScore < 0) continue;

      const invoiceNumber = (parsed?.invoiceNumber as string) ?? "";
      const vendorName = (parsed?.vendorName as string) ?? "";
      const invoiceDate = parsed?.invoiceDate instanceof Date ? parsed.invoiceDate : null;
      const dueDate = parsed?.dueDate instanceof Date ? parsed.dueDate : null;
      const approval = isRecord(invObj.approval) ? invObj.approval : undefined;
      const approvedAt = approval?.approvedAt instanceof Date ? approval.approvedAt : null;

      const score =
        amountScore +
        scoreInvoiceNumberMatch(txn.description, invoiceNumber, weights.invoiceNumber) +
        scoreVendorNameMatch(txn.description, vendorName, weights.vendorName) +
        scoreDateProximity(txnDate, invoiceDate, approvedAt, dueDate, weights.dateProximity);

      candidates.push({
        invoiceId: toUUID(String((inv as Record<string, unknown>)._id)),
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
    tenantId: UUID,
    txn: Pick<BankTransaction, "debitMinor" | "description" | "date">,
    tcsRatePercent: number = 0,
    gstin?: string
  ): Promise<MatchCandidate[]> {
    const tenantConfig = await resolveTenantComplianceConfig(tenantId);
    const tolerance = tenantConfig?.reconciliationAmountToleranceMinor ?? DEFAULT_AMOUNT_TOLERANCE_MINOR;
    const weights = resolveWeights(tenantConfig);
    const invoices = await this.batchFetchCandidateInvoices(tenantId, [txn], tcsRatePercent, gstin, tolerance);
    return this.scoreMatchCandidates(txn, invoices, tcsRatePercent, tolerance, weights);
  }

  async applyMatch(tenantId: UUID, transactionId: string, invoiceId: string, confidence: number): Promise<void> {
    await BankTransactionModel.updateOne(
      { _id: transactionId },
      { $set: { matchedInvoiceId: invoiceId, matchConfidence: confidence, matchStatus: BANK_TRANSACTION_MATCH_STATUS.MATCHED } }
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
          "compliance.riskSignals": createRiskSignal(
            RISK_SIGNAL_CODE.BANK_PAYMENT_VERIFIED,
            "financial",
            "info",
            `Payment verified against bank statement transaction (confidence: ${confidence})`,
            0
          )
        }
      }
    );
  }

  async manualMatch(tenantId: UUID, transactionId: string, invoiceId: string): Promise<void> {
    await this.applyMatch(tenantId, transactionId, invoiceId, 100);
    await BankTransactionModel.updateOne(
      { _id: transactionId },
      { $set: { matchStatus: BANK_TRANSACTION_MATCH_STATUS.MANUAL } }
    );
  }

  async unmatch(tenantId: UUID, transactionId: string): Promise<void> {
    const txn = await BankTransactionModel.findOne({ _id: transactionId, tenantId }).lean();
    if (!txn) return;

    const invoiceId = txn.matchedInvoiceId;

    await BankTransactionModel.updateOne(
      { _id: transactionId },
      { $set: { matchedInvoiceId: null, matchConfidence: null, matchStatus: BANK_TRANSACTION_MATCH_STATUS.UNMATCHED } }
    );

    if (invoiceId) {
      await InvoiceModel.updateOne(
        { _id: invoiceId, tenantId },
        {
          $unset: { "compliance.reconciliation": 1 },
          $pull: { "compliance.riskSignals": { code: RISK_SIGNAL_CODE.BANK_PAYMENT_VERIFIED } } as unknown as Record<string, unknown>
        }
      );
    }
  }
}

function resolveWeights(
  config: { reconciliationWeightExactAmount?: number; reconciliationWeightCloseAmount?: number; reconciliationWeightInvoiceNumber?: number; reconciliationWeightVendorName?: number; reconciliationWeightDateProximity?: number } | null
): ReconciliationWeights {
  return {
    exactAmount: config?.reconciliationWeightExactAmount ?? DEFAULT_WEIGHTS.exactAmount,
    closeAmount: config?.reconciliationWeightCloseAmount ?? DEFAULT_WEIGHTS.closeAmount,
    invoiceNumber: config?.reconciliationWeightInvoiceNumber ?? DEFAULT_WEIGHTS.invoiceNumber,
    vendorName: config?.reconciliationWeightVendorName ?? DEFAULT_WEIGHTS.vendorName,
    dateProximity: config?.reconciliationWeightDateProximity ?? DEFAULT_WEIGHTS.dateProximity
  };
}
