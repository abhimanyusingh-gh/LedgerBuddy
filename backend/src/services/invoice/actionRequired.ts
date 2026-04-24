import mongoose, { type PipelineStage } from "mongoose";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import {
  INVOICE_STATUS,
  RISK_SIGNAL_SEVERITY,
  RISK_SIGNAL_STATUS,
  type InvoiceStatus,
  type RiskSignalSeverity,
  type RiskSignalStatus
} from "@/types/invoice.js";
import type { ActionRequiredCursor } from "@/services/invoice/actionRequiredCursor.js";

export const ACTION_REASON = {
  MissingGstin: "MissingGstin",
  FailedOcr: "FailedOcr",
  NeedsReview: "NeedsReview",
  AwaitingApproval: "AwaitingApproval",
  ExportFailed: "ExportFailed",
  CriticalRisk: "CriticalRisk"
} as const;

export type ActionReason = (typeof ACTION_REASON)[keyof typeof ACTION_REASON];

export const ACTION_REASON_SEVERITY: Record<ActionReason, number> = {
  [ACTION_REASON.FailedOcr]: 100,
  [ACTION_REASON.CriticalRisk]: 90,
  [ACTION_REASON.ExportFailed]: 80,
  [ACTION_REASON.MissingGstin]: 70,
  [ACTION_REASON.NeedsReview]: 50,
  [ACTION_REASON.AwaitingApproval]: 30
};

export const ACTION_REQUIRED_DEFAULT_LIMIT = 50;
export const ACTION_REQUIRED_MAX_LIMIT = 200;

interface ActionRequiredItem {
  invoiceId: string;
  reason: ActionReason;
  severity: number;
  vendorName: string;
  amountMinor: number;
  createdAt: string;
}

interface ActionRequiredQueryResult {
  items: ActionRequiredItem[];
  nextCursor: ActionRequiredCursor | null;
  totalByReason: Record<ActionReason, number>;
  total: number;
}

interface ClassifierInput {
  status: InvoiceStatus | string;
  parsed?: {
    currency?: string | null;
    customerGstin?: string | null;
  } | null;
  export?: { error?: string | null } | null;
  compliance?: {
    riskSignals?: Array<{
      severity: RiskSignalSeverity | string;
      status: RiskSignalStatus | string;
    }> | null;
  } | null;
}

export function classifyActionReason(invoice: ClassifierInput): ActionReason | null {
  if (invoice.status === INVOICE_STATUS.FAILED_OCR || invoice.status === INVOICE_STATUS.FAILED_PARSE) {
    return ACTION_REASON.FailedOcr;
  }
  if (typeof invoice.export?.error === "string" && invoice.export.error.length > 0) {
    return ACTION_REASON.ExportFailed;
  }
  const openCritical = (invoice.compliance?.riskSignals ?? []).some(
    (s) => s.status === RISK_SIGNAL_STATUS.OPEN && s.severity === RISK_SIGNAL_SEVERITY.CRITICAL
  );
  if (openCritical) {
    return ACTION_REASON.CriticalRisk;
  }
  const currency = invoice.parsed?.currency ?? "INR";
  const customerGstin = (invoice.parsed?.customerGstin ?? "").trim();
  if (currency === "INR" && customerGstin === "" && invoice.status !== INVOICE_STATUS.PENDING) {
    return ACTION_REASON.MissingGstin;
  }
  if (invoice.status === INVOICE_STATUS.NEEDS_REVIEW) {
    return ACTION_REASON.NeedsReview;
  }
  if (invoice.status === INVOICE_STATUS.AWAITING_APPROVAL) {
    return ACTION_REASON.AwaitingApproval;
  }
  return null;
}

export function emptyReasonCounts(): Record<ActionReason, number> {
  return {
    [ACTION_REASON.FailedOcr]: 0,
    [ACTION_REASON.CriticalRisk]: 0,
    [ACTION_REASON.ExportFailed]: 0,
    [ACTION_REASON.MissingGstin]: 0,
    [ACTION_REASON.NeedsReview]: 0,
    [ACTION_REASON.AwaitingApproval]: 0
  };
}

const ACTIONABLE_STATUSES: InvoiceStatus[] = [
  INVOICE_STATUS.FAILED_OCR,
  INVOICE_STATUS.FAILED_PARSE,
  INVOICE_STATUS.NEEDS_REVIEW,
  INVOICE_STATUS.AWAITING_APPROVAL,
  INVOICE_STATUS.PARSED,
  INVOICE_STATUS.APPROVED,
  INVOICE_STATUS.EXPORTED
];

function classifierStageExpression() {
  return {
    $switch: {
      branches: [
        {
          case: { $in: ["$status", [INVOICE_STATUS.FAILED_OCR, INVOICE_STATUS.FAILED_PARSE]] },
          then: ACTION_REASON.FailedOcr
        },
        {
          case: { $gt: [{ $strLenCP: { $ifNull: ["$export.error", ""] } }, 0] },
          then: ACTION_REASON.ExportFailed
        },
        {
          case: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$compliance.riskSignals", []] },
                    as: "s",
                    cond: {
                      $and: [
                        { $eq: ["$$s.status", RISK_SIGNAL_STATUS.OPEN] },
                        { $eq: ["$$s.severity", RISK_SIGNAL_SEVERITY.CRITICAL] }
                      ]
                    }
                  }
                }
              },
              0
            ]
          },
          then: ACTION_REASON.CriticalRisk
        },
        {
          case: {
            $and: [
              { $eq: [{ $ifNull: ["$parsed.currency", "INR"] }, "INR"] },
              { $eq: [{ $strLenCP: { $trim: { input: { $ifNull: ["$parsed.customerGstin", ""] } } } }, 0] },
              { $ne: ["$status", INVOICE_STATUS.PENDING] }
            ]
          },
          then: ACTION_REASON.MissingGstin
        },
        {
          case: { $eq: ["$status", INVOICE_STATUS.NEEDS_REVIEW] },
          then: ACTION_REASON.NeedsReview
        },
        {
          case: { $eq: ["$status", INVOICE_STATUS.AWAITING_APPROVAL] },
          then: ACTION_REASON.AwaitingApproval
        }
      ],
      default: null
    }
  };
}

function severityStageExpression() {
  return {
    $switch: {
      branches: (Object.keys(ACTION_REASON_SEVERITY) as ActionReason[]).map((reason) => ({
        case: { $eq: ["$reason", reason] },
        then: ACTION_REASON_SEVERITY[reason]
      })),
      default: 0
    }
  };
}

function cursorMatch(cursor: ActionRequiredCursor) {
  const cursorDate = new Date(cursor.lastCreatedAt);
  const cursorObjectId = new mongoose.Types.ObjectId(cursor.lastInvoiceId);
  return {
    $or: [
      { severity: { $lt: cursor.lastSeverity } },
      {
        severity: cursor.lastSeverity,
        createdAt: { $lt: cursorDate }
      },
      {
        severity: cursor.lastSeverity,
        createdAt: cursorDate,
        _id: { $lt: cursorObjectId }
      }
    ]
  };
}

interface QueryParams {
  tenantId: string;
  limit: number;
  cursor: ActionRequiredCursor | null;
}

export async function fetchActionRequired(params: QueryParams): Promise<ActionRequiredQueryResult> {
  const { tenantId, limit, cursor } = params;

  const itemsBranch: PipelineStage.FacetPipelineStage[] = [];
  if (cursor) {
    itemsBranch.push({ $match: cursorMatch(cursor) });
  }
  itemsBranch.push({ $sort: { severity: -1, createdAt: -1, _id: -1 } });
  itemsBranch.push({ $limit: limit + 1 });
  itemsBranch.push({
    $project: {
      _id: 1,
      reason: 1,
      severity: 1,
      createdAt: 1,
      vendorName: { $ifNull: ["$parsed.vendorName", ""] },
      amountMinor: { $ifNull: ["$parsed.totalAmountMinor", 0] }
    }
  });

  const pipeline: PipelineStage[] = [
    { $match: { tenantId, status: { $in: ACTIONABLE_STATUSES } } },
    { $addFields: { reason: classifierStageExpression() } },
    { $match: { reason: { $ne: null } } },
    { $addFields: { severity: severityStageExpression() } },
    {
      $facet: {
        items: itemsBranch,
        totalByReason: [{ $group: { _id: "$reason", n: { $sum: 1 } } }],
        total: [{ $count: "n" }]
      }
    }
  ];

  const [facetResult] = await InvoiceModel.aggregate(pipeline);
  const rawItems = (facetResult?.items ?? []) as Array<Record<string, unknown>>;
  const rawCounts = (facetResult?.totalByReason ?? []) as Array<{ _id: ActionReason; n: number }>;
  const totalRow = (facetResult?.total ?? []) as Array<{ n: number }>;

  const totalByReason = emptyReasonCounts();
  for (const row of rawCounts) {
    totalByReason[row._id] = row.n;
  }
  const total = totalRow.length > 0 ? totalRow[0].n : 0;

  const hasMore = rawItems.length > limit;
  const sliced = hasMore ? rawItems.slice(0, limit) : rawItems;

  const items: ActionRequiredItem[] = sliced.map((row) => ({
    invoiceId: String(row._id),
    reason: row.reason as ActionReason,
    severity: Number(row.severity),
    vendorName: String(row.vendorName ?? ""),
    amountMinor: Number(row.amountMinor ?? 0),
    createdAt: new Date(row.createdAt as string | number | Date).toISOString()
  }));

  let nextCursor: ActionRequiredCursor | null = null;
  if (hasMore && sliced.length > 0) {
    const last = sliced[sliced.length - 1];
    nextCursor = {
      lastSeverity: Number(last.severity),
      lastCreatedAt: new Date(last.createdAt as string | number | Date).toISOString(),
      lastInvoiceId: String(last._id)
    };
  }

  return { items, nextCursor, totalByReason, total };
}
