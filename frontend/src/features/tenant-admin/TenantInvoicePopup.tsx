import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Invoice } from "@/types";
import { ApprovalTimeline } from "@/features/tenant-admin/ApprovalTimeline";
import { CollapsibleSectionHeader } from "@/components/common/CollapsibleSectionHeader";
import { ExtractedFieldsTable } from "@/components/invoice/ExtractedFieldsTable";
import { InvoiceSourceViewer } from "@/components/invoice/InvoiceSourceViewer";
import { LineItemsTable } from "@/components/invoice/LineItemsTable";
import { TallyMappingTable } from "@/components/invoice/TallyMappingTable";
import type { ExtractedFieldRow } from "@/lib/invoice/extractedFields";
import type { SourceFieldKey } from "@/lib/invoice/sourceHighlights";
import type { TallyMappingRow } from "@/lib/invoice/tallyMapping";
import type { CropSource } from "@/lib/invoice/invoiceView";

interface TenantInvoicePopupProps {
  invoice: Invoice;
  loading: boolean;
  tenantMode?: "test" | "live";
  popupRef: RefObject<HTMLElement>;
  popupSourcePreviewExpanded: boolean;
  setPopupSourcePreviewExpanded: Dispatch<SetStateAction<boolean>>;
  popupExtractedFieldsExpanded: boolean;
  setPopupExtractedFieldsExpanded: Dispatch<SetStateAction<boolean>>;
  popupLineItemsExpanded: boolean;
  setPopupLineItemsExpanded: Dispatch<SetStateAction<boolean>>;
  popupRawOcrExpanded: boolean;
  setPopupRawOcrExpanded: Dispatch<SetStateAction<boolean>>;
  popupMappingExpanded: boolean;
  setPopupMappingExpanded: Dispatch<SetStateAction<boolean>>;
  popupOverlayUrlByField: Partial<Record<SourceFieldKey, string>>;
  popupCropUrlByField: Partial<Record<SourceFieldKey, CropSource>>;
  popupExtractedRows: ExtractedFieldRow[];
  popupTallyMappings: TallyMappingRow[];
  onClose: () => void;
  onSaveField: (fieldKey: string, value: string, refreshDetail: () => Promise<void>) => Promise<void>;
  refreshPopupInvoiceDetail: () => Promise<void>;
  resolvePreviewUrl: (page: number) => string;
}

export function TenantInvoicePopup({
  invoice,
  loading,
  tenantMode,
  popupRef,
  popupSourcePreviewExpanded,
  setPopupSourcePreviewExpanded,
  popupExtractedFieldsExpanded,
  setPopupExtractedFieldsExpanded,
  popupLineItemsExpanded,
  setPopupLineItemsExpanded,
  popupRawOcrExpanded,
  setPopupRawOcrExpanded,
  popupMappingExpanded,
  setPopupMappingExpanded,
  popupOverlayUrlByField,
  popupCropUrlByField,
  popupExtractedRows,
  popupTallyMappings,
  onClose,
  onSaveField,
  refreshPopupInvoiceDetail,
  resolvePreviewUrl
}: TenantInvoicePopupProps) {
  return (
    <div className="popup-overlay" role="presentation" onClick={onClose}>
      <section
        ref={popupRef}
        tabIndex={-1}
        className="popup-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Invoice file details for ${invoice.attachmentName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="popup-header">
          <h2>File Details: {invoice.attachmentName}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted popup-meta">
          Status: <strong>{invoice.status}</strong>
          {invoice.workflowState?.currentStep ? ` (Step ${invoice.workflowState.currentStep})` : ""}
          {invoice.metadata?.invoiceType ? ` | Type: ${invoice.metadata.invoiceType}` : ""}
          {invoice.metadata?.learningHintsApplied && Number(invoice.metadata.learningHintsApplied) > 0 ? ` | ${invoice.metadata.learningHintsApplied} learned pattern${Number(invoice.metadata.learningHintsApplied) === 1 ? "" : "s"} available` : ""}
          {" | "}Received: {new Date(invoice.receivedAt).toLocaleString()}
        </p>
        <ApprovalTimeline invoice={invoice} />
        <div className="popup-content">
          {loading ? <p className="muted">Loading full invoice details...</p> : null}
          <div className="source-preview-section">
            <CollapsibleSectionHeader label="Source Preview" expanded={popupSourcePreviewExpanded} onToggle={() => setPopupSourcePreviewExpanded((v) => !v)} />
            {popupSourcePreviewExpanded ? (
              <InvoiceSourceViewer
                invoice={invoice}
                overlayUrlByField={popupOverlayUrlByField}
                resolvePreviewUrl={resolvePreviewUrl}
              />
            ) : null}
          </div>
          <div>
            <CollapsibleSectionHeader label="Extracted Invoice Fields" expanded={popupExtractedFieldsExpanded} onToggle={() => setPopupExtractedFieldsExpanded((v) => !v)} />
            {popupExtractedFieldsExpanded ? (
              <ExtractedFieldsTable rows={popupExtractedRows} cropUrlByField={popupCropUrlByField} editable={invoice.status !== "EXPORTED"} onSaveField={(fieldKey, value) => onSaveField(fieldKey, value, refreshPopupInvoiceDetail)} />
            ) : null}
          </div>
          {invoice.parsed?.lineItems && invoice.parsed.lineItems.length > 0 ? (
            <div>
              <CollapsibleSectionHeader label="Extracted Line Items" expanded={popupLineItemsExpanded} onToggle={() => setPopupLineItemsExpanded((v) => !v)} />
              {popupLineItemsExpanded ? <LineItemsTable invoice={invoice} /> : null}
            </div>
          ) : null}
          {invoice.ocrText && tenantMode !== "live" ? (
            <div>
              <button
                type="button"
                className="source-preview-toggle"
                onClick={() => setPopupRawOcrExpanded((v) => !v)}
              >
                {popupRawOcrExpanded ? "Hide Raw OCR Text" : "Show Raw OCR Text"}
              </button>
              {popupRawOcrExpanded ? (
                <pre className="raw-ocr-text">{invoice.ocrText}</pre>
              ) : null}
            </div>
          ) : null}
          <div>
            <button
              type="button"
              className="source-preview-toggle"
              onClick={() => setPopupMappingExpanded((v) => !v)}
            >
              {popupMappingExpanded ? "Hide Export Mapping" : "Show Export Mapping"}
            </button>
            {popupMappingExpanded ? <TallyMappingTable rows={popupTallyMappings} /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
