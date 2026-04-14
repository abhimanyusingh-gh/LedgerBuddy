import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

const tdsRateTableSchema = new Schema(
  {
    section: { type: String, required: true },
    description: { type: String, required: true },
    rateCompanyBps: { type: Number, required: true },
    rateIndividualBps: { type: Number, required: true },
    rateNoPanBps: { type: Number, required: true },
    thresholdSingleMinor: { type: Number, required: true },
    thresholdAnnualMinor: { type: Number, required: true },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

tdsRateTableSchema.index({ section: 1, effectiveFrom: 1 }, { unique: true });
tdsRateTableSchema.index({ isActive: 1, effectiveTo: 1 });

type TdsRateTable = InferSchemaType<typeof tdsRateTableSchema>;
type TdsRateTableDocument = HydratedDocument<TdsRateTable>;

export const TdsRateTableModel = model<TdsRateTable>("TdsRateTable", tdsRateTableSchema);
