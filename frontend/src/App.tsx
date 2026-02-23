import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveInvoices,
  exportToTally,
  fetchIngestionStatus,
  fetchInvoices,
  runIngestion,
  updateInvoiceParsedFields
} from "./api";
import type { IngestionJobStatus, Invoice, InvoiceStatus } from "./types";
import { ConfidenceBadge } from "./components/ConfidenceBadge";
import { ExtractedFieldsTable } from "./components/ExtractedFieldsTable";
import { TallyMappingTable } from "./components/TallyMappingTable";
import { formatOcrConfidenceLabel, getExtractedFieldRows } from "./extractedFields";
import {
  isInvoiceApprovable,
  isInvoiceExportable,
  isInvoiceSelectable,
  mergeSelectedIds,
  removeSelectedIds
} from "./selection";
import { getInvoiceTallyMappings } from "./tallyMapping";
import { formatMinorAmountWithCurrency, minorUnitsToMajorString } from "./currency";

const STATUSES: Array<InvoiceStatus | "ALL"> = [
  "ALL",
  "PARSED",
  "NEEDS_REVIEW",
  "FAILED_OCR",
  "FAILED_PARSE",
  "APPROVED",
  "EXPORTED"
];

interface EditInvoiceFormState {
  invoiceNumber: string;
  vendorName: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  totalAmountMajor: string;
}

const EMPTY_EDIT_FORM: EditInvoiceFormState = {
  invoiceNumber: "",
  vendorName: "",
  invoiceDate: "",
  dueDate: "",
  currency: "",
  totalAmountMajor: ""
};

export function App() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "ALL">("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [popupInvoiceId, setPopupInvoiceId] = useState<string | null>(null);
  const [detailsPanelVisible, setDetailsPanelVisible] = useState(true);
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [editingParsedFields, setEditingParsedFields] = useState(false);
  const [savingParsedFields, setSavingParsedFields] = useState(false);
  const [editForm, setEditForm] = useState<EditInvoiceFormState>(EMPTY_EDIT_FORM);
  const [ingestionStatus, setIngestionStatus] = useState<IngestionJobStatus | null>(null);
  const ingestionWasRunningRef = useRef(false);

  useEffect(() => {
    void loadInvoices();
  }, [statusFilter]);

  const activeInvoice = useMemo(
    () => invoices.find((invoice) => invoice._id === activeId) ?? null,
    [activeId, invoices]
  );

  const failedCount = useMemo(
    () => invoices.filter((invoice) => ["FAILED_OCR", "FAILED_PARSE"].includes(invoice.status)).length,
    [invoices]
  );

  const popupInvoice = useMemo(
    () => invoices.find((invoice) => invoice._id === popupInvoiceId) ?? null,
    [invoices, popupInvoiceId]
  );

  const activeExtractedRows = useMemo(
    () => (activeInvoice ? getExtractedFieldRows(activeInvoice) : []),
    [activeInvoice]
  );

  const activeTallyMappings = useMemo(
    () => (activeInvoice ? getInvoiceTallyMappings(activeInvoice) : []),
    [activeInvoice]
  );

  const popupExtractedRows = useMemo(
    () => (popupInvoice ? getExtractedFieldRows(popupInvoice) : []),
    [popupInvoice]
  );

  const popupTallyMappings = useMemo(
    () => (popupInvoice ? getInvoiceTallyMappings(popupInvoice) : []),
    [popupInvoice]
  );

  const canEditActiveInvoice = Boolean(activeInvoice && activeInvoice.status !== "EXPORTED");
  const ingestionProgressPercent = useMemo(() => {
    if (!ingestionStatus || ingestionStatus.totalFiles <= 0) {
      return 0;
    }

    return Math.min(100, Math.round((ingestionStatus.processedFiles / ingestionStatus.totalFiles) * 100));
  }, [ingestionStatus]);

  const ingestionSuccessfulFiles = useMemo(() => {
    if (!ingestionStatus) {
      return 0;
    }

    return Math.max(0, ingestionStatus.processedFiles - ingestionStatus.failures);
  }, [ingestionStatus]);

  const selectedInvoices = useMemo(() => {
    if (selectedIds.length === 0 || invoices.length === 0) {
      return [];
    }

    const selectedIdSet = new Set(selectedIds);
    return invoices.filter((invoice) => selectedIdSet.has(invoice._id));
  }, [invoices, selectedIds]);

  const selectedApprovableIds = useMemo(
    () => selectedInvoices.filter((invoice) => isInvoiceApprovable(invoice)).map((invoice) => invoice._id),
    [selectedInvoices]
  );

  const selectedExportableIds = useMemo(
    () => selectedInvoices.filter((invoice) => isInvoiceExportable(invoice)).map((invoice) => invoice._id),
    [selectedInvoices]
  );

  const selectedNonExportableCount = useMemo(
    () => selectedInvoices.filter((invoice) => !isInvoiceExportable(invoice)).length,
    [selectedInvoices]
  );

  const selectableVisibleIds = useMemo(
    () => invoices.filter((invoice) => isInvoiceSelectable(invoice)).map((invoice) => invoice._id),
    [invoices]
  );

  const areAllVisibleSelectableSelected = useMemo(() => {
    if (selectableVisibleIds.length === 0) {
      return false;
    }

    const selectedIdSet = new Set(selectedIds);
    return selectableVisibleIds.every((id) => selectedIdSet.has(id));
  }, [selectableVisibleIds, selectedIds]);

  const contentClassName = useMemo(() => {
    if (!detailsPanelVisible) {
      return "content content-list-expanded";
    }

    return detailsPanelCollapsed ? "content content-details-collapsed" : "content";
  }, [detailsPanelVisible, detailsPanelCollapsed]);

  useEffect(() => {
    if (!popupInvoiceId) {
      return undefined;
    }

    function handleEsc(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPopupInvoiceId(null);
      }
    }

    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [popupInvoiceId]);

  useEffect(() => {
    if (!activeInvoice) {
      setEditForm(EMPTY_EDIT_FORM);
      setEditingParsedFields(false);
      return;
    }

    setEditForm(buildEditForm(activeInvoice));
    setEditingParsedFields(false);
  }, [activeInvoice?._id]);

  useEffect(() => {
    void refreshIngestionStatus();
  }, []);

  useEffect(() => {
    if (!ingestionStatus?.running) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refreshIngestionStatus();
    }, 1200);

    return () => window.clearInterval(timer);
  }, [ingestionStatus?.running]);

  useEffect(() => {
    const isRunning = ingestionStatus?.running === true;
    if (ingestionWasRunningRef.current && !isRunning) {
      if (ingestionStatus?.state === "failed") {
        setError(ingestionStatus.error ? `Ingestion failed: ${ingestionStatus.error}` : "Ingestion failed.");
      }
      void loadInvoices();
    }

    ingestionWasRunningRef.current = isRunning;
  }, [ingestionStatus?.running, ingestionStatus?.state, ingestionStatus?.error]);

  async function loadInvoices() {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchInvoices(statusFilter === "ALL" ? undefined : statusFilter);
      setInvoices(data.items);
      setSelectedIds((currentSelectedIds) => mergeSelectedIds(currentSelectedIds, data.items));
      if (!data.items.find((item) => item._id === activeId)) {
        setActiveId(data.items[0]?._id ?? null);
      }
      if (popupInvoiceId && !data.items.find((item) => item._id === popupInvoiceId)) {
        setPopupInvoiceId(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to fetch invoices");
    } finally {
      setLoading(false);
    }
  }

  async function refreshIngestionStatus() {
    try {
      const status = await fetchIngestionStatus();
      setIngestionStatus(status);
    } catch {
      // Keep UI usable even if status endpoint temporarily fails.
    }
  }

  async function handleApprove() {
    if (selectedApprovableIds.length === 0) {
      setError("Select at least one PARSED / NEEDS_REVIEW / FAILED_PARSE invoice to approve.");
      return;
    }

    try {
      setError(null);
      const response = await approveInvoices(selectedApprovableIds, "ui-user");
      if (response.modifiedCount === 0) {
        setError("No selected invoices were eligible for approval.");
        return;
      }
      await loadInvoices();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Approval failed");
    }
  }

  async function handleExport() {
    if (selectedExportableIds.length === 0) {
      setError("Select at least one APPROVED invoice before export.");
      return;
    }

    if (selectedNonExportableCount > 0) {
      setError("Only APPROVED invoices can be exported. Deselect non-approved invoices and retry.");
      return;
    }

    const confirmationMessage = `Export ${selectedExportableIds.length} approved invoice file${selectedExportableIds.length === 1 ? "" : "s"} to Tally?`;
    if (!window.confirm(confirmationMessage)) {
      return;
    }

    try {
      setError(null);
      const exportResult = await exportToTally(selectedExportableIds);
      const successfullyExportedIds = exportResult.items
        .filter((item) => item.success)
        .map((item) => item.invoiceId);
      setSelectedIds((currentSelectedIds) => removeSelectedIds(currentSelectedIds, successfullyExportedIds));
      await loadInvoices();
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed");
    }
  }

  async function handleIngest() {
    try {
      setError(null);
      const status = await runIngestion();
      setIngestionStatus(status);
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : "Ingestion run failed");
    }
  }

  function toggleSelection(invoice: Invoice) {
    if (!isInvoiceSelectable(invoice)) {
      return;
    }

    const id = invoice._id;
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((currentId) => currentId !== id) : [...current, id]
    );
  }

  function openPopup(invoiceId: string) {
    setPopupInvoiceId(invoiceId);
  }

  function toggleSelectAllVisible() {
    if (selectableVisibleIds.length === 0) {
      return;
    }

    const visibleIdSet = new Set(selectableVisibleIds);

    setSelectedIds((currentSelectedIds) => {
      if (areAllVisibleSelectableSelected) {
        return currentSelectedIds.filter((selectedId) => !visibleIdSet.has(selectedId));
      }

      return Array.from(new Set([...currentSelectedIds, ...selectableVisibleIds]));
    });
  }

  function closePopup() {
    setPopupInvoiceId(null);
  }

  async function handleSaveParsedEdits() {
    if (!activeInvoice) {
      return;
    }

    try {
      setSavingParsedFields(true);
      setError(null);

      await updateInvoiceParsedFields(activeInvoice._id, {
        parsed: {
          invoiceNumber: normalizeTextInput(editForm.invoiceNumber),
          vendorName: normalizeTextInput(editForm.vendorName),
          invoiceDate: normalizeTextInput(editForm.invoiceDate),
          dueDate: normalizeTextInput(editForm.dueDate),
          currency: normalizeTextInput(editForm.currency)?.toUpperCase() ?? null,
          totalAmountMajor: normalizeAmountInput(editForm.totalAmountMajor)
        },
        updatedBy: "ui-user"
      });

      setEditingParsedFields(false);
      await loadInvoices();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update parsed invoice fields");
    } finally {
      setSavingParsedFields(false);
    }
  }

  return (
    <div className="layout">
      <div className="orb orb-left" />
      <div className="orb orb-right" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Invoice Processor</p>
          <h1>Ops Console</h1>
        </div>

        <div className="metrics">
          <div className="metric">
            <span>Total</span>
            <strong>{invoices.length}</strong>
          </div>
          <div className="metric metric-alert">
            <span>Failed</span>
            <strong>{failedCount}</strong>
          </div>
        </div>
      </header>

      <section className="controls">
        <div className="status-tabs">
          {STATUSES.map((status) => (
            <button
              key={status}
              className={status === statusFilter ? "tab tab-active" : "tab"}
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="actions">
          <button onClick={handleIngest} disabled={ingestionStatus?.running === true}>
            {ingestionStatus?.running ? "Ingestion Running..." : "Run Ingestion"}
          </button>
          <button onClick={toggleSelectAllVisible} disabled={selectableVisibleIds.length === 0}>
            {areAllVisibleSelectableSelected ? "Deselect All" : "Select All"}
          </button>
          <button onClick={handleApprove} disabled={selectedApprovableIds.length === 0}>
            Approve Selected
          </button>
          <button onClick={handleExport} disabled={selectedExportableIds.length === 0 || selectedNonExportableCount > 0}>
            Export To Tally ({selectedExportableIds.length})
          </button>
          <button onClick={() => setDetailsPanelVisible((currentValue) => !currentValue)}>
            {detailsPanelVisible ? "Hide Details Panel" : "Show Details Panel"}
          </button>
          <button onClick={() => void loadInvoices()}>Refresh</button>
        </div>
        {ingestionStatus && ingestionStatus.state !== "idle" ? (
          <div
            className={`ingestion-progress ${
              ingestionStatus.running
                ? "ingestion-progress-running"
                : ingestionStatus.state === "failed"
                  ? "ingestion-progress-failed"
                  : "ingestion-progress-complete"
            }`}
            role="status"
            aria-live="polite"
          >
            <div className="ingestion-progress-head">
              {ingestionStatus.running ? <span className="ingestion-spinner" aria-hidden="true" /> : null}
              <strong>
                {ingestionStatus.running
                  ? "Ingestion in progress"
                  : ingestionStatus.state === "failed"
                    ? "Ingestion failed"
                    : "Ingestion completed"}
              </strong>
              <span>
                {ingestionStatus.processedFiles}/{ingestionStatus.totalFiles > 0 ? ingestionStatus.totalFiles : "?"}{" "}
                processed
              </span>
            </div>
            <div className="ingestion-progress-track">
              <div className="ingestion-progress-fill" style={{ width: `${ingestionProgressPercent}%` }} />
            </div>
            <p className="muted ingestion-progress-meta">
              Successful {ingestionSuccessfulFiles} | New {ingestionStatus.newInvoices} | Duplicates{" "}
              {ingestionStatus.duplicates} | Failures {ingestionStatus.failures}
            </p>
            {ingestionStatus.state === "failed" && ingestionStatus.error ? (
              <p className="error ingestion-progress-error">{ingestionStatus.error}</p>
            ) : null}
          </div>
        ) : null}
        <p className="muted export-selection">
          {selectedIds.length} selected | {selectedExportableIds.length} approved exportable
          {selectedNonExportableCount > 0
            ? ` | ${selectedNonExportableCount} non-approved must be deselected for export`
            : ""}
        </p>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <main className={contentClassName}>
        <section className="panel list-panel">
          <div className="panel-title">
            <h2>Invoices</h2>
            {loading ? <span>Loading...</span> : <span>{invoices.length} records</span>}
          </div>

          <div className="list-scroll">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>File</th>
                  <th>Vendor</th>
                  <th>Invoice #</th>
                  <th>Total</th>
                  <th>Confidence</th>
                  <th>Status</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const rowClasses = [
                    invoice._id === activeId ? "row-active" : null,
                    invoice.status === "EXPORTED" ? "row-exported" : null
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <tr key={invoice._id} className={rowClasses || undefined} onClick={() => setActiveId(invoice._id)}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(invoice._id)}
                          disabled={!isInvoiceSelectable(invoice)}
                          onChange={() => toggleSelection(invoice)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="file-label"
                          onClick={(event) => {
                            event.stopPropagation();
                            openPopup(invoice._id);
                          }}
                        >
                          {invoice.attachmentName}
                        </button>
                      </td>
                      <td>{invoice.parsed?.vendorName ?? "-"}</td>
                      <td>{invoice.parsed?.invoiceNumber ?? "-"}</td>
                      <td
                        className={
                          invoice.riskFlags.includes("TOTAL_AMOUNT_ABOVE_EXPECTED") ? "value-risk" : undefined
                        }
                      >
                        {formatMinorAmountWithCurrency(invoice.parsed?.totalAmountMinor, invoice.parsed?.currency)}
                      </td>
                      <td>
                        <ConfidenceBadge score={invoice.confidenceScore ?? 0} />
                      </td>
                      <td>
                        <span className={`status status-${invoice.status.toLowerCase()}`}>{invoice.status}</span>
                      </td>
                      <td>{new Date(invoice.receivedAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {detailsPanelVisible ? (
          <section className={`panel detail-panel ${detailsPanelCollapsed ? "detail-panel-collapsed" : ""}`}>
            <div className="panel-title">
              <h2>Invoice Details</h2>
              <button
                type="button"
                className="collapse-button"
                onClick={() => setDetailsPanelCollapsed((currentValue) => !currentValue)}
              >
                {detailsPanelCollapsed ? "Expand" : "Collapse"}
              </button>
            </div>

            {detailsPanelCollapsed ? (
              <div className="detail-panel-collapsed-body">
                <p className="muted detail-panel-collapsed-hint">Details panel collapsed.</p>
              </div>
            ) : activeInvoice ? (
              <div className="detail-scroll">
                <div className="detail-content">
                  <div className="detail-grid">
                    <p>
                      <span>ID</span>
                      <strong>{activeInvoice._id}</strong>
                    </p>
                    <p>
                      <span>Attachment</span>
                      <strong>{activeInvoice.attachmentName}</strong>
                    </p>
                    <p>
                      <span>Source</span>
                      <strong>{activeInvoice.sourceType}:{activeInvoice.sourceKey}</strong>
                    </p>
                    <p>
                      <span>Tenant / Tier</span>
                      <strong>{activeInvoice.tenantId}:{activeInvoice.workloadTier}</strong>
                    </p>
                    <p>
                      <span>OCR Engine</span>
                      <strong>{activeInvoice.ocrProvider ?? "-"}</strong>
                    </p>
                    <p>
                      <span>Extraction Source</span>
                      <strong>{activeInvoice.metadata?.extractionSource ?? "-"}</strong>
                    </p>
                    <p>
                      <span>OCR Confidence</span>
                      <strong>{formatOcrConfidenceLabel(activeInvoice.ocrConfidence)}</strong>
                    </p>
                    <p>
                      <span>OCR Blocks</span>
                      <strong>{activeInvoice.ocrBlocks?.length ?? 0}</strong>
                    </p>
                    <p>
                      <span>Confidence</span>
                      <strong>
                        <ConfidenceBadge score={activeInvoice.confidenceScore ?? 0} />
                      </strong>
                    </p>
                  </div>

                  <div className="editor-card">
                    <div className="editor-header">
                      <h3>Adjust Parsed Fields</h3>
                      {canEditActiveInvoice ? (
                        editingParsedFields ? (
                          <div className="editor-actions">
                            <button type="button" disabled={savingParsedFields} onClick={() => setEditingParsedFields(false)}>
                              Cancel
                            </button>
                            <button type="button" disabled={savingParsedFields} onClick={() => void handleSaveParsedEdits()}>
                              {savingParsedFields ? "Saving..." : "Save"}
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setEditingParsedFields(true)}>
                            Edit
                          </button>
                        )
                      ) : (
                        <span className="muted">Exported invoices are locked.</span>
                      )}
                    </div>
                    {editingParsedFields ? (
                      <div className="edit-grid">
                        <label>
                          Vendor Name
                          <input
                            value={editForm.vendorName}
                            onChange={(event) => setEditForm((state) => ({ ...state, vendorName: event.target.value }))}
                          />
                        </label>
                        <label>
                          Invoice Number
                          <input
                            value={editForm.invoiceNumber}
                            onChange={(event) =>
                              setEditForm((state) => ({ ...state, invoiceNumber: event.target.value }))
                            }
                          />
                        </label>
                        <label>
                          Invoice Date
                          <input
                            value={editForm.invoiceDate}
                            onChange={(event) => setEditForm((state) => ({ ...state, invoiceDate: event.target.value }))}
                            placeholder="YYYY-MM-DD"
                          />
                        </label>
                        <label>
                          Due Date
                          <input
                            value={editForm.dueDate}
                            onChange={(event) => setEditForm((state) => ({ ...state, dueDate: event.target.value }))}
                            placeholder="YYYY-MM-DD"
                          />
                        </label>
                        <label>
                          Currency
                          <input
                            value={editForm.currency}
                            onChange={(event) => setEditForm((state) => ({ ...state, currency: event.target.value }))}
                            placeholder="USD"
                          />
                        </label>
                        <label>
                          Total Amount (major)
                          <input
                            value={editForm.totalAmountMajor}
                            onChange={(event) =>
                              setEditForm((state) => ({ ...state, totalAmountMajor: event.target.value }))
                            }
                            placeholder="1200.50"
                          />
                        </label>
                      </div>
                    ) : (
                      <p className="muted">Enable edit mode to correct vendor/entity names and parsed values before export.</p>
                    )}
                  </div>

                  <button
                    type="button"
                    className="detail-sections-toggle"
                    onClick={() => setDetailsExpanded((currentValue) => !currentValue)}
                  >
                    {detailsExpanded ? "Hide Detail Sections" : "Show Detail Sections"}
                  </button>

                  {detailsExpanded ? (
                    <>
                      <div>
                        <h3>Risk Signals</h3>
                        {activeInvoice.riskMessages.length > 0 ? (
                          <ul>
                            {activeInvoice.riskMessages.map((entry) => (
                              <li key={entry}>{entry}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">No high-value risk signals.</p>
                        )}
                      </div>

                      <div>
                        <h3>Parse Errors / Warnings</h3>
                        {activeInvoice.processingIssues.length > 0 ? (
                          <ul>
                            {activeInvoice.processingIssues.map((entry) => (
                              <li key={entry}>{entry}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">None</p>
                        )}
                      </div>

                      <div>
                        <h3>Extracted Invoice Fields</h3>
                        <ExtractedFieldsTable rows={activeExtractedRows} />
                      </div>

                      <div>
                        <h3>Detected Fields to Tally Mapping</h3>
                        <TallyMappingTable rows={activeTallyMappings} />
                      </div>

                      <div>
                        <h3>OCR Text Preview</h3>
                        <pre>{activeInvoice.ocrText?.slice(0, 2000) || "No OCR text available."}</pre>
                      </div>
                    </>
                  ) : (
                    <p className="muted">Details are collapsed. Expand to inspect extraction, mapping, and OCR output.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="muted">Select an invoice to inspect details.</p>
            )}
          </section>
        ) : null}
      </main>

      {popupInvoice ? (
        <div className="popup-overlay" role="presentation" onClick={closePopup}>
          <section
            className="popup-card"
            role="dialog"
            aria-modal="true"
            aria-label={`Invoice file details for ${popupInvoice.attachmentName}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="popup-header">
              <h2>File Details: {popupInvoice.attachmentName}</h2>
              <button type="button" onClick={closePopup}>
                Close
              </button>
            </div>
            <p className="muted popup-meta">
              Status: <strong>{popupInvoice.status}</strong> | Source: {popupInvoice.sourceType}:{popupInvoice.sourceKey} |
              Tenant: {popupInvoice.tenantId} | Tier: {popupInvoice.workloadTier}
            </p>
            <div className="popup-content">
              <div>
                <h3>Extracted Invoice Fields</h3>
                <ExtractedFieldsTable rows={popupExtractedRows} />
              </div>
              <div>
                <h3>Detected Fields to Tally Mapping</h3>
                <TallyMappingTable rows={popupTallyMappings} />
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function buildEditForm(invoice: Invoice): EditInvoiceFormState {
  return {
    invoiceNumber: invoice.parsed?.invoiceNumber ?? "",
    vendorName: invoice.parsed?.vendorName ?? "",
    invoiceDate: invoice.parsed?.invoiceDate ?? "",
    dueDate: invoice.parsed?.dueDate ?? "",
    currency: invoice.parsed?.currency ?? "",
    totalAmountMajor:
      typeof invoice.parsed?.totalAmountMinor === "number"
        ? minorUnitsToMajorString(invoice.parsed.totalAmountMinor, invoice.parsed?.currency)
        : ""
  };
}

function normalizeTextInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAmountInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
