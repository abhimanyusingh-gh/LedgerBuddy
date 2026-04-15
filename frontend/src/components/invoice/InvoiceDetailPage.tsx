import { useState } from "react";
import { useInvoiceDetail } from "@/hooks/useInvoiceDetail";
import { getExtractedFieldRows } from "@/lib/invoice/extractedFields";
import { getInvoiceSourceHighlights } from "@/lib/invoice/sourceHighlights";
import { buildFieldOverlayUrlMap, buildFieldCropUrlMap } from "@/lib/invoice/invoiceView";
import { formatMinorAmountWithCurrency } from "@/lib/common/currency";
import { InvoiceSourceViewer } from "@/components/invoice/InvoiceSourceViewer";
import { ExtractedFieldsTable } from "@/components/invoice/ExtractedFieldsTable";
import { LineItemsTable } from "@/components/invoice/LineItemsTable";
import { CompliancePanel } from "@/components/compliance/CompliancePanel";
import { RiskSignalList } from "@/components/compliance/RiskSignalList";
import { ConfidenceBadge } from "@/components/invoice/ConfidenceBadge";
import { getInvoicePreviewUrl, getInvoiceFieldOverlayUrl, getInvoiceBlockCropUrl } from "@/api";

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
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <p className="muted" style={{ fontSize: "1rem" }}>Loading invoice details...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <div style={{ textAlign: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "3rem", color: "var(--ink-soft)" }}>error_outline</span>
          <p style={{ marginTop: "0.5rem", fontSize: "1rem" }}>Invoice not found or access denied.</p>
        </div>
      </div>
    );
  }

  const highlights = getInvoiceSourceHighlights(invoice);
  const overlayMap = buildFieldOverlayUrlMap(invoice._id, highlights, getInvoiceFieldOverlayUrl);
  const cropMap = buildFieldCropUrlMap(invoice._id, highlights, getInvoiceBlockCropUrl);
  const extractedRows = getExtractedFieldRows(invoice);

  const resolvePreviewUrl = (page: number) => getInvoicePreviewUrl(invoice._id, page);

  return (
    <div style={{ maxWidth: "60rem", margin: "0 auto", padding: "1.5rem 1rem" }}>
      <div className="editor-card" style={{ marginBottom: "1rem" }}>
        <div className="editor-header">
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>
            {invoice.parsed?.invoiceNumber ?? "Invoice"} - {invoice.parsed?.vendorName ?? "Unknown Vendor"}
          </h2>
          <span className="bank-status-badge bank-status-active">{invoice.status}</span>
        </div>
        <div className="detail-grid" style={{ marginTop: "0.75rem" }}>
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

      <div className="editor-card" style={{ marginBottom: "1rem" }}>
        <div
          className="editor-header"
          style={{ cursor: "pointer" }}
          onClick={() => setSourceExpanded((v) => !v)}
        >
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "1.1rem" }}>{sourceExpanded ? "expand_more" : "chevron_right"}</span>
            Source Preview
          </h3>
        </div>
        {sourceExpanded ? (
          <InvoiceSourceViewer
            invoice={invoice}
            overlayUrlByField={overlayMap}
            resolvePreviewUrl={resolvePreviewUrl}
          />
        ) : null}
      </div>

      <div className="editor-card" style={{ marginBottom: "1rem" }}>
        <div
          className="editor-header"
          style={{ cursor: "pointer" }}
          onClick={() => setFieldsExpanded((v) => !v)}
        >
          <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "1.1rem" }}>{fieldsExpanded ? "expand_more" : "chevron_right"}</span>
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
        <div className="editor-card" style={{ marginBottom: "1rem" }}>
          <div
            className="editor-header"
            style={{ cursor: "pointer" }}
            onClick={() => setLineItemsExpanded((v) => !v)}
          >
            <h3 style={{ margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "1.1rem" }}>{lineItemsExpanded ? "expand_more" : "chevron_right"}</span>
              Line Items ({invoice.parsed.lineItems.length})
            </h3>
          </div>
          {lineItemsExpanded ? <LineItemsTable invoice={invoice} /> : null}
        </div>
      ) : null}

      <div className="editor-card" style={{ marginBottom: "1rem" }}>
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
          legacyRiskFlags={invoice.riskFlags}
          legacyRiskMessages={invoice.riskMessages}
        />
      </div>
    </div>
  );
}
