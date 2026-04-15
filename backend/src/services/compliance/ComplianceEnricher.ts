import type {
  InvoiceCompliance,
  ParsedInvoiceData
} from "@/types/invoice.js";
import type { UUID } from "@/types/uuid.js";

export interface ComplianceResult {
  pan?: InvoiceCompliance["pan"];
  tds?: InvoiceCompliance["tds"];
  tcs?: InvoiceCompliance["tcs"];
  glCode?: InvoiceCompliance["glCode"];
  costCenter?: InvoiceCompliance["costCenter"];
  irn?: InvoiceCompliance["irn"];
  msme?: InvoiceCompliance["msme"];
  vendorBank?: InvoiceCompliance["vendorBank"];
  riskSignals?: InvoiceCompliance["riskSignals"];
}

export interface ComplianceEnrichContext {
  emailFrom?: string;
  contentHash?: string;
  slmGlCategory?: string;
  currentInvoiceId?: string;
}

export interface ComplianceEnricher {
  enrich(invoice: ParsedInvoiceData, tenantId: UUID, vendorFingerprint: string, context?: ComplianceEnrichContext): Promise<ComplianceResult>;
}

export function emptyComplianceResult(): ComplianceResult {
  return { riskSignals: [] };
}
