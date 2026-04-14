import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { GlCode, Invoice, TdsRate } from "../../types";
import { ConfidenceBadge } from "../ConfidenceBadge";
import { ExtractedFieldsTable } from "../ExtractedFieldsTable";
import { InvoiceSourceViewer } from "../InvoiceSourceViewer";
import { LineItemsTable } from "../LineItemsTable";
import { CompliancePanel } from "../CompliancePanel";
import { RiskSignalList } from "../RiskSignalList";
import { CollapsibleSectionHeader } from "./CollapsibleSectionHeader";
import { formatInvoiceType } from "./invoiceViewHelpers";
import type { SourceFieldKey } from "../../sourceHighlights";
import type { ExtractedFieldRow } from "../../extractedFields";

const KEY_FIELD_KEYS = ["vendorName", "invoiceNumber", "invoiceDate", "dueDate", "totalAmountMinor", "currency"];

function toIsoDateString(value: string): string {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dy}`;
}

interface TenantInvoiceDetailPanelProps {
  invoice: Invoice;
  loading: boolean;
  canApproveInvoices: boolean;
  canEditInvoiceFields: boolean;
  canDismissRiskSignals: boolean;
  canOverrideGlCode: boolean;
  canOverrideTds: boolean;
  tenantGlCodes: GlCode[];
  tenantTdsRates: TdsRate[];
  activeOverlayUrlByField: Partial<Record<SourceFieldKey, string>>;
  activeCropUrlByField: Partial<Record<SourceFieldKey, string>>;
  resolvePreviewUrl: (page: number) => string;
  activeSourcePreviewExpanded: boolean;
  setActiveSourcePreviewExpanded: Dispatch<SetStateAction<boolean>>;
  activeExtractedFieldsExpanded: boolean;
  setActiveExtractedFieldsExpanded: Dispatch<SetStateAction<boolean>>;
  activeLineItemsExpanded: boolean;
  setActiveLineItemsExpanded: Dispatch<SetStateAction<boolean>>;
  onWorkflowApproveSingle: (invoiceId: string) => void;
  onWorkflowRejectSingle: (invoiceId: string) => void;
  onSaveField: (fieldKey: string, value: string, refreshDetail: () => Promise<void>) => Promise<void>;
  refreshActiveInvoiceDetail: () => Promise<void>;
  onClose: () => void;
  extractedRows: ExtractedFieldRow[];
  onOverrideGlCode: (glCode: string, glName?: string) => Promise<void>;
  onOverrideTdsSection: (section: string) => Promise<void>;
  onDismissRiskSignal: (signalCode: string) => Promise<void>;
}

export function TenantInvoiceDetailPanel({
  invoice,
  loading,
  canApproveInvoices,
  canEditInvoiceFields,
  canDismissRiskSignals,
  canOverrideGlCode,
  canOverrideTds,
  tenantGlCodes,
  tenantTdsRates,
  activeOverlayUrlByField,
  activeCropUrlByField,
  resolvePreviewUrl,
  activeSourcePreviewExpanded,
  setActiveSourcePreviewExpanded,
  activeExtractedFieldsExpanded,
  setActiveExtractedFieldsExpanded,
  activeLineItemsExpanded,
  setActiveLineItemsExpanded,
  onWorkflowApproveSingle,
  onWorkflowRejectSingle,
  onSaveField,
  refreshActiveInvoiceDetail,
  onClose,
  extractedRows,
  onOverrideGlCode,
  onOverrideTdsSection,
  onDismissRiskSignal
}: TenantInvoiceDetailPanelProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const keyRows = extractedRows.filter((r) => KEY_FIELD_KEYS.includes(r.fieldKey));
  const isEditable = invoice.status !== "EXPORTED" && canEditInvoiceFields;

  function startDetailEdit(row: ExtractedFieldRow) {
    setEditingField(row.fieldKey);
    const raw = row.rawValue != null ? row.rawValue : row.value === "-" ? "" : row.value;
    const isDateField = row.fieldKey === "invoiceDate" || row.fieldKey === "dueDate";
    setEditValue(isDateField ? toIsoDateString(raw) : raw);
  }

  async function confirmDetailEdit() {
    if (!editingField) return;
    try {
      setSaving(true);
      await onSaveField(editingField, editValue, refreshActiveInvoiceDetail);
    } finally {
      setSaving(false);
      setEditingField(null);
      setEditValue("");
    }
  }

  function cancelDetailEdit() {
    setEditingField(null);
    setEditValue("");
  }

  return (
    <section className="panel detail-panel">
      <div className="panel-title">
        <h2>Invoice Details</h2>
        <button
          type="button"
          className="collapse-button"
          onClick={onClose}
          aria-label="Close details panel"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="detail-scroll">
        <div className="detail-content">
          {loading ? <p className="muted">Loading full invoice details...</p> : null}
          <div className="detail-grid">
            <p><span>Status</span><strong>{invoice.status}</strong></p>
            <p><span>Received</span>{new Date(invoice.receivedAt).toLocaleString()}</p>
            <p><span>Confidence</span><ConfidenceBadge score={invoice.confidenceScore} /></p>
            {invoice.metadata?.invoiceType ? <p><span>Type</span><strong>{formatInvoiceType(invoice.metadata.invoiceType)}</strong></p> : null}
            {invoice.metadata?.learningHintsApplied && Number(invoice.metadata.learningHintsApplied) > 0 ? (
              <p><span>Learning</span><strong className="learning-badge">{invoice.metadata.learningHintsApplied} learned pattern{Number(invoice.metadata.learningHintsApplied) === 1 ? "" : "s"} available</strong></p>
            ) : null}
            <p><span>File</span>{invoice.attachmentName}</p>
          </div>
          {keyRows.length > 0 ? (
            <div className="detail-key-fields">
              {keyRows.map((row) => {
                const isEditing = editingField === row.fieldKey;
                return (
                  <div key={row.fieldKey} className="key-field-item">
                    <span className="key-field-label">{row.label}</span>
                    {isEditing ? (
                      <div className="extracted-value-cell">
                        <input
                          className="extracted-value-input"
                          type={row.fieldKey === "invoiceDate" || row.fieldKey === "dueDate" ? "date" : "text"}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void confirmDetailEdit();
                            if (e.key === "Escape") cancelDetailEdit();
                          }}
                          disabled={saving}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="field-save-button"
                          aria-label={`Save ${row.label}`}
                          disabled={saving}
                          onClick={() => void confirmDetailEdit()}
                        >
                          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div className="extracted-value-cell">
                        <span className="extracted-value-display">{row.value}</span>
                        {isEditable && (
                          <button
                            type="button"
                            className="row-action-button field-edit-button"
                            title={`Edit ${row.label}`}
                            onClick={() => startDetailEdit(row)}
                          >
                            <span className="material-symbols-outlined">edit</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          {invoice.status === "AWAITING_APPROVAL" && canApproveInvoices ? (
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <button
                type="button"
                className="app-button app-button-primary"
                onClick={() => void onWorkflowApproveSingle(invoice._id)}
              >
                Approve Current Step
              </button>
              <button
                type="button"
                className="app-button app-button-destructive"
                style={{ background: "var(--warn)", borderColor: "var(--warn)" }}
                onClick={() => onWorkflowRejectSingle(invoice._id)}
              >
                Reject Current Step
              </button>
            </div>
          ) : null}
          <div className="source-preview-section">
            <CollapsibleSectionHeader label="Source Preview" expanded={activeSourcePreviewExpanded} onToggle={() => setActiveSourcePreviewExpanded((v) => !v)} />
            {activeSourcePreviewExpanded ? (
              <InvoiceSourceViewer
                invoice={invoice}
                overlayUrlByField={activeOverlayUrlByField}
                resolvePreviewUrl={resolvePreviewUrl}
              />
            ) : null}
          </div>
          <div>
            <CollapsibleSectionHeader label="Extracted Invoice Fields" expanded={activeExtractedFieldsExpanded} onToggle={() => setActiveExtractedFieldsExpanded((v) => !v)} />
            {activeExtractedFieldsExpanded ? (
              <ExtractedFieldsTable
                rows={extractedRows}
                cropUrlByField={activeCropUrlByField}
                editable={invoice.status !== "EXPORTED" && canEditInvoiceFields}
                onSaveField={(fieldKey, value) => onSaveField(fieldKey, value, refreshActiveInvoiceDetail)}
              />
            ) : null}
          </div>
          {invoice.parsed?.lineItems && invoice.parsed.lineItems.length > 0 ? (
            <div>
              <CollapsibleSectionHeader label="Extracted Line Items" expanded={activeLineItemsExpanded} onToggle={() => setActiveLineItemsExpanded((v) => !v)} />
              {activeLineItemsExpanded ? <LineItemsTable invoice={invoice} /> : null}
            </div>
          ) : null}
          <CompliancePanel
            invoice={invoice}
            glCodes={tenantGlCodes}
            tdsRates={tenantTdsRates}
            canOverrideGlCode={canOverrideGlCode}
            canOverrideTds={canOverrideTds}
            onOverrideGlCode={onOverrideGlCode}
            onOverrideTdsSection={onOverrideTdsSection}
            isReadOnly={invoice.status === "EXPORTED"}
          />
          <RiskSignalList
            signals={invoice.compliance?.riskSignals ?? []}
            legacyRiskFlags={invoice.riskFlags}
            legacyRiskMessages={invoice.riskMessages}
            onDismiss={!canDismissRiskSignals ? undefined : onDismissRiskSignal}
          />
        </div>
      </div>
    </section>
  );
}
