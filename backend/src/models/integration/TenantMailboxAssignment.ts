import { Schema, model, type InferSchemaType, Types } from "mongoose";

export const MAILBOX_ASSIGNED_TO = {
  ALL: "all"
} as const;

const tenantMailboxAssignmentSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    integrationId: { type: Types.ObjectId, required: true, ref: "TenantIntegration" },
    assignedTo: { type: String, required: true },
    clientOrgIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "ClientOrganization" }],
      required: true,
      validate: {
        validator: (value: Types.ObjectId[]) => Array.isArray(value) && value.length >= 1,
        message: "TenantMailboxAssignment.clientOrgIds must contain at least one ClientOrganization reference."
      }
    }
  },
  {
    timestamps: true
  }
);

tenantMailboxAssignmentSchema.index({ tenantId: 1, integrationId: 1, assignedTo: 1 }, { unique: true });
tenantMailboxAssignmentSchema.index({ tenantId: 1, clientOrgIds: 1 });

type TenantMailboxAssignment = InferSchemaType<typeof tenantMailboxAssignmentSchema>;

export const TenantMailboxAssignmentModel = model<TenantMailboxAssignment>("TenantMailboxAssignment", tenantMailboxAssignmentSchema);
