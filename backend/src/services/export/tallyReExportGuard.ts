import { createHash } from "node:crypto";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { TALLY_ACTION, type TallyAction } from "@/services/export/tallyExporter/xml.js";
import { deriveVendorState } from "@/constants/gstinStateCodes.js";

interface VoucherGuidInputs {
  /**
   * Opaque client-org ObjectId string (#158). Rooted on `clientOrgId`
   * (not `tenantId`) so the voucher GUID remains stable across any
   * GSTIN re-registration on the `ClientOrganization` document.
   */
  clientOrgId: string;
  invoiceId: string;
  exportVersion: number;
}

export interface ReExportDecision {
  guid: string;
  action: TallyAction;
  priorExportVersion: number;
  nextExportVersion: number;
  buyerStateName: string | null;
}

export class F12OverwriteNotVerifiedError extends Error {
  readonly code = "TALLY_F12_OVERWRITE_NOT_VERIFIED";
  constructor(clientOrgId: string) {
    super(
      `Tally F12 "Overwrite voucher when voucher with same GUID exists" is not verified for client-org ${clientOrgId}. ` +
      "Re-export requires ACTION=\"Alter\"; complete the Tally onboarding F12 check before retrying."
    );
  }
}

/**
 * Thrown when `ClientOrganizationModel.findById(clientOrgId)` returns `null` during
 * re-export resolution. This is a data-integrity violation: the Invoice pre-save
 * invariant hook prevents creation of an Invoice with an unresolvable `clientOrgId`,
 * so hitting this path means a `ClientOrganization` was deleted out from under a
 * surviving Invoice (i.e. a delete that escaped FK checks). We surface it loudly
 * rather than silently no-op'ing PLACEOFSUPPLY emission so the orphan reference
 * gets repaired upstream.
 */
export class ClientOrganizationNotFoundError extends Error {
  readonly code = "TALLY_CLIENT_ORG_NOT_FOUND";
  constructor(readonly clientOrgId: string) {
    super(
      `ClientOrganization ${clientOrgId} not found during Tally re-export resolution. ` +
      "This indicates an orphaned invoice.clientOrgId reference (data-integrity violation); " +
      "verify the ClientOrganization row was not deleted out from under surviving invoices."
    );
  }
}

/**
 * Thrown by `buildVoucherInput` when neither the vendor's GSTIN nor address
 * yields a derivable party state via `deriveVendorState`. PLACEOFSUPPLY
 * emission requires a non-null party state to compute the same-state vs
 * cross-state decision; emitting an XML voucher without it produces an
 * invalid Tally import. Surface the failure at construction so the invoice
 * is marked failed with a clear diagnostic instead of silently shipping a
 * malformed document downstream.
 */
export class MissingVendorStateError extends Error {
  readonly code = "TALLY_MISSING_VENDOR_STATE";
  constructor(readonly invoiceId: string, readonly vendorName: string | null) {
    super(
      `Cannot derive party state for invoice ${invoiceId}` +
      (vendorName ? ` (vendor "${vendorName}")` : "") +
      ": neither vendor.gstin nor vendor.address resolves to a known Indian state. " +
      "PLACEOFSUPPLY cannot be emitted without a party state; correct the vendor GSTIN or address before re-exporting."
    );
  }
}

export const EXPORT_VERSION_CONFLICT_REASON = {
  VERSION_MISMATCH: "version-mismatch",
  IN_FLIGHT_MISMATCH: "in-flight-mismatch"
} as const;

type ExportVersionConflictReason =
  (typeof EXPORT_VERSION_CONFLICT_REASON)[keyof typeof EXPORT_VERSION_CONFLICT_REASON];

export class ExportVersionConflictError extends Error {
  readonly code = "TALLY_EXPORT_VERSION_CONFLICT";
  constructor(
    readonly invoiceId: string,
    readonly expectedPriorVersion: number,
    readonly reason: ExportVersionConflictReason = EXPORT_VERSION_CONFLICT_REASON.VERSION_MISMATCH
  ) {
    super(
      reason === EXPORT_VERSION_CONFLICT_REASON.IN_FLIGHT_MISMATCH
        ? `In-flight export conflict for invoice ${invoiceId}: another exporter is staging a different version. ` +
          "Retry once the prior attempt resolves."
        : `Export version CAS conflict for invoice ${invoiceId}: expected exportVersion=${expectedPriorVersion} ` +
          "but another exporter advanced it concurrently. Retry with the refreshed invoice state."
    );
  }
}

function lengthPrefix(value: string): string {
  return `${value.length}:${value}`;
}

export function computeVoucherGuid(inputs: VoucherGuidInputs): string {
  const payload = [
    lengthPrefix(inputs.clientOrgId),
    lengthPrefix(inputs.invoiceId),
    String(inputs.exportVersion)
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export async function resolveReExportDecision(params: {
  clientOrgId: string;
  invoiceId: string;
  currentExportVersion: number;
}): Promise<ReExportDecision> {
  const { clientOrgId, invoiceId, currentExportVersion } = params;
  const nextExportVersion = currentExportVersion + 1;
  const action: TallyAction = currentExportVersion === 0 ? TALLY_ACTION.CREATE : TALLY_ACTION.ALTER;

  const company = await ClientOrganizationModel.findById(clientOrgId).lean();

  if (!company) {
    // Data-integrity violation: the Invoice pre-save invariant hook prevents
    // creation of an Invoice whose clientOrgId does not resolve, so a null here
    // means the ClientOrganization was deleted out from under a surviving
    // Invoice (a delete that escaped FK checks). Throw rather than silently
    // no-op'ing PLACEOFSUPPLY so the orphan reference is surfaced upstream.
    throw new ClientOrganizationNotFoundError(clientOrgId);
  }

  if (action === TALLY_ACTION.ALTER && !company.f12OverwriteByGuidVerified) {
    throw new F12OverwriteNotVerifiedError(clientOrgId);
  }

  // Buyer state precedence: explicit ClientOrganization.stateName wins;
  // otherwise derive from ClientOrganization.gstin (always present + format-validated
  // post-pivot, so derivation almost always succeeds). The org row is guaranteed
  // present here (null was rejected above), so this either resolves a state name
  // or returns null only on the rare unassigned-prefix path.
  const buyerStateName = company.stateName ?? deriveVendorState(company.gstin ?? null, null);

  return {
    guid: computeVoucherGuid({ clientOrgId, invoiceId, exportVersion: nextExportVersion }),
    action,
    priorExportVersion: currentExportVersion,
    nextExportVersion,
    buyerStateName
  };
}

export async function stageInFlightExportVersion(params: {
  invoiceId: string;
  expectedPriorVersion: number;
}): Promise<void> {
  const stagedVersion = params.expectedPriorVersion + 1;
  const result = await InvoiceModel.updateOne(
    {
      _id: params.invoiceId,
      exportVersion: params.expectedPriorVersion,
      $or: [
        { inFlightExportVersion: null },
        { inFlightExportVersion: { $exists: false } },
        { inFlightExportVersion: stagedVersion }
      ]
    },
    { $set: { inFlightExportVersion: stagedVersion } }
  );

  if (result.matchedCount === 1) {
    return;
  }

  const current = await InvoiceModel.findById(params.invoiceId).lean();
  if (!current || current.exportVersion !== params.expectedPriorVersion) {
    throw new ExportVersionConflictError(
      params.invoiceId,
      params.expectedPriorVersion,
      EXPORT_VERSION_CONFLICT_REASON.VERSION_MISMATCH
    );
  }
  throw new ExportVersionConflictError(
    params.invoiceId,
    params.expectedPriorVersion,
    EXPORT_VERSION_CONFLICT_REASON.IN_FLIGHT_MISMATCH
  );
}

export async function promoteExportVersion(params: {
  invoiceId: string;
  stagedVersion: number;
}): Promise<void> {
  const result = await InvoiceModel.updateOne(
    { _id: params.invoiceId, inFlightExportVersion: params.stagedVersion },
    { $set: { exportVersion: params.stagedVersion, inFlightExportVersion: null } }
  );
  if (result.matchedCount === 0) {
    throw new ExportVersionConflictError(
      params.invoiceId,
      params.stagedVersion - 1,
      EXPORT_VERSION_CONFLICT_REASON.IN_FLIGHT_MISMATCH
    );
  }
}

export async function clearInFlightExportVersion(params: {
  invoiceId: string;
  stagedVersion: number;
}): Promise<void> {
  await InvoiceModel.updateOne(
    { _id: params.invoiceId, inFlightExportVersion: params.stagedVersion },
    { $set: { inFlightExportVersion: null } }
  );
}
