import { Schema, model, type InferSchemaType } from "mongoose";

const csvColumnSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true }
  },
  { _id: false }
);

const tenantExportConfigSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    tallyCompanyName: { type: String },
    tallyPurchaseLedger: { type: String },
    tallyCgstLedger: { type: String },
    tallySgstLedger: { type: String },
    tallyIgstLedger: { type: String },
    tallyCessLedger: { type: String },
    tallyTdsLedger: { type: String },
    tallyTcsLedger: { type: String },
    csvColumns: { type: [csvColumnSchema] }
  },
  { timestamps: true }
);

tenantExportConfigSchema.index({ tenantId: 1 }, { unique: true });

type TenantExportConfig = InferSchemaType<typeof tenantExportConfigSchema>;

export const TenantExportConfigModel = model<TenantExportConfig>("TenantExportConfig", tenantExportConfigSchema);
