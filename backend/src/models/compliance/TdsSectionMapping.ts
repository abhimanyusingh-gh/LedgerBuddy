import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";
import { validateClientOrgTenantInvariant } from "@/services/auth/tenantScope.js";

const tdsSectionMappingSchema = new Schema(
  {
    tenantId: { type: String, default: null },
    clientOrgId: { type: Schema.Types.ObjectId, ref: "ClientOrganization", default: null },
    glCategory: { type: String, required: true },
    panCategory: { type: String, required: true },
    tdsSection: { type: String, required: true },
    priority: { type: Number, required: true, default: 0 }
  },
  { timestamps: true }
);

tdsSectionMappingSchema.pre("save", async function () {
  await validateClientOrgTenantInvariant(this.tenantId, this.clientOrgId);
});

tdsSectionMappingSchema.index({ clientOrgId: 1, glCategory: 1, panCategory: 1 });

type TdsSectionMapping = InferSchemaType<typeof tdsSectionMappingSchema>;
type TdsSectionMappingDocument = HydratedDocument<TdsSectionMapping>;

export const TdsSectionMappingModel = model<TdsSectionMapping>("TdsSectionMapping", tdsSectionMappingSchema);
