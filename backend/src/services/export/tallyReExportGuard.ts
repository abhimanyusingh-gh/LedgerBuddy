import { createHash } from "node:crypto";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { TALLY_ACTION, type TallyAction } from "@/services/export/tallyExporter/xml.js";

interface VoucherGuidInputs {
  tenantId: string;
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
  constructor(tenantId: string) {
    super(
      `Tally F12 "Overwrite voucher when voucher with same GUID exists" is not verified for tenant ${tenantId}. ` +
      "Re-export requires ACTION=\"Alter\"; complete the Tally onboarding F12 check before retrying."
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
    lengthPrefix(inputs.tenantId),
    lengthPrefix(inputs.invoiceId),
    String(inputs.exportVersion)
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export async function resolveReExportDecision(params: {
  tenantId: string;
  invoiceId: string;
  currentExportVersion: number;
}): Promise<ReExportDecision> {
  const { tenantId, invoiceId, currentExportVersion } = params;
  const nextExportVersion = currentExportVersion + 1;
  const action: TallyAction = currentExportVersion === 0 ? TALLY_ACTION.CREATE : TALLY_ACTION.ALTER;

  const company = await ClientOrganizationModel.findOne({ tenantId }).lean();

  if (action === TALLY_ACTION.ALTER && !company?.f12OverwriteByGuidVerified) {
    throw new F12OverwriteNotVerifiedError(tenantId);
  }

  return {
    guid: computeVoucherGuid({ tenantId, invoiceId, exportVersion: nextExportVersion }),
    action,
    priorExportVersion: currentExportVersion,
    nextExportVersion,
    buyerStateName: company?.stateName ?? null
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
