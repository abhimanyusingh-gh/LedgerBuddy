import type { InvoiceDocument } from "@/models/invoice/Invoice.js";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals.js";

interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  trigger: string;
}

interface TemplateConfig {
  subject: string;
  body: string;
}

const DEFAULT_TEMPLATES: Record<string, TemplateConfig> = {
  PAN_MISSING: {
    subject: "PAN Required on Invoices — {{tenantName}}",
    body: "Dear {{vendorName}},\n\nWe require your PAN (Permanent Account Number) to be included on all invoices for TDS compliance.\n\nPlease provide your PAN at your earliest convenience and include it on future invoices.\n\nInvoice Reference: {{invoiceNumber}} dated {{invoiceDate}}\n\nRegards,\n{{tenantName}}"
  },
  [RISK_SIGNAL_CODE.IRN_MISSING]: {
    subject: "E-Invoice IRN Required — {{tenantName}}",
    body: "Dear {{vendorName}},\n\nAs per GST e-invoicing regulations, invoices above the prescribed threshold must carry a valid Invoice Reference Number (IRN).\n\nPlease reissue invoice {{invoiceNumber}} dated {{invoiceDate}} with the IRN and QR code.\n\nRegards,\n{{tenantName}}"
  },
  [RISK_SIGNAL_CODE.VENDOR_BANK_CHANGED]: {
    subject: "Bank Account Verification Required — {{tenantName}}",
    body: "Dear {{vendorName}},\n\nWe have detected a change in the bank account details on your recent invoice {{invoiceNumber}} dated {{invoiceDate}}.\n\nFor security purposes, please confirm your updated bank details by replying to this email or contacting us directly.\n\nRegards,\n{{tenantName}}"
  },
  GSTIN_FORMAT_INVALID: {
    subject: "GSTIN Correction Required — {{tenantName}}",
    body: "Dear {{vendorName}},\n\nThe GSTIN on invoice {{invoiceNumber}} dated {{invoiceDate}} does not match the expected format.\n\nPlease verify and reissue the invoice with the correct GSTIN to ensure Input Tax Credit eligibility.\n\nRegards,\n{{tenantName}}"
  }
};

export class VendorCommunicationService {
  generateDraft(
    invoice: InvoiceDocument,
    trigger: string,
    vendorEmail: string,
    tenantName: string
  ): EmailDraft | null {
    const template = DEFAULT_TEMPLATES[trigger];
    if (!template) return null;

    const vars: Record<string, string> = {
      "{{vendorName}}": invoice.parsed?.vendorName ?? "Vendor",
      "{{invoiceNumber}}": invoice.parsed?.invoiceNumber ?? "N/A",
      "{{invoiceDate}}": invoice.parsed?.invoiceDate instanceof Date ? invoice.parsed.invoiceDate.toISOString().slice(0, 10) : "N/A",
      "{{tenantName}}": tenantName
    };

    let subject = template.subject;
    let body = template.body;
    for (const [key, value] of Object.entries(vars)) {
      subject = subject.replaceAll(key, value);
      body = body.replaceAll(key, value);
    }

    return { to: vendorEmail, subject, body, trigger };
  }

  getSupportedTriggers(): string[] {
    return Object.keys(DEFAULT_TEMPLATES);
  }
}
