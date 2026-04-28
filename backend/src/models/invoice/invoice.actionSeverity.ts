import type { Schema } from "mongoose";
import { computeActionSeverityFields, type ClassifierInput } from "@/services/invoice/actionClassifier.js";

const CLASSIFICATION_FIELD_PATHS = [
  "status",
  "parsed",
  "parsed.currency",
  "parsed.customerGstin",
  "export",
  "export.error",
  "compliance",
  "compliance.riskSignals"
];

const QUERY_UPDATE_OPS = ["findOneAndUpdate", "updateOne", "updateMany"] as const;

function updateTouchesClassification(update: unknown): boolean {
  if (update === null || typeof update !== "object") return false;
  const u = update as Record<string, unknown>;
  for (const op of ["$set", "$unset", "$setOnInsert", "$push", "$pull", "$addToSet"] as const) {
    const opVal = u[op];
    if (opVal && typeof opVal === "object") {
      const keys = Object.keys(opVal as Record<string, unknown>);
      for (const key of keys) {
        for (const path of CLASSIFICATION_FIELD_PATHS) {
          if (key === path || key.startsWith(`${path}.`)) return true;
        }
      }
    }
  }
  for (const path of CLASSIFICATION_FIELD_PATHS) {
    if (Object.prototype.hasOwnProperty.call(u, path)) return true;
  }
  return false;
}

export function applyActionSeveritySchemaDoc(schema: Schema): void {
  schema.index(
    { tenantId: 1, actionSeverity: -1, createdAt: -1, _id: -1 },
    { partialFilterExpression: { actionSeverity: { $type: "number" } } }
  );

  schema.pre("save", function () {
    const fields = computeActionSeverityFields(this.toObject() as unknown as ClassifierInput);
    this.set("actionReason", fields.actionReason);
    this.set("actionSeverity", fields.actionSeverity);
  });

  for (const op of QUERY_UPDATE_OPS) {
    schema.post(op, async function () {
      const update = this.getUpdate();
      if (!updateTouchesClassification(update)) return;
      const filter = this.getFilter();
      const InvoiceModelRef = this.model;
      const docs = await InvoiceModelRef.find(filter).select({
        status: 1,
        parsed: 1,
        export: 1,
        compliance: 1,
        actionReason: 1,
        actionSeverity: 1
      }).lean();
      for (const doc of docs) {
        const fields = computeActionSeverityFields(doc as unknown as ClassifierInput);
        const stale = (doc as { actionReason?: unknown }).actionReason !== fields.actionReason
          || (doc as { actionSeverity?: unknown }).actionSeverity !== fields.actionSeverity;
        if (!stale) continue;
        await InvoiceModelRef.updateOne(
          { _id: (doc as { _id: unknown })._id },
          { $set: { actionReason: fields.actionReason, actionSeverity: fields.actionSeverity } }
        );
      }
    });
  }
}
