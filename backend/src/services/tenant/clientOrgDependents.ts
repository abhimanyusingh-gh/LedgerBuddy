import type { Model, Types } from "mongoose";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { ExportBatchModel } from "@/models/invoice/ExportBatch.js";
import { ApprovalWorkflowModel } from "@/models/invoice/ApprovalWorkflow.js";
import { ExtractionLearningModel } from "@/models/invoice/ExtractionLearning.js";
import { ExtractionMappingModel } from "@/models/invoice/ExtractionMapping.js";
import { VendorTemplateModel } from "@/models/invoice/VendorTemplate.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { VendorGlMappingModel } from "@/models/compliance/VendorGlMapping.js";
import { GlCodeMasterModel } from "@/models/compliance/GlCodeMaster.js";
import { CostCenterMasterModel } from "@/models/compliance/CostCenterMaster.js";
import { VendorCostCenterMappingModel } from "@/models/compliance/VendorCostCenterMapping.js";
import { BankAccountModel } from "@/models/bank/BankAccount.js";
import { BankStatementModel } from "@/models/bank/BankStatement.js";
import { BankTransactionModel } from "@/models/bank/BankTransaction.js";
import { ClientComplianceConfigModel } from "@/models/integration/ClientComplianceConfig.js";
import { ClientNotificationConfigModel } from "@/models/integration/ClientNotificationConfig.js";
import { ClientTcsConfigModel } from "@/models/integration/ClientTcsConfig.js";
import { ClientExportConfigModel } from "@/models/integration/ClientExportConfig.js";
import { TenantMailboxAssignmentModel } from "@/models/integration/TenantMailboxAssignment.js";
import { TdsSectionMappingModel } from "@/models/compliance/TdsSectionMapping.js";

type ClientOrgDependentEntry = {
  label: string;
  model: Model<unknown>;
  buildFilter: (input: { tenantId: string; clientOrgId: Types.ObjectId }) => Record<string, unknown>;
};

const tenantAndClientOrgId = (input: { tenantId: string; clientOrgId: Types.ObjectId }) => ({
  tenantId: input.tenantId,
  clientOrgId: input.clientOrgId
});

export const CLIENT_ORG_DEPENDENT_MODELS: ReadonlyArray<ClientOrgDependentEntry> = [
  { label: "invoices", model: InvoiceModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "exportBatches", model: ExportBatchModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "approvalWorkflows", model: ApprovalWorkflowModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "extractionLearnings", model: ExtractionLearningModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "extractionMappings", model: ExtractionMappingModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "vendorTemplates", model: VendorTemplateModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "vendors", model: VendorMasterModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "vendorGlMappings", model: VendorGlMappingModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "glCodes", model: GlCodeMasterModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "costCenters", model: CostCenterMasterModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "vendorCostCenterMappings", model: VendorCostCenterMappingModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "bankAccounts", model: BankAccountModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "bankStatements", model: BankStatementModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "bankTransactions", model: BankTransactionModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "complianceConfigs", model: ClientComplianceConfigModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "notificationConfigs", model: ClientNotificationConfigModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "tcsConfigs", model: ClientTcsConfigModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  { label: "exportConfigs", model: ClientExportConfigModel as unknown as Model<unknown>, buildFilter: tenantAndClientOrgId },
  {
    label: "mailboxAssignments",
    model: TenantMailboxAssignmentModel as unknown as Model<unknown>,
    buildFilter: ({ tenantId, clientOrgId }) => ({ tenantId, clientOrgIds: clientOrgId })
  },
  {
    label: "tdsSectionMappings",
    model: TdsSectionMappingModel as unknown as Model<unknown>,
    buildFilter: tenantAndClientOrgId
  }
] as const;

export const NON_REQUIRED_REGISTERED_MODELS: ReadonlyArray<string> = [
  TdsSectionMappingModel.modelName
] as const;

type ClientOrgDependentLabel = (typeof CLIENT_ORG_DEPENDENT_MODELS)[number]["label"];

type ClientOrgLinkedCounts = Record<ClientOrgDependentLabel, number>;

export async function countClientOrgDependents(input: {
  tenantId: string;
  clientOrgId: Types.ObjectId;
}): Promise<{ counts: ClientOrgLinkedCounts; total: number }> {
  const counts = await Promise.all(
    CLIENT_ORG_DEPENDENT_MODELS.map((entry) =>
      entry.model.countDocuments(entry.buildFilter(input))
    )
  );
  const breakdown = CLIENT_ORG_DEPENDENT_MODELS.reduce<ClientOrgLinkedCounts>(
    (acc, entry, index) => {
      acc[entry.label] = counts[index] ?? 0;
      return acc;
    },
    {} as ClientOrgLinkedCounts
  );
  const total = counts.reduce((sum, n) => sum + n, 0);
  return { counts: breakdown, total };
}
