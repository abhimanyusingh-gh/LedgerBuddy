import { Schema, model, type InferSchemaType } from "mongoose";
import { validateClientOrgTenantInvariant } from "@/services/auth/tenantScope.js";

const csvColumnSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true }
  },
  { _id: false }
);

const clientExportConfigSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    clientOrgId: { type: Schema.Types.ObjectId, ref: "ClientOrganization", required: true },
    tallyCompanyName: { type: String },
    tallyPurchaseLedger: { type: String },
    tallyCgstLedger: { type: String },
    tallySgstLedger: { type: String },
    tallyIgstLedger: { type: String },
    tallyCessLedger: { type: String },
    tallyTdsLedger: { type: String },
    tallyTcsLedger: { type: String },
    tallyBankLedger: { type: String, default: null },
    tallyEndpointUrl: { type: String, default: null },
    autoCreateVendors: { type: Boolean, required: true, default: false },
    csvColumns: { type: [csvColumnSchema] }
  },
  { timestamps: true }
);

clientExportConfigSchema.index({ tenantId: 1, clientOrgId: 1 }, { unique: true });

clientExportConfigSchema.pre("save", async function () {
  await validateClientOrgTenantInvariant(this.tenantId, this.clientOrgId);
});

type ClientExportConfig = InferSchemaType<typeof clientExportConfigSchema>;

export const ClientExportConfigModel = model<ClientExportConfig>("ClientExportConfig", clientExportConfigSchema);
