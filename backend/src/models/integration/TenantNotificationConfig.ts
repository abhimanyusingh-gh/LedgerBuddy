import { Schema, model, type InferSchemaType } from "mongoose";

const NOTIFICATION_RECIPIENT_TYPES = ["integration_creator", "all_tenant_admins", "specific_user"] as const;

const tenantNotificationConfigSchema = new Schema(
  {
    tenantId: { type: String, required: true, unique: true },
    mailboxReauthEnabled: { type: Boolean, required: true, default: true },
    escalationEnabled: { type: Boolean, required: true, default: true },
    inAppEnabled: { type: Boolean, required: true, default: false },
    primaryRecipientType: {
      type: String,
      enum: NOTIFICATION_RECIPIENT_TYPES,
      required: true,
      default: "integration_creator"
    },
    specificRecipientUserId: { type: String, default: null },
    updatedBy: { type: String, default: null }
  },
  {
    timestamps: true
  }
);

type TenantNotificationConfig = InferSchemaType<typeof tenantNotificationConfigSchema>;

const TenantNotificationConfigModel = model<TenantNotificationConfig>(
  "TenantNotificationConfig",
  tenantNotificationConfigSchema
);

export { TenantNotificationConfigModel, NOTIFICATION_RECIPIENT_TYPES };
