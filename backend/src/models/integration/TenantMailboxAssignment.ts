import { Schema, model, type InferSchemaType, Types } from "mongoose";

const tenantMailboxAssignmentSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    integrationId: { type: Types.ObjectId, required: true, ref: "TenantIntegration" },
    assignedTo: { type: String, required: true }
  },
  {
    timestamps: true
  }
);

tenantMailboxAssignmentSchema.index({ tenantId: 1, integrationId: 1, assignedTo: 1 }, { unique: true });

type TenantMailboxAssignment = InferSchemaType<typeof tenantMailboxAssignmentSchema>;

export const TenantMailboxAssignmentModel = model<TenantMailboxAssignment>("TenantMailboxAssignment", tenantMailboxAssignmentSchema);
