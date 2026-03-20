import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  approveInvoices,
  deleteInvoices,
  downloadTallyXmlFile,
  exportToTally,
  generateTallyXmlFile,
  retryInvoices,
  fetchIngestionStatus,
  fetchInvoices,
  pauseIngestion,
  runIngestion,
  getInvoiceBlockCropUrl,
  getInvoiceFieldOverlayUrl,
  getInvoicePreviewUrl,
  subscribeIngestionSSE,
  updateInvoiceParsedFields,
  renameInvoiceAttachment,
  uploadInvoiceFiles
} from "../../api";
import type { IngestionJobStatus, Invoice } from "../../types";
import { ConfidenceBadge } from "../ConfidenceBadge";
import { ExtractedFieldsTable } from "../ExtractedFieldsTable";
import { IngestionProgressCard } from "../IngestionProgressCard";
import { InvoiceSourceViewer } from "../InvoiceSourceViewer";
import { TallyMappingTable } from "../TallyMappingTable";
import { getExtractedFieldRows } from "../../extractedFields";
import { getInvoiceSourceHighlights } from "../../sourceHighlights";
import {
  getAvailableRowActions,
  hasApprovalWarning,
  isInvoiceApprovable,
  isInvoiceExportable,
  isInvoiceRetryable,
  isInvoiceSelectable,
  mergeSelectedIds,
  removeSelectedIds
} from "../../selection";
import { getInvoiceTallyMappings } from "../../tallyMapping";
import { formatMinorAmountWithCurrency } from "../../currency";
import {
  buildFieldCropUrlMap,
  buildFieldOverlayUrlMap,
  STATUS_LABELS,
  STATUSES
} from "../../invoiceView";
import { useInvoiceDetail } from "../../hooks/useInvoiceDetail";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { getUserFacingErrorMessage, isAuthenticationError } from "../../apiError";
import { ConfirmDialog } from "../ConfirmDialog";

const STATUS_ICONS: Record<string, string> = {
  PENDING: "hourglass_empty",
  PARSED: "task_alt",
  NEEDS_REVIEW: "flag",
  FAILED_OCR: "error",
  FAILED_PARSE: "error",
  APPROVED: "check_circle",
  EXPORTED: "cloud_done"
};

function selectNewerInvoice(detail: Invoice | null, summary: Invoice | null): Invoice | null {
  if (!summary) return detail;
  if (!detail || detail._id !== summary._id) return summary;
  const dt = Date.parse(detail.updatedAt);
  const st = Date.parse(summary.updatedAt);
  return Number.isFinite(dt) && dt >= st ? detail : summary;
}

interface TenantInvoicesViewProps {
  tenantId: string;
  userId: string;
  userEmail: string;
  isTenantAdmin: boolean;
  isViewer?: boolean;
  requiresTenantSetup: boolean;
  tenantMode?: "test" | "live";
  tenantUsers?: Array<{ userId: string; email: string; role: string; enabled: boolean }>;
  onGmailStatusRefresh: () => void;
  onNavCountsChange: (counts: { total: number; approved: number; pending: number }) => void;
  onSessionExpired: () => void;
  addToast: (type: "success" | "error" | "info", message: string) => void;
}

export function TenantInvoicesView({
  userEmail,
  isTenantAdmin,
  isViewer,
  requiresTenantSetup,
  tenantMode,
  tenantUsers,
  onGmailStatusRefresh,
  onNavCountsChange,
  onSessionExpired,
  addToast
}: TenantInvoicesViewProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [ingestingIds, setIngestingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [popupInvoiceId, setPopupInvoiceId] = useState<string | null>(null);
  const [detailsPanelVisible, setDetailsPanelVisible] = useState(false);
  const [listPanelPercent, setListPanelPercent] = useState(58);
  const contentRef = useRef<HTMLElement>(null);
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");
  const [ingestionStatus, setIngestionStatus] = useState<IngestionJobStatus | null>(null);
  const [ingestionFading, setIngestionFading] = useState(false);
  const [editingListCell, setEditingListCell] = useState<{ invoiceId: string; field: string } | null>(null);
  const [editListValue, setEditListValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [popupSourcePreviewExpanded, setPopupSourcePreviewExpanded] = useState(false);
  const [popupRawOcrExpanded, setPopupRawOcrExpanded] = useState(false);
  const [popupMappingExpanded, setPopupMappingExpanded] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const ingestionWasRunningRef = useRef(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; destructive: boolean; onConfirm: () => void } | null>(null);
  const [allStatusCounts, setAllStatusCounts] = useState<Record<string, number>>({});
  const [approvedByFilter, setApprovedByFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);

  const {
    detail: activeInvoiceDetail,
    loading: activeInvoiceDetailLoading,
    refresh: refreshActiveInvoiceDetail
  } = useInvoiceDetail(activeId);
  const {
    detail: popupInvoiceDetail,
    loading: popupInvoiceDetailLoading,
    refresh: refreshPopupInvoiceDetail
  } = useInvoiceDetail(popupInvoiceId);

  const prevFiltersRef = useRef({ statusFilter, invoiceDateFrom, invoiceDateTo, pageSize, approvedByFilter });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const filtersChanged = prev.statusFilter !== statusFilter || prev.invoiceDateFrom !== invoiceDateFrom || prev.invoiceDateTo !== invoiceDateTo || prev.pageSize !== pageSize || prev.approvedByFilter !== approvedByFilter;
    prevFiltersRef.current = { statusFilter, invoiceDateFrom, invoiceDateTo, pageSize, approvedByFilter };
    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
      return;
    }
    void loadInvoices();
  }, [statusFilter, invoiceDateFrom, invoiceDateTo, currentPage, pageSize, approvedByFilter]);

  useEffect(() => {
    void refreshIngestionStatus();
  }, []);

  useEffect(() => {
    setPopupSourcePreviewExpanded(false);
  }, [popupInvoiceId]);

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
    if (!ingestionStatus?.running) {
      return undefined;
    }

    const unsub = subscribeIngestionSSE(
      (status) => {
        setIngestionStatus(status);
        void loadInvoices();
      },
      () => {
        void refreshIngestionStatus();
      }
    );

    return unsub;
  }, [ingestionStatus?.running]);

  useEffect(() => {
    const isRunning = ingestionStatus?.running === true;
    if (ingestionWasRunningRef.current && !isRunning) {
      if (ingestionStatus?.state === "failed") {
        setError(ingestionStatus.error ? `Ingestion failed: ${ingestionStatus.error}` : "Ingestion failed.");
      }
      void loadInvoices();
      onGmailStatusRefresh();
    }
    ingestionWasRunningRef.current = isRunning;
  }, [ingestionStatus?.running, ingestionStatus?.state, ingestionStatus?.error]);

  useEffect(() => {
    if (ingestionStatus?.state !== "completed") {
      setIngestionFading(false);
      return;
    }
    const fadeTimer = setTimeout(() => setIngestionFading(true), 5000);
    const hideTimer = setTimeout(() => setIngestionStatus(null), 7000);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [ingestionStatus?.state]);

  useEffect(() => {
    if (ingestingIds.size === 0) return;
    const stillIngesting = new Set<string>();
    for (const id of ingestingIds) {
      const inv = invoices.find((i) => i._id === id);
      if (inv && inv.status === "PENDING") stillIngesting.add(id);
    }
    if (stillIngesting.size < ingestingIds.size) {
      setIngestingIds(stillIngesting);
      if (stillIngesting.size > 0 && !ingestionStatus?.running) {
        void runIngestion().then((s) => setIngestionStatus(s)).catch(() => { addToast("error", "Ingestion retry failed."); });
      }
    }
  }, [invoices]);

  const activeInvoiceSummary = useMemo(
    () => invoices.find((invoice) => invoice._id === activeId) ?? null,
    [activeId, invoices]
  );
  const activeInvoice = useMemo(
    () => selectNewerInvoice(activeInvoiceDetail, activeInvoiceSummary),
    [activeInvoiceDetail, activeInvoiceSummary]
  );

  const popupInvoiceSummary = useMemo(
    () => invoices.find((invoice) => invoice._id === popupInvoiceId) ?? null,
    [invoices, popupInvoiceId]
  );
  const popupInvoice = useMemo(
    () => selectNewerInvoice(popupInvoiceDetail, popupInvoiceSummary),
    [popupInvoiceDetail, popupInvoiceSummary]
  );

  const activeOverlayUrlByField = useMemo(() => {
    if (!activeInvoice) {
      return {};
    }
    return buildFieldOverlayUrlMap(
      activeInvoice._id,
      getInvoiceSourceHighlights(activeInvoice),
      getInvoiceFieldOverlayUrl
    );
  }, [activeInvoice]);

  const popupExtractedRows = useMemo(
    () => (popupInvoice ? getExtractedFieldRows(popupInvoice) : []),
    [popupInvoice]
  );

  const popupTallyMappings = useMemo(
    () => (popupInvoice ? getInvoiceTallyMappings(popupInvoice) : []),
    [popupInvoice]
  );

  const popupCropUrlByField = useMemo(() => {
    if (!popupInvoice) {
      return {};
    }
    return buildFieldCropUrlMap(popupInvoice._id, getInvoiceSourceHighlights(popupInvoice), getInvoiceBlockCropUrl);
  }, [popupInvoice]);

  const popupOverlayUrlByField = useMemo(() => {
    if (!popupInvoice) {
      return {};
    }
    return buildFieldOverlayUrlMap(
      popupInvoice._id,
      getInvoiceSourceHighlights(popupInvoice),
      getInvoiceFieldOverlayUrl
    );
  }, [popupInvoice]);

  const ingestionProgressPercent = useMemo(() => {
    if (!ingestionStatus || ingestionStatus.totalFiles <= 0) return 0;
    return Math.min(100, Math.round((ingestionStatus.processedFiles / ingestionStatus.totalFiles) * 100));
  }, [ingestionStatus]);

  const ingestionSuccessfulFiles = useMemo(() => {
    if (!ingestionStatus) return 0;
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

  const selectedRetryableIds = useMemo(
    () => selectedInvoices.filter((invoice) => isInvoiceRetryable(invoice)).map((invoice) => invoice._id),
    [selectedInvoices]
  );

  const selectedNonExportableCount = useMemo(
    () => selectedInvoices.filter((invoice) => !isInvoiceExportable(invoice)).length,
    [selectedInvoices]
  );

  const filteredInvoices = useMemo(() => {
    if (!debouncedSearch.trim()) {
      return invoices;
    }
    const q = debouncedSearch.trim().toLowerCase();
    return invoices.filter(
      (invoice) =>
        invoice.attachmentName.toLowerCase().includes(q) ||
        (invoice.parsed?.vendorName ?? "").toLowerCase().includes(q) ||
        (invoice.parsed?.invoiceNumber ?? "").toLowerCase().includes(q)
    );
  }, [invoices, debouncedSearch]);

  const selectableVisibleIds = useMemo(
    () => filteredInvoices.filter((invoice) => isInvoiceSelectable(invoice)).map((invoice) => invoice._id),
    [filteredInvoices]
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
    return "content";
  }, [detailsPanelVisible]);

  const contentStyle = useMemo(() => {
    if (!detailsPanelVisible) return undefined;
    return { gridTemplateColumns: `${listPanelPercent}% 6px 1fr` };
  }, [detailsPanelVisible, listPanelPercent]);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = contentRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startPercent = listPanelPercent;
    const containerWidth = container.getBoundingClientRect().width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const pctDelta = (delta / containerWidth) * 100;
      setListPanelPercent(Math.min(75, Math.max(25, startPercent + pctDelta)));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [listPanelPercent]);

  async function loadInvoices() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchInvoices(
        statusFilter === "ALL" ? undefined : statusFilter,
        invoiceDateFrom || undefined,
        invoiceDateTo || undefined,
        currentPage,
        pageSize,
        approvedByFilter || undefined
      );
      setInvoices(data.items);
      setTotalInvoices(data.total);
      onNavCountsChange({
        total: data.totalAll ?? data.total,
        approved: data.approvedAll ?? 0,
        pending: data.pendingAll ?? 0
      });
      if (statusFilter === "ALL") {
        const counts: Record<string, number> = { ALL: data.total };
        for (const inv of data.items) {
          counts[inv.status] = (counts[inv.status] ?? 0) + 1;
        }
        setAllStatusCounts(counts);
      }
      const ids = new Set(data.items.map((item) => item._id));
      setSelectedIds((currentSelectedIds) => mergeSelectedIds(currentSelectedIds, data.items));
      if (activeId && !ids.has(activeId)) {
        setActiveId(data.items[0]?._id ?? null);
      }
      if (popupInvoiceId && !ids.has(popupInvoiceId)) {
        setPopupInvoiceId(null);
      }
      if (activeId && ids.has(activeId)) {
        void refreshActiveInvoiceDetail();
      }
      if (popupInvoiceId && ids.has(popupInvoiceId)) {
        void refreshPopupInvoiceDetail();
      }
    } catch (loadError) {
      if (isAuthenticationError(loadError)) {
        onSessionExpired();
      } else {
        setError(getUserFacingErrorMessage(loadError, "Failed to fetch invoices."));
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshIngestionStatus() {
    try {
      const status = await fetchIngestionStatus();
      setIngestionStatus(status);
    } catch {
    }
  }

  async function handleApprove() {
    if (selectedApprovableIds.length === 0) {
      setError("Select at least one PARSED or NEEDS_REVIEW invoice to approve.");
      return;
    }
    try {
      setError(null);
      setActionLoading("approve");
      const response = await approveInvoices(selectedApprovableIds, userEmail);
      if (response.modifiedCount === 0) {
        setError("No selected invoices were eligible for approval.");
        return;
      }
      addToast("success", `${response.modifiedCount} invoice(s) approved.`);
      await loadInvoices();
    } catch (approveError) {
      addToast("error", getUserFacingErrorMessage(approveError, "Approval failed."));
      setError(getUserFacingErrorMessage(approveError, "Approval failed."));
    } finally {
      setActionLoading(null);
    }
  }

  function handleDelete() {
    if (selectedIds.length === 0) return;
    setConfirmDialog({
      title: "Delete Invoices",
      message: `Delete ${selectedIds.length} invoice${selectedIds.length === 1 ? "" : "s"}? This cannot be undone.`,
      confirmLabel: `Delete ${selectedIds.length} invoice${selectedIds.length === 1 ? "" : "s"}`,
      destructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setError(null);
          setActionLoading("delete");
          const response = await deleteInvoices(selectedIds);
          if (response.deletedCount === 0) {
            setError("No selected invoices were eligible for deletion (exported invoices cannot be deleted).");
            return;
          }
          addToast("success", `${response.deletedCount} invoice(s) deleted.`);
          setSelectedIds([]);
          await loadInvoices();
        } catch (deleteError) {
          addToast("error", getUserFacingErrorMessage(deleteError, "Deletion failed."));
          setError(getUserFacingErrorMessage(deleteError, "Deletion failed."));
        } finally {
          setActionLoading(null);
        }
      }
    });
  }

  async function handleApproveSingle(invoiceId: string) {
    try {
      setError(null);
      const response = await approveInvoices([invoiceId], userEmail);
      if (response.modifiedCount === 0) {
        setError("Invoice was not eligible for approval.");
        return;
      }
      await loadInvoices();
    } catch (approveError) {
      setError(getUserFacingErrorMessage(approveError, "Approval failed."));
    }
  }

  async function handleRetrySingle(invoiceId: string) {
    setIngestingIds((prev) => new Set(prev).add(invoiceId));
    try {
      setError(null);
      const response = await retryInvoices([invoiceId]);
      if (response.modifiedCount === 0) {
        setError("Invoice was not eligible for retry.");
        setIngestingIds((prev) => { const next = new Set(prev); next.delete(invoiceId); return next; });
        return;
      }
      if (ingestionStatus?.running) {
        return;
      }
      const status = await runIngestion();
      setIngestionStatus(status);
      if (!status.running) {
        setIngestingIds((prev) => { const next = new Set(prev); next.delete(invoiceId); return next; });
        await loadInvoices();
      }
    } catch (retryError) {
      setError(getUserFacingErrorMessage(retryError, "Retry failed."));
      setIngestingIds((prev) => { const next = new Set(prev); next.delete(invoiceId); return next; });
    }
  }

  function handleDeleteSingle(invoiceId: string, fileName: string) {
    setConfirmDialog({
      title: "Delete Invoice",
      message: `Delete "${fileName}"? This cannot be undone.`,
      confirmLabel: "Delete invoice",
      destructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setError(null);
          const response = await deleteInvoices([invoiceId]);
          if (response.deletedCount === 0) {
            setError("Invoice could not be deleted (exported invoices cannot be deleted).");
            return;
          }
          addToast("success", `"${fileName}" deleted.`);
          setSelectedIds((current) => current.filter((id) => id !== invoiceId));
          await loadInvoices();
        } catch (deleteError) {
          addToast("error", getUserFacingErrorMessage(deleteError, "Deletion failed."));
          setError(getUserFacingErrorMessage(deleteError, "Deletion failed."));
        }
      }
    });
  }

  async function handleRetry() {
    if (selectedRetryableIds.length === 0) {
      setError("Select at least one non-exported invoice to retry.");
      return;
    }
    try {
      setError(null);
      const response = await retryInvoices(selectedRetryableIds);
      if (response.modifiedCount === 0) {
        setError("No selected invoices were eligible for retry.");
        return;
      }
      setSelectedIds([]);
      await loadInvoices();
    } catch (retryError) {
      setError(getUserFacingErrorMessage(retryError, "Retry failed."));
    }
  }

  function handleExport() {
    if (selectedExportableIds.length === 0) {
      setError("Select at least one APPROVED invoice before export.");
      return;
    }
    if (selectedNonExportableCount > 0) {
      setError("Only APPROVED invoices can be exported. Deselect non-approved invoices and retry.");
      return;
    }
    setConfirmDialog({
      title: "Export to Tally",
      message: `Export ${selectedExportableIds.length} approved invoice file${selectedExportableIds.length === 1 ? "" : "s"} to Tally?`,
      confirmLabel: `Export ${selectedExportableIds.length} invoice${selectedExportableIds.length === 1 ? "" : "s"}`,
      destructive: false,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setError(null);
          setActionLoading("export");
          const exportResult = await exportToTally(selectedExportableIds);
          const successfullyExportedIds = exportResult.items
            .filter((item) => item.success)
            .map((item) => item.invoiceId);
          addToast("success", `${successfullyExportedIds.length} invoice(s) exported to Tally.`);
          setSelectedIds((currentSelectedIds) => removeSelectedIds(currentSelectedIds, successfullyExportedIds));
          await loadInvoices();
        } catch (exportError) {
          addToast("error", getUserFacingErrorMessage(exportError, "Export failed."));
          setError(getUserFacingErrorMessage(exportError, "Export failed."));
        } finally {
          setActionLoading(null);
        }
      }
    });
  }

  async function handleDownloadXml() {
    if (selectedExportableIds.length === 0) {
      setError("Select at least one APPROVED invoice before generating XML.");
      return;
    }
    if (selectedNonExportableCount > 0) {
      setError("Only APPROVED invoices can be exported. Deselect non-approved invoices and retry.");
      return;
    }
    try {
      setError(null);
      const fileResult = await generateTallyXmlFile(selectedExportableIds);
      if (!fileResult.batchId) {
        setError("No approved invoices found for export.");
        return;
      }
      const blob = await downloadTallyXmlFile(fileResult.batchId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileResult.filename ?? "tally-import.xml";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      const exportedIds = selectedExportableIds.filter(
        (id) => !fileResult.skippedItems.some((item) => item.invoiceId === id)
      );
      setSelectedIds((currentSelectedIds) => removeSelectedIds(currentSelectedIds, exportedIds));
      await loadInvoices();
    } catch (downloadError) {
      setError(getUserFacingErrorMessage(downloadError, "XML file generation failed."));
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    try {
      setError(null);
      await uploadInvoiceFiles(Array.from(files));
      await loadInvoices();
      const status = await runIngestion();
      setIngestionStatus(status);
    } catch (uploadError) {
      setError(getUserFacingErrorMessage(uploadError, "File upload failed."));
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function handleIngest() {
    try {
      setError(null);
      const status = await runIngestion();
      setIngestionStatus(status);
    } catch (ingestError) {
      setError(getUserFacingErrorMessage(ingestError, "Ingestion run failed."));
    }
  }

  async function handlePauseIngestion() {
    try {
      setError(null);
      const status = await pauseIngestion();
      setIngestionStatus(status);
    } catch (pauseError) {
      setError(getUserFacingErrorMessage(pauseError, "Failed to pause ingestion."));
    }
  }

  async function handleSaveField(
    invoice: Invoice | null,
    fieldKey: string,
    value: string,
    refreshDetail: () => Promise<void>
  ) {
    if (!invoice) return;
    const trimmed = value.trim();
    const parsed: Record<string, string | null> = {};
    if (fieldKey === "totalAmountMinor") {
      parsed.totalAmountMajor = trimmed || null;
    } else if (fieldKey === "currency") {
      parsed.currency = trimmed ? trimmed.toUpperCase() : null;
    } else {
      parsed[fieldKey] = trimmed || null;
    }
    try {
      await updateInvoiceParsedFields(invoice._id, { parsed, updatedBy: "ui-user" });
      await loadInvoices();
      await refreshDetail();
    } catch (saveError) {
      setError(getUserFacingErrorMessage(saveError, "Failed to save field."));
    }
  }

  async function handleSaveListCell() {
    if (!editingListCell) return;
    const { invoiceId, field } = editingListCell;
    const trimmed = editListValue.trim();
    try {
      if (field === "attachmentName") {
        if (trimmed) await renameInvoiceAttachment(invoiceId, trimmed);
      } else {
        const parsed: Record<string, string | null> = {};
        if (field === "totalAmountMinor") {
          parsed.totalAmountMajor = trimmed || null;
        } else {
          parsed[field] = trimmed || null;
        }
        await updateInvoiceParsedFields(invoiceId, { parsed, updatedBy: "ui-user" });
      }
      setEditingListCell(null);
      await loadInvoices();
      if (activeId === invoiceId) {
        await refreshActiveInvoiceDetail();
      }
    } catch (saveError) {
      setError(getUserFacingErrorMessage(saveError, "Failed to save field."));
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

  const hasActiveFilters = searchQuery.trim() !== "" || invoiceDateFrom !== "" || invoiceDateTo !== "" || statusFilter !== "ALL";

  function clearAllFilters() {
    setSearchQuery("");
    setInvoiceDateFrom("");
    setInvoiceDateTo("");
    setStatusFilter("ALL");
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-filter-group">
          <input
            type="text"
            className="search-input"
            placeholder="Search by file, vendor, or invoice #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <input
            type="date"
            style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}
            value={invoiceDateFrom}
            max={invoiceDateTo || undefined}
            onChange={(e) => setInvoiceDateFrom(e.target.value)}
            title="Filter from date"
          />
          <input
            type="date"
            style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}
            value={invoiceDateTo}
            min={invoiceDateFrom || undefined}
            onChange={(e) => setInvoiceDateTo(e.target.value)}
            title="Filter to date"
          />
        </div>
        <div className="toolbar-divider" />
        <div className="status-tabs">
          {STATUSES.map((status) => (
            <button
              key={status}
              className={status === statusFilter ? "tab tab-active" : "tab"}
              onClick={() => setStatusFilter(status)}
            >
              {STATUS_LABELS[status] ?? status}
              {allStatusCounts[status] != null ? <span className="tab-count">{allStatusCounts[status]}</span> : null}
            </button>
          ))}
        </div>
        {hasActiveFilters ? (
          <button type="button" className="clear-filters-pill" onClick={clearAllFilters}>
            <span className="material-symbols-outlined" style={{ fontSize: "0.85rem" }}>close</span>
            Clear filters
          </button>
        ) : null}
        {isTenantAdmin && tenantUsers && tenantUsers.length > 0 ? (
          <>
            <div className="toolbar-divider" />
            <select className="search-input" style={{ flex: "none", minWidth: "auto", width: "auto" }} value={approvedByFilter} onChange={(e) => setApprovedByFilter(e.target.value)}>
              <option value="">All Users</option>
              {tenantUsers.map((u) => <option key={u.userId} value={u.userId}>{u.email}</option>)}
            </select>
          </>
        ) : null}
        {!isViewer ? (
          <>
            <div className="toolbar-divider" />
            <span className="toolbar-icon-wrap">
              <button type="button" className={`toolbar-icon-button${actionLoading === "approve" ? " app-button-loading" : ""}`} onClick={() => void handleApprove()} disabled={requiresTenantSetup || selectedApprovableIds.length === 0}>
                <span className="material-symbols-outlined">check_circle</span>
              </button>
              <span className="toolbar-icon-label">Approve</span>
            </span>
            <span className="toolbar-icon-wrap">
              <button type="button" className={`toolbar-icon-button${actionLoading === "delete" ? " app-button-loading" : ""}`} onClick={handleDelete} disabled={requiresTenantSetup || selectedIds.length === 0}>
                <span className="material-symbols-outlined">delete</span>
              </button>
              <span className="toolbar-icon-label">Delete</span>
            </span>
            <span className="toolbar-icon-wrap">
              <button type="button" className="toolbar-icon-button" onClick={() => void handleRetry()} disabled={requiresTenantSetup || selectedRetryableIds.length === 0}>
                <span className="material-symbols-outlined">replay</span>
              </button>
              <span className="toolbar-icon-label">Retry</span>
            </span>
            <span className="toolbar-icon-wrap">
              <button type="button" className={`toolbar-icon-button${actionLoading === "export" ? " app-button-loading" : ""}`} onClick={handleExport} disabled={requiresTenantSetup || selectedExportableIds.length === 0 || selectedNonExportableCount > 0}>
                <span className="material-symbols-outlined">upload</span>
              </button>
              <span className="toolbar-icon-label">Export to Tally</span>
            </span>
            <span className="toolbar-icon-wrap">
              <button type="button" className="toolbar-icon-button" onClick={() => void handleDownloadXml()} disabled={requiresTenantSetup || selectedExportableIds.length === 0 || selectedNonExportableCount > 0}>
                <span className="material-symbols-outlined">download</span>
              </button>
              <span className="toolbar-icon-label">Download XML</span>
            </span>
            <span className="toolbar-icon-wrap">
              <button type="button" className="toolbar-icon-button" onClick={() => uploadInputRef.current?.click()} disabled={requiresTenantSetup}>
                <span className="material-symbols-outlined">upload_file</span>
              </button>
              <span className="toolbar-icon-label">Upload</span>
            </span>
            <input ref={uploadInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{ display: "none" }} onChange={(e) => void handleUpload(e)} />
            <span className="toolbar-icon-wrap">
              <button type="button" className="toolbar-icon-button" onClick={() => void handleIngest()} disabled={requiresTenantSetup || ingestionStatus?.running === true}>
                <span className="material-symbols-outlined">play_arrow</span>
              </button>
              <span className="toolbar-icon-label">{ingestionStatus?.state === "paused" ? "Resume" : "Ingest"}</span>
            </span>
            {ingestionStatus?.running === true ? (
              <span className="toolbar-icon-wrap">
                <button type="button" className="toolbar-icon-button" onClick={() => void handlePauseIngestion()}>
                  <span className="material-symbols-outlined">pause</span>
                </button>
                <span className="toolbar-icon-label">Pause</span>
              </span>
            ) : null}
          </>
        ) : null}
        <span className="toolbar-icon-wrap">
          <button type="button" className="toolbar-icon-button" onClick={() => setDetailsPanelVisible((currentValue) => !currentValue)}>
            <span className="material-symbols-outlined">{detailsPanelVisible ? "visibility_off" : "visibility"}</span>
          </button>
          <span className="toolbar-icon-label">{detailsPanelVisible ? "Hide panel" : "Show panel"}</span>
        </span>
      </div>
      <IngestionProgressCard
        status={ingestionStatus}
        progressPercent={ingestionProgressPercent}
        successfulFiles={ingestionSuccessfulFiles}
        fading={ingestionFading}
      />
      {error ? <p className="error">{error}</p> : null}
      <main ref={contentRef} className={contentClassName} style={contentStyle}>
        <>
          <section className="panel list-panel">
            <div className="panel-title">
              <h2>Invoices</h2>
              {loading ? <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>Loading...</span> : <span>{invoices.length} records</span>}
            </div>

            {loading && invoices.length === 0 ? (
              <div style={{ padding: "1rem" }}>
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
              </div>
            ) : null}

            <div className={`list-scroll${loading && invoices.length > 0 ? " list-scroll-loading" : ""}`}>
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={areAllVisibleSelectableSelected && selectableVisibleIds.length > 0} disabled={selectableVisibleIds.length === 0} onChange={toggleSelectAllVisible} /></th>
                    <th>File</th>
                    <th>Vendor</th>
                    <th>Invoice #</th>
                    <th>Invoice Date</th>
                    <th>Total</th>
                    <th>Confidence</th>
                    <th>Status</th>
                    <th>Received</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((invoice) => {
                    const rowClasses = [
                      invoice._id === activeId ? "row-active" : null,
                      invoice.status === "EXPORTED" ? "row-exported" : null
                    ]
                      .filter(Boolean)
                      .join(" ");
                    const canEditCell = invoice.status !== "EXPORTED";

                    return (
                      <tr key={invoice._id} className={rowClasses || undefined} onClick={() => { setActiveId(invoice._id); setDetailsPanelVisible(true); }}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(invoice._id)}
                            disabled={!isInvoiceSelectable(invoice)}
                            onChange={() => toggleSelection(invoice)}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </td>
                        <td className="file-name-cell">
                          {editingListCell?.invoiceId === invoice._id && editingListCell.field === "attachmentName" ? (
                            <>
                              <input className="extracted-value-input" value={editListValue} onChange={(e) => setEditListValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveListCell(); if (e.key === "Escape") setEditingListCell(null); }} autoFocus />
                              <button type="button" className="field-save-button" onClick={() => void handleSaveListCell()}>&#10003;</button>
                            </>
                          ) : (
                            <>
                              <button type="button" className="file-label" onClick={(event) => { event.stopPropagation(); setPopupInvoiceId(invoice._id); }}>{invoice.attachmentName}</button>
                              {canEditCell && (
                                <button type="button" className="row-action-button file-rename-button" title="Rename" onClick={() => { setEditingListCell({ invoiceId: invoice._id, field: "attachmentName" }); setEditListValue(invoice.attachmentName); }}>
                                  <span className="material-symbols-outlined">edit</span>
                                </button>
                              )}
                            </>
                          )}
                        </td>
                        <td className="extracted-value-cell">
                          {editingListCell?.invoiceId === invoice._id && editingListCell.field === "vendorName" ? (
                            <>
                              <input className="extracted-value-input" value={editListValue} onChange={(e) => setEditListValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveListCell(); if (e.key === "Escape") setEditingListCell(null); }} autoFocus />
                              <button type="button" className="field-save-button" onClick={() => void handleSaveListCell()}>&#10003;</button>
                            </>
                          ) : (
                            <>
                              <span className="extracted-value-display">{invoice.parsed?.vendorName ?? "-"}</span>
                              {canEditCell && (
                                <button type="button" className="row-action-button field-edit-button" title="Edit vendor" onClick={() => { setEditingListCell({ invoiceId: invoice._id, field: "vendorName" }); setEditListValue(invoice.parsed?.vendorName ?? ""); }}>
                                  <span className="material-symbols-outlined">edit</span>
                                </button>
                              )}
                            </>
                          )}
                        </td>
                        <td className="extracted-value-cell">
                          {editingListCell?.invoiceId === invoice._id && editingListCell.field === "invoiceNumber" ? (
                            <>
                              <input className="extracted-value-input" value={editListValue} onChange={(e) => setEditListValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveListCell(); if (e.key === "Escape") setEditingListCell(null); }} autoFocus />
                              <button type="button" className="field-save-button" onClick={() => void handleSaveListCell()}>&#10003;</button>
                            </>
                          ) : (
                            <>
                              <span className="extracted-value-display">{invoice.parsed?.invoiceNumber ?? "-"}</span>
                              {canEditCell && (
                                <button type="button" className="row-action-button field-edit-button" title="Edit invoice number" onClick={() => { setEditingListCell({ invoiceId: invoice._id, field: "invoiceNumber" }); setEditListValue(invoice.parsed?.invoiceNumber ?? ""); }}>
                                  <span className="material-symbols-outlined">edit</span>
                                </button>
                              )}
                            </>
                          )}
                        </td>
                        <td className="extracted-value-cell">
                          {editingListCell?.invoiceId === invoice._id && editingListCell.field === "invoiceDate" ? (
                            <>
                              <input className="extracted-value-input" type="date" value={editListValue} onChange={(e) => setEditListValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveListCell(); if (e.key === "Escape") setEditingListCell(null); }} autoFocus />
                              <button type="button" className="field-save-button" onClick={() => void handleSaveListCell()}>&#10003;</button>
                            </>
                          ) : (
                            <>
                              <span className="extracted-value-display">{invoice.parsed?.invoiceDate ?? "-"}</span>
                              {canEditCell && (
                                <button type="button" className="row-action-button field-edit-button" title="Edit date" onClick={() => { setEditingListCell({ invoiceId: invoice._id, field: "invoiceDate" }); setEditListValue(invoice.parsed?.invoiceDate ?? ""); }}>
                                  <span className="material-symbols-outlined">edit</span>
                                </button>
                              )}
                            </>
                          )}
                        </td>
                        <td
                          className={
                            [invoice.riskFlags.includes("TOTAL_AMOUNT_ABOVE_EXPECTED") ? "value-risk" : null, "extracted-value-cell"].filter(Boolean).join(" ")
                          }
                        >
                          {editingListCell?.invoiceId === invoice._id && editingListCell.field === "totalAmountMinor" ? (
                            <>
                              <input className="extracted-value-input" value={editListValue} onChange={(e) => setEditListValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveListCell(); if (e.key === "Escape") setEditingListCell(null); }} autoFocus />
                              <button type="button" className="field-save-button" onClick={() => void handleSaveListCell()}>&#10003;</button>
                            </>
                          ) : (
                            <>
                              <span className="extracted-value-display">{formatMinorAmountWithCurrency(invoice.parsed?.totalAmountMinor, invoice.parsed?.currency)}</span>
                              {canEditCell && (
                                <button type="button" className="row-action-button field-edit-button" title="Edit amount" onClick={() => { setEditingListCell({ invoiceId: invoice._id, field: "totalAmountMinor" }); setEditListValue(invoice.parsed?.totalAmountMinor != null ? String(invoice.parsed.totalAmountMinor / 100) : ""); }}>
                                  <span className="material-symbols-outlined">edit</span>
                                </button>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          <ConfidenceBadge score={invoice.confidenceScore ?? 0} />
                        </td>
                        <td>
                          {ingestingIds.has(invoice._id) ? (
                            <span className="status status-reprocessing">Reprocessing</span>
                          ) : (
                            <span className={`status status-${invoice.status.toLowerCase()}`} title={invoice.approval?.approvedBy ? `Approved by ${invoice.approval.approvedBy}` : undefined}>
                              {STATUS_ICONS[invoice.status] ? <span className="material-symbols-outlined status-badge-icon">{STATUS_ICONS[invoice.status]}</span> : null}
                              {STATUS_LABELS[invoice.status] ?? invoice.status}
                            </span>
                          )}
                          {invoice.possibleDuplicate ? (
                            <span className="material-symbols-outlined duplicate-warning" title="Possible duplicate — another invoice has identical file contents">warning</span>
                          ) : null}
                        </td>
                        <td>{new Date(invoice.receivedAt).toLocaleString()}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const actions = getAvailableRowActions(invoice);
                            const ingesting = ingestingIds.has(invoice._id);
                            return (
                              <>
                                {actions.includes("approve") && !ingesting && (
                                  <button type="button" className="row-action-button row-action-approve" title="Approve" onClick={() => void handleApproveSingle(invoice._id)}>
                                    <span className="material-symbols-outlined">check_circle</span>
                                  </button>
                                )}
                                {actions.includes("reingest") && !ingesting && (
                                  <button type="button" className="row-action-button row-action-retry" title="Reingest" onClick={() => void handleRetrySingle(invoice._id)}>
                                    <span className="material-symbols-outlined">replay</span>
                                  </button>
                                )}
                                {actions.includes("delete") && !ingesting && (
                                  <button type="button" className="row-action-button" title="Delete" onClick={() => handleDeleteSingle(invoice._id, invoice.attachmentName)}>
                                    <span className="material-symbols-outlined">delete</span>
                                  </button>
                                )}
                              </>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalInvoices > 0 ? (
              <div className="pagination-bar">
                <div className="pagination-info">
                  {Math.min((currentPage - 1) * pageSize + 1, totalInvoices)}–{Math.min(currentPage * pageSize, totalInvoices)} of {totalInvoices}
                </div>
                <div className="pagination-controls">
                  <button type="button" className="app-button app-button-secondary app-button-sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>First</button>
                  <button type="button" className="app-button app-button-secondary app-button-sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>Prev</button>
                  <span className="pagination-page">Page {currentPage} of {Math.max(1, Math.ceil(totalInvoices / pageSize))}</span>
                  <button type="button" className="app-button app-button-secondary app-button-sm" disabled={currentPage >= Math.ceil(totalInvoices / pageSize)} onClick={() => setCurrentPage((p) => p + 1)}>Next</button>
                  <button type="button" className="app-button app-button-secondary app-button-sm" disabled={currentPage >= Math.ceil(totalInvoices / pageSize)} onClick={() => setCurrentPage(Math.ceil(totalInvoices / pageSize))}>Last</button>
                </div>
                <div className="pagination-size">
                  <span>Rows:</span>
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
            ) : null}
          </section>

          {detailsPanelVisible ? (
            <>
              <div className="panel-divider" onMouseDown={handleDividerMouseDown} />
              <section className="panel detail-panel">
                <div className="panel-title">
                  <h2>Invoice Details</h2>
                  <button
                    type="button"
                    className="collapse-button"
                    onClick={() => setDetailsPanelVisible(false)}
                    aria-label="Close details panel"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                {activeInvoice ? (
                  <div className="detail-scroll">
                    {activeInvoiceDetailLoading ? <p className="muted">Loading full invoice details...</p> : null}
                    <InvoiceSourceViewer
                      invoice={activeInvoice}
                      overlayUrlByField={activeOverlayUrlByField}
                      resolvePreviewUrl={(page) => getInvoicePreviewUrl(activeInvoice._id, page)}
                    />
                  </div>
                ) : (
                  <p className="muted">Select an invoice to inspect details.</p>
                )}
              </section>
            </>
          ) : null}
        </>
      </main>

      <ConfirmDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ""}
        message={confirmDialog?.message ?? ""}
        confirmLabel={confirmDialog?.confirmLabel ?? "Confirm"}
        destructive={confirmDialog?.destructive ?? false}
        onConfirm={() => confirmDialog?.onConfirm()}
        onCancel={() => setConfirmDialog(null)}
      />

      {popupInvoice ? (
        <div className="popup-overlay" role="presentation" onClick={() => setPopupInvoiceId(null)}>
          <section
            className="popup-card"
            role="dialog"
            aria-modal="true"
            aria-label={`Invoice file details for ${popupInvoice.attachmentName}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="popup-header">
              <h2>File Details: {popupInvoice.attachmentName}</h2>
              <button type="button" onClick={() => setPopupInvoiceId(null)}>
                Close
              </button>
            </div>
            <p className="muted popup-meta">
              Status: <strong>{popupInvoice.status}</strong> | Received: {new Date(popupInvoice.receivedAt).toLocaleString()}
            </p>
            <div className="popup-content">
              {popupInvoiceDetailLoading ? <p className="muted">Loading full invoice details...</p> : null}
              <div className="source-preview-section">
                <button
                  type="button"
                  className="source-preview-toggle"
                  onClick={() => setPopupSourcePreviewExpanded((currentValue) => !currentValue)}
                >
                  {popupSourcePreviewExpanded ? "Hide Source Preview" : "Show Source Preview"}
                </button>
                {popupSourcePreviewExpanded ? (
                  <InvoiceSourceViewer
                    invoice={popupInvoice}
                    overlayUrlByField={popupOverlayUrlByField}
                    resolvePreviewUrl={(page) => getInvoicePreviewUrl(popupInvoice._id, page)}
                  />
                ) : null}
              </div>
              <div>
                <h3>Extracted Invoice Fields</h3>
                <ExtractedFieldsTable rows={popupExtractedRows} cropUrlByField={popupCropUrlByField} editable={popupInvoice?.status !== "EXPORTED"} onSaveField={(fieldKey, value) => handleSaveField(popupInvoice, fieldKey, value, refreshPopupInvoiceDetail)} />
              </div>
              {popupInvoice.ocrText && tenantMode !== "live" ? (
                <div>
                  <button
                    type="button"
                    className="source-preview-toggle"
                    onClick={() => setPopupRawOcrExpanded((v) => !v)}
                  >
                    {popupRawOcrExpanded ? "Hide Raw OCR Text" : "Show Raw OCR Text"}
                  </button>
                  {popupRawOcrExpanded ? (
                    <pre className="raw-ocr-text">{popupInvoice.ocrText}</pre>
                  ) : null}
                </div>
              ) : null}
              <div>
                <button
                  type="button"
                  className="source-preview-toggle"
                  onClick={() => setPopupMappingExpanded((currentValue) => !currentValue)}
                >
                  {popupMappingExpanded ? "Hide Export Mapping" : "Show Export Mapping"}
                </button>
                {popupMappingExpanded ? <TallyMappingTable rows={popupTallyMappings} /> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
