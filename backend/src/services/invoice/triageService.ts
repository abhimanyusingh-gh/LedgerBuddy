import { Types } from "mongoose";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import {
  INVOICE_STATUS,
  TRIAGE_REJECT_REASON,
  TriageRejectReasons,
  type ParsedInvoiceData,
  type TriageRejectReason
} from "@/types/invoice.js";
import { findClientOrgIdByIdForTenant } from "@/services/auth/tenantScope.js";
import { HttpError } from "@/errors/HttpError.js";

export interface TriageInvoiceDto {
  _id: string;
  tenantId: string;
  invoiceNumber: string | null;
  vendorName: string | null;
  vendorGstin: string | null;
  customerName: string | null;
  customerGstin: string | null;
  totalAmountMinor: number | null;
  currency: string | null;
  sourceMailbox: string | null;
  receivedAt: string;
  status: typeof INVOICE_STATUS.PENDING_TRIAGE;
}

export interface TriageListResult {
  items: TriageInvoiceDto[];
  total: number;
}

const SOURCE_TYPE_EMAIL = "email";

/**
 * Triage list projection: a nullable view of the fields we surface from
 * `Invoice.parsed`. Aligned with `ParsedInvoiceData` but each field is
 * widened to `T | null` because the persisted lean shape may carry
 * explicit nulls for unset values.
 */
type Nullable<T> = { [K in keyof T]?: T[K] | null };
type ParsedInvoiceProjection = Nullable<
  Pick<
    ParsedInvoiceData,
    | "invoiceNumber"
    | "vendorName"
    | "vendorGstin"
    | "customerName"
    | "customerGstin"
    | "totalAmountMinor"
    | "currency"
  >
>;

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isTriageRejectReason(value: unknown): value is TriageRejectReason {
  return typeof value === "string" && (TriageRejectReasons as readonly string[]).includes(value);
}

function toObjectId(value: string, errorCode: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new HttpError("Invalid invoice id.", 404, errorCode);
  }
  return new Types.ObjectId(value);
}

export class TriageService {
  /**
   * triage list: documented composite-key exception, see #156 — tenant-scoped only.
   * The returned rows have `clientOrgId: null` by definition (the polled-ingestion
   * triage state in which mailbox routing couldn't decide a realm). Filtering
   * by `tenantId` alone is the documented exception to the otherwise-strict
   * `{tenantId, clientOrgId}` composite-key access boundary.
   */
  async list(tenantId: string): Promise<TriageListResult> {
    const filter = { tenantId, status: INVOICE_STATUS.PENDING_TRIAGE } as const;
    const [docs, total] = await Promise.all([
      InvoiceModel.find(filter).sort({ createdAt: 1 }).lean(),
      InvoiceModel.countDocuments(filter)
    ]);
    const items: TriageInvoiceDto[] = docs.map((doc) => {
      const parsed: ParsedInvoiceProjection = (doc.parsed ?? {}) as ParsedInvoiceProjection;
      const sourceMailbox =
        doc.sourceType === SOURCE_TYPE_EMAIL ? nullableString(doc.sourceKey) : null;
      return {
        _id: String(doc._id),
        tenantId: doc.tenantId,
        invoiceNumber: nullableString(parsed.invoiceNumber),
        vendorName: nullableString(parsed.vendorName),
        vendorGstin: nullableString(parsed.vendorGstin),
        customerName: nullableString(parsed.customerName),
        customerGstin: nullableString(parsed.customerGstin),
        totalAmountMinor: nullableNumber(parsed.totalAmountMinor),
        currency: nullableString(parsed.currency),
        sourceMailbox,
        receivedAt: doc.receivedAt instanceof Date
          ? doc.receivedAt.toISOString()
          : new Date(doc.receivedAt as unknown as string).toISOString(),
        status: INVOICE_STATUS.PENDING_TRIAGE
      };
    });
    return { items, total };
  }

  async assignClientOrg(input: {
    tenantId: string;
    invoiceId: string;
    clientOrgId: string;
  }): Promise<void> {
    if (
      typeof input.clientOrgId !== "string" ||
      input.clientOrgId.length === 0 ||
      !Types.ObjectId.isValid(input.clientOrgId)
    ) {
      throw new HttpError(
        "clientOrgId is required and must be a valid ObjectId.",
        400,
        "assign_client_org_invalid"
      );
    }
    const invoiceOid = toObjectId(input.invoiceId, "triage_invoice_not_found");
    const invoice = await InvoiceModel.findOne({
      _id: invoiceOid,
      tenantId: input.tenantId
    });
    if (!invoice) {
      throw new HttpError("Invoice not found.", 404, "triage_invoice_not_found");
    }
    if (invoice.status !== INVOICE_STATUS.PENDING_TRIAGE) {
      throw new HttpError(
        "Invoice is not in PENDING_TRIAGE status.",
        409,
        "triage_invoice_wrong_status"
      );
    }
    const ownedOid = await findClientOrgIdByIdForTenant(input.clientOrgId, input.tenantId);
    if (!ownedOid) {
      throw new HttpError(
        "ClientOrganization does not belong to this tenant.",
        400,
        "assign_client_org_invalid"
      );
    }
    invoice.clientOrgId = ownedOid;
    invoice.status = INVOICE_STATUS.PARSED;
    await invoice.save();
  }

  async reject(input: {
    tenantId: string;
    invoiceId: string;
    reasonCode: unknown;
    notes?: unknown;
  }): Promise<void> {
    const invoiceOid = toObjectId(input.invoiceId, "triage_invoice_not_found");
    if (!isTriageRejectReason(input.reasonCode)) {
      throw new HttpError(
        "Invalid rejection reason.",
        400,
        "triage_reject_reason_invalid"
      );
    }
    const trimmedNotes =
      typeof input.notes === "string" && input.notes.trim().length > 0
        ? input.notes.trim()
        : undefined;
    if (input.reasonCode === TRIAGE_REJECT_REASON.OTHER && !trimmedNotes) {
      throw new HttpError(
        "Notes are required when rejecting with reason 'other'.",
        400,
        "triage_reject_notes_required"
      );
    }
    const invoice = await InvoiceModel.findOne({
      _id: invoiceOid,
      tenantId: input.tenantId
    });
    if (!invoice) {
      throw new HttpError("Invoice not found.", 404, "triage_invoice_not_found");
    }
    if (invoice.status !== INVOICE_STATUS.PENDING_TRIAGE) {
      throw new HttpError(
        "Invoice is not in PENDING_TRIAGE status.",
        409,
        "triage_invoice_wrong_status"
      );
    }
    invoice.status = INVOICE_STATUS.REJECTED;
    invoice.rejectReason = trimmedNotes
      ? { code: input.reasonCode, notes: trimmedNotes }
      : { code: input.reasonCode };
    await invoice.save();
  }
}
