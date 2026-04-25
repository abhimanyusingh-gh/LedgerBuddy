import { Schema, model, type InferSchemaType } from "mongoose";
import { GSTIN_FORMAT } from "@/constants/indianCompliance.js";

export const TALLY_VERSION = {
  ERP9: "erp9",
  Prime: "prime",
  PrimeServer: "primeServer"
} as const;

const clientOrganizationSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    companyName: { type: String },
    companyGuid: { type: String },
    stateName: { type: String },
    gstin: {
      type: String,
      required: true,
      validate: {
        validator: (value: string) => GSTIN_FORMAT.test(value),
        message: "ClientOrganization.gstin must match the 15-character GSTIN format"
      }
    },
    f12OverwriteByGuidVerified: { type: Boolean, required: true, default: false },
    detectedVersion: {
      type: String,
      enum: Object.values(TALLY_VERSION),
      required: false,
      default: null
    },
    /**
     * Soft-archive marker (#174). Set by the admin DELETE route when a
     * client-org cannot be hard-deleted because dependent accounting-leaf
     * documents (Invoice, VendorMaster, BankAccount, …) still reference
     * its `_id`. While `archivedAt` is non-null the org is read-only —
     * it must not be the target of new accounting writes nor a candidate
     * in any new TenantMailboxAssignment. Enforcement lives in the admin
     * service layer (`clientOrgsAdminService.assertWritable`); it is NOT
     * a hard schema invariant because back-fill workflows (e.g. retro
     * imports) may still need to write under an archived org via tooling.
     */
    archivedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

clientOrganizationSchema.index({ tenantId: 1, gstin: 1 }, { unique: true });

type ClientOrganization = InferSchemaType<typeof clientOrganizationSchema>;

export const ClientOrganizationModel = model<ClientOrganization>(
  "ClientOrganization",
  clientOrganizationSchema
);
