import mongoose from "mongoose";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import {
  ACTION_REASON,
  ACTION_REASON_SEVERITY,
  classifyActionReason,
  computeActionSeverityFields,
  emptyReasonCounts,
  type ActionReason,
  type ClassifierInput
} from "@/services/invoice/actionClassifier.js";
import type { ActionRequiredCursor } from "@/services/invoice/actionRequiredCursor.js";

export {
  ACTION_REASON,
  ACTION_REASON_SEVERITY,
  classifyActionReason,
  computeActionSeverityFields,
  emptyReasonCounts
};
export type { ActionReason, ClassifierInput };

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

interface QueryParams {
  tenantId: string;
  limit: number;
  cursor: ActionRequiredCursor | null;
}

function cursorMatch(cursor: ActionRequiredCursor) {
  const cursorDate = new Date(cursor.lastCreatedAt);
  const cursorObjectId = new mongoose.Types.ObjectId(cursor.lastInvoiceId);
  return {
    $or: [
      { actionSeverity: { $lt: cursor.lastSeverity } },
      {
        actionSeverity: cursor.lastSeverity,
        createdAt: { $lt: cursorDate }
      },
      {
        actionSeverity: cursor.lastSeverity,
        createdAt: cursorDate,
        _id: { $lt: cursorObjectId }
      }
    ]
  };
}

export async function fetchActionRequired(params: QueryParams): Promise<ActionRequiredQueryResult> {
  const { tenantId, limit, cursor } = params;

  const baseFilter: Record<string, unknown> = {
    tenantId,
    actionSeverity: { $type: "number" }
  };
  const itemsFilter: Record<string, unknown> = cursor
    ? { $and: [baseFilter, cursorMatch(cursor)] }
    : baseFilter;

  const [rawItems, rawCounts, totalCount] = await Promise.all([
    InvoiceModel.find(itemsFilter)
      .sort({ actionSeverity: -1, createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .select({
        _id: 1,
        actionReason: 1,
        actionSeverity: 1,
        createdAt: 1,
        "parsed.vendorName": 1,
        "parsed.totalAmountMinor": 1
      })
      .lean(),
    InvoiceModel.aggregate<{ _id: ActionReason; n: number }>([
      { $match: baseFilter },
      { $group: { _id: "$actionReason", n: { $sum: 1 } } }
    ]),
    InvoiceModel.countDocuments(baseFilter)
  ]);

  const totalByReason = emptyReasonCounts();
  for (const row of rawCounts) {
    if (row._id !== null) totalByReason[row._id] = row.n;
  }

  const hasMore = rawItems.length > limit;
  const sliced = hasMore ? rawItems.slice(0, limit) : rawItems;

  const items: ActionRequiredItem[] = sliced.map((row) => {
    const parsed = (row as { parsed?: { vendorName?: unknown; totalAmountMinor?: unknown } }).parsed ?? {};
    return {
      invoiceId: String((row as { _id: unknown })._id),
      reason: (row as { actionReason: ActionReason }).actionReason,
      severity: Number((row as { actionSeverity: number }).actionSeverity),
      vendorName: typeof parsed.vendorName === "string" ? parsed.vendorName : "",
      amountMinor: typeof parsed.totalAmountMinor === "number" ? parsed.totalAmountMinor : 0,
      createdAt: new Date((row as { createdAt: string | number | Date }).createdAt).toISOString()
    };
  });

  let nextCursor: ActionRequiredCursor | null = null;
  if (hasMore && sliced.length > 0) {
    const last = sliced[sliced.length - 1] as {
      _id: unknown;
      actionSeverity: number;
      createdAt: string | number | Date;
    };
    nextCursor = {
      lastSeverity: Number(last.actionSeverity),
      lastCreatedAt: new Date(last.createdAt).toISOString(),
      lastInvoiceId: String(last._id)
    };
  }

  return { items, nextCursor, totalByReason, total: totalCount };
}
