import { useState } from "react";
import { useInvoiceDetail } from "@/hooks/useInvoiceDetail";
import { getExtractedFieldRows } from "@/lib/invoice/extractedFields";
import { getInvoiceSourceHighlights } from "@/lib/invoice/sourceHighlights";
import { buildFieldCropSourceMap } from "@/lib/invoice/invoiceView";
import { formatMinorAmountWithCurrency } from "@/lib/common/currency";
import { InvoiceSourceViewer } from "@/components/invoice/InvoiceSourceViewer";
import { ExtractedFieldsTable } from "@/components/invoice/ExtractedFieldsTable";
import { LineItemsTable } from "@/components/invoice/LineItemsTable";
import { CompliancePanel } from "@/components/compliance/CompliancePanel";
import { RiskSignalList } from "@/components/compliance/RiskSignalList";
import { ConfidenceBadge } from "@/components/invoice/ConfidenceBadge";
import { invoiceUrls } from "@/api/urls/invoiceUrls";

interface InvoiceDetailPageProps {
  invoiceId: string;
}

export function InvoiceDetailPage({ invoiceId }: InvoiceDetailPageProps) {
  const { detail: invoice, loading } = useInvoiceDetail(invoiceId);
  const [sourceExpanded, setSourceExpanded] = useState(true);
  const [fieldsExpanded, setFieldsExpanded] = useState(true);
  const [lineItemsExpanded, setLineItemsExpanded] = useState(true);

  if (loading && !invoice) {
    return (
      <div className="invoice-detail-page-loading">
        <p className="muted">Loading invoice details...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="invoice-detail-page-empty">
        <div className="invoice-detail-page-empty-inner">
          <span className="material-symbols-outlined invoice-detail-page-empty-icon">error_outline</span>
          <p className="invoice-detail-page-empty-text">Invoice not found or access denied.</p>
        </div>
      </div>
    );
  }

  const highlights = getInvoiceSourceHighlights(invoice);
  const cropMap = buildFieldCropSourceMap(invoice._id, highlights, invoiceUrls.preview);
  const extractedRows = getExtractedFieldRows(invoice);

  const resolvePreviewUrl = (page: number) => invoiceUrls.preview(invoice._id, page);

  return (
    <div className="invoice-detail-page">
      <div className="editor-card">
        <div className="editor-header">
          <h2>
            {invoice.parsed?.invoiceNumber ?? "Invoice"} - {invoice.parsed?.vendorName ?? "Unknown Vendor"}
          </h2>
          <span className="bank-status-badge bank-status-active">{invoice.status}</span>
        </div>
        <div className="detail-grid">
          <p><span>Status</span><strong>{invoice.status}</strong></p>
          <p><span>Received</span>{new Date(invoice.receivedAt).toLocaleString()}</p>
          <p><span>Confidence</span><ConfidenceBadge score={invoice.confidenceScore} tone={invoice.confidenceTone} /></p>
          <p><span>File</span>{invoice.attachmentName}</p>
          {invoice.parsed?.invoiceDate ? <p><span>Invoice Date</span><strong>{invoice.parsed.invoiceDate}</strong></p> : null}
          {invoice.parsed?.dueDate ? <p><span>Due Date</span><strong>{invoice.parsed.dueDate}</strong></p> : null}
          {invoice.parsed?.totalAmountMinor != null ? (
            <p><span>Total Amount</span><strong>{formatMinorAmountWithCurrency(invoice.parsed.totalAmountMinor, invoice.parsed?.currency)}</strong></p>
          ) : null}
        </div>
      </div>

      <div className="editor-card">
        <div
          className="editor-header invoice-detail-page-section-toggle"
          onClick={() => setSourceExpanded((v) => !v)}
        >
          <h3 className="invoice-detail-page-section-title">
            <span className="material-symbols-outlined invoice-detail-page-section-icon">{sourceExpanded ? "expand_more" : "chevron_right"}</span>
            Source Preview
          </h3>
        </div>
        {sourceExpanded ? (
          <InvoiceSourceViewer
            invoice={invoice}
            resolvePreviewUrl={resolvePreviewUrl}
          />
        ) : null}
      </div>

      <div className="editor-card">
        <div
          className="editor-header invoice-detail-page-section-toggle"
          onClick={() => setFieldsExpanded((v) => !v)}
        >
          <h3 className="invoice-detail-page-section-title">
            <span className="material-symbols-outlined invoice-detail-page-section-icon">{fieldsExpanded ? "expand_more" : "chevron_right"}</span>
            Extracted Fields
          </h3>
        </div>
        {fieldsExpanded ? (
          <ExtractedFieldsTable
            rows={extractedRows}
            cropUrlByField={cropMap}
            editable={false}
          />
        ) : null}
      </div>

      {invoice.parsed?.lineItems && invoice.parsed.lineItems.length > 0 ? (
        <div className="editor-card">
          <div
            className="editor-header invoice-detail-page-section-toggle"
            onClick={() => setLineItemsExpanded((v) => !v)}
          >
            <h3 className="invoice-detail-page-section-title">
              <span className="material-symbols-outlined invoice-detail-page-section-icon">{lineItemsExpanded ? "expand_more" : "chevron_right"}</span>
              Line Items ({invoice.parsed.lineItems.length})
            </h3>
          </div>
          {lineItemsExpanded ? <LineItemsTable invoice={invoice} /> : null}
        </div>
      ) : null}

      <div className="editor-card">
        <CompliancePanel
          invoice={invoice}
          glCodes={[]}
          tdsRates={[]}
          canOverrideGlCode={false}
          canOverrideTds={false}
          onOverrideGlCode={() => {}}
          onOverrideTdsSection={() => {}}
          isReadOnly={true}
        />
      </div>

      <div className="editor-card">
        <RiskSignalList
          signals={invoice.compliance?.riskSignals ?? []}
        />
      </div>
    </div>
  );
}
