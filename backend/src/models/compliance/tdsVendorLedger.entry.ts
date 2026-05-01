import { Schema } from "mongoose";

export const tdsVendorLedgerEntrySchema = new Schema(
  {
    invoiceId: { type: String, required: true },
    invoiceDate: { type: Date, required: true },
    taxableAmountMinor: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "entries.taxableAmountMinor must be an integer."
      }
    },
    tdsAmountMinor: {
      type: Number,
      required: true,
      validate: {
        validator: Number.isInteger,
        message: "entries.tdsAmountMinor must be an integer."
      }
    },
    rateSource: { type: String, required: true },
    rateBps: {
      type: Number,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "entries.rateBps must be an integer."
      }
    },
    quarter: {
      type: String,
      enum: ["Q1", "Q2", "Q3", "Q4"],
      required: true
    },
    recordedAt: { type: Date, required: true }
  },
  { _id: false }
);
