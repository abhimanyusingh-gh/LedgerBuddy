import { Schema, model, type InferSchemaType } from "mongoose";

const viewerScopeSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    viewerUserId: { type: String, required: true },
    visibleUserIds: { type: [String], default: [] }
  },
  {
    timestamps: true
  }
);

viewerScopeSchema.index({ tenantId: 1, viewerUserId: 1 }, { unique: true });

type ViewerScope = InferSchemaType<typeof viewerScopeSchema>;

export const ViewerScopeModel = model<ViewerScope>("ViewerScope", viewerScopeSchema);
