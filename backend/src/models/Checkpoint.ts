import { Schema, model, type InferSchemaType } from "mongoose";

const checkpointSchema = new Schema(
  {
    tenantId: { type: String, required: true, default: "default" },
    sourceKey: { type: String, required: true },
    marker: { type: String, required: true },
    metadata: { type: Map, of: String, default: {} }
  },
  {
    timestamps: true
  }
);

checkpointSchema.index({ tenantId: 1, sourceKey: 1 }, { unique: true });

type Checkpoint = InferSchemaType<typeof checkpointSchema>;

export const CheckpointModel = model<Checkpoint>("Checkpoint", checkpointSchema);
