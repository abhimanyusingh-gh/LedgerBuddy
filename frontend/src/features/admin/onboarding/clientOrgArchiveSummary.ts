import {
  CLIENT_ORG_DEPENDENT_LABEL,
  type ClientOrgDependentLabel,
  type ClientOrgLinkedCounts
} from "@/api/clientOrgs";

interface LabelCopy {
  singular: string;
  plural: string;
}

const DEPENDENT_LABEL_COPY: Record<ClientOrgDependentLabel, LabelCopy> = {
  [CLIENT_ORG_DEPENDENT_LABEL.Invoices]: { singular: "invoice", plural: "invoices" },
  [CLIENT_ORG_DEPENDENT_LABEL.ExportBatches]: { singular: "export batch", plural: "export batches" },
  [CLIENT_ORG_DEPENDENT_LABEL.ApprovalWorkflows]: { singular: "approval workflow", plural: "approval workflows" },
  [CLIENT_ORG_DEPENDENT_LABEL.ExtractionLearnings]: { singular: "extraction record", plural: "extraction records" },
  [CLIENT_ORG_DEPENDENT_LABEL.ExtractionMappings]: { singular: "extraction mapping", plural: "extraction mappings" },
  [CLIENT_ORG_DEPENDENT_LABEL.VendorTemplates]: { singular: "vendor template", plural: "vendor templates" },
  [CLIENT_ORG_DEPENDENT_LABEL.Vendors]: { singular: "vendor", plural: "vendors" },
  [CLIENT_ORG_DEPENDENT_LABEL.VendorGlMappings]: { singular: "vendor GL mapping", plural: "vendor GL mappings" },
  [CLIENT_ORG_DEPENDENT_LABEL.GlCodes]: { singular: "GL code", plural: "GL codes" },
  [CLIENT_ORG_DEPENDENT_LABEL.CostCenters]: { singular: "cost center", plural: "cost centers" },
  [CLIENT_ORG_DEPENDENT_LABEL.VendorCostCenterMappings]: {
    singular: "vendor cost-center mapping",
    plural: "vendor cost-center mappings"
  },
  [CLIENT_ORG_DEPENDENT_LABEL.BankAccounts]: { singular: "bank account", plural: "bank accounts" },
  [CLIENT_ORG_DEPENDENT_LABEL.BankStatements]: { singular: "bank statement", plural: "bank statements" },
  [CLIENT_ORG_DEPENDENT_LABEL.BankTransactions]: { singular: "bank transaction", plural: "bank transactions" },
  [CLIENT_ORG_DEPENDENT_LABEL.ComplianceConfigs]: { singular: "compliance config", plural: "compliance configs" },
  [CLIENT_ORG_DEPENDENT_LABEL.NotificationConfigs]: {
    singular: "notification config",
    plural: "notification configs"
  },
  [CLIENT_ORG_DEPENDENT_LABEL.TcsConfigs]: { singular: "TCS config", plural: "TCS configs" },
  [CLIENT_ORG_DEPENDENT_LABEL.ExportConfigs]: { singular: "export config", plural: "export configs" },
  [CLIENT_ORG_DEPENDENT_LABEL.MailboxAssignments]: {
    singular: "mailbox assignment",
    plural: "mailbox assignments"
  },
  [CLIENT_ORG_DEPENDENT_LABEL.TdsSectionMappings]: {
    singular: "TDS section mapping",
    plural: "TDS section mappings"
  }
};

interface ArchiveBreakdownEntry {
  label: ClientOrgDependentLabel;
  count: number;
  text: string;
}

export function summarizeLinkedCounts(
  linkedCounts: ClientOrgLinkedCounts | undefined | null
): ArchiveBreakdownEntry[] {
  if (!linkedCounts) return [];
  return (Object.entries(linkedCounts) as Array<[ClientOrgDependentLabel, number | undefined]>)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([label, count]) => {
      const safeCount = count ?? 0;
      const copy = DEPENDENT_LABEL_COPY[label];
      const noun = safeCount === 1 ? copy.singular : copy.plural;
      return { label, count: safeCount, text: `${safeCount} ${noun}` };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
