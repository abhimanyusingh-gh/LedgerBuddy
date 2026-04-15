import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  approveInvoices,
  approveWorkflowStep,
  deleteInvoices,
  downloadTallyXmlFile,
  generateTallyXmlFile,
  retryInvoices,
  rejectWorkflowStep,
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
  uploadInvoiceFiles,
  requestPresignedUrls,
  registerUploadedKeys
} from "@/api";
import type { IngestionJobStatus, Invoice, TenantRole, UserCapabilities } from "@/types";
import { ConfidenceBadge } from "@/components/invoice/ConfidenceBadge";
import { IngestionProgressCard } from "@/features/tenant-admin/IngestionProgressCard";
import { getExtractedFieldRows } from "@/lib/invoice/extractedFields";
import { getInvoiceSourceHighlights } from "@/lib/invoice/sourceHighlights";
import {
  getAvailableRowActions,
  isInvoiceApprovable,
  isInvoiceExportable,
  isInvoiceRetryable,
  isInvoiceSelectable,
  mergeSelectedIds,
  removeSelectedIds
} from "@/lib/common/selection";
import { getInvoiceTallyMappings } from "@/lib/invoice/tallyMapping";
import { formatMinorAmountWithCurrency } from "@/lib/common/currency";
import { fetchGlCodes, fetchTdsRates, updateInvoiceComplianceOverride } from "@/api";
import type { GlCode, TdsRate } from "@/types";
import {
  buildFieldCropUrlMap,
  buildFieldOverlayUrlMap,
  STATUS_LABELS,
  STATUSES
} from "@/lib/invoice/invoiceView";
import { useInvoiceDetail } from "@/hooks/useInvoiceDetail";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { getUserFacingErrorMessage, isAuthenticationError } from "@/lib/common/apiError";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { KeyboardShortcutsOverlay } from "@/components/common/KeyboardShortcutsOverlay";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { TenantInvoicesToolbar } from "@/features/tenant-admin/TenantInvoicesToolbar";
import { TenantInvoiceDetailPanel } from "@/features/tenant-admin/TenantInvoiceDetailPanel";
import { TenantInvoicePopup } from "@/features/tenant-admin/TenantInvoicePopup";
import { GlCodeDropdown } from "@/components/compliance/GlCodeDropdown";

function formatTaxSummary(invoice: { parsed?: { gst?: { cgstMinor?: number; sgstMinor?: number; igstMinor?: number; totalTaxMinor?: number }; currency?: string } }): string {
  const gst = invoice.parsed?.gst;
  if (!gst) return "-";
  const cur = invoice.parsed?.currency;
  if (gst.totalTaxMinor) return formatMinorAmountWithCurrency(gst.totalTaxMinor, cur);
  const sum = (gst.cgstMinor ?? 0) + (gst.sgstMinor ?? 0) + (gst.igstMinor ?? 0);
  return sum > 0 ? formatMinorAmountWithCurrency(sum, cur) : "-";
}

function formatApproverName(value?: string): string {
  if (!value) return "-";
  const atIdx = value.indexOf("@");
  if (atIdx <= 0) return value;
  return value.slice(0, atIdx).replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_ICONS: Record<string, string> = {
  PENDING: "hourglass_empty",
  PARSED: "task_alt",
  NEEDS_REVIEW: "flag",
  AWAITING_APPROVAL: "pending_actions",
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
  canViewAllInvoices: boolean;
  capabilities?: Partial<UserCapabilities>;
  requiresTenantSetup: boolean;
  tenantMode?: "test" | "live";
  tenantUsers?: Array<{ userId: string; email: string; role: TenantRole; enabled: boolean }>;
  onGmailStatusRefresh: () => void;
  onNavCountsChange: (counts: { total: number; approved: number; pending: number; failed: number }) => void;
  onSessionExpired: () => void;
  addToast: (type: "success" | "error" | "info", message: string) => void;
}

export function TenantInvoicesView({
  userEmail,
  canViewAllInvoices,
  capabilities = {},
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
  const [listPanelPercent, setListPanelPercent] = useState(() => {
    const stored = localStorage.getItem("billforge:panel-split");
    return stored ? Number(stored) : 58;
  });
  const contentRef = useRef<HTMLElement>(null);
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");
  const [ingestionStatus, setIngestionStatus] = useState<IngestionJobStatus | null>(null);
  const [ingestionFading, setIngestionFading] = useState(false);
  const [editingListCell, setEditingListCell] = useState<{ invoiceId: string; field: string } | null>(null);
  const [editListValue, setEditListValue] = useState("");
  const [glCodeEditingInvoiceId, setGlCodeEditingInvoiceId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumnRaw] = useState<string | null>(() => localStorage.getItem("billforge:sort-col"));
  const [sortDirection, setSortDirectionRaw] = useState<"asc" | "desc">(() => localStorage.getItem("billforge:sort-dir") === "desc" ? "desc" : "asc");
  const setSortColumn = (col: string) => { setSortColumnRaw(col); localStorage.setItem("billforge:sort-col", col); };
  const setSortDirection = (v: "asc" | "desc" | ((d: "asc" | "desc") => "asc" | "desc")) => { setSortDirectionRaw((prev) => { const next = typeof v === "function" ? v(prev) : v; localStorage.setItem("billforge:sort-dir", next); return next; }); };
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [tableDensity, setTableDensity] = useState<"compact" | "comfortable" | "spacious">(() => {
    const stored = localStorage.getItem("billforge:table-density");
    return stored === "compact" || stored === "spacious" ? stored : "comfortable";
  });
  const [tenantGlCodes, setTenantGlCodes] = useState<GlCode[]>([]);
  const [tenantTdsRates, setTenantTdsRates] = useState<TdsRate[]>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem("billforge:col-widths");
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });
  const [popupSourcePreviewExpanded, setPopupSourcePreviewExpanded] = useState(false);
  const [popupExtractedFieldsExpanded, setPopupExtractedFieldsExpanded] = useState(true);
  const [popupLineItemsExpanded, setPopupLineItemsExpanded] = useState(false);
  const [popupRawOcrExpanded, setPopupRawOcrExpanded] = useState(false);
  const [popupMappingExpanded, setPopupMappingExpanded] = useState(false);
  const [activeSourcePreviewExpanded, setActiveSourcePreviewExpanded] = useState(false);
  const [activeExtractedFieldsExpanded, setActiveExtractedFieldsExpanded] = useState(true);
  const [activeLineItemsExpanded, setActiveLineItemsExpanded] = useState(false);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLElement>(null);
  const ingestionWasRunningRef = useRef(false);
  const sseLoadPendingRef = useRef(false);
  const sseLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; destructive: boolean; onConfirm: () => void } | null>(null);
  const [allStatusCounts, setAllStatusCounts] = useState<Record<string, number>>({});
  const [approvedByFilter, setApprovedByFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const canApproveInvoices = capabilities.canApproveInvoices === true;
  const canEditInvoiceFields = capabilities.canEditInvoiceFields === true;
  const canDeleteInvoices = capabilities.canDeleteInvoices === true;
  const canRetryInvoices = capabilities.canRetryInvoices === true;
  const canUploadFiles = capabilities.canUploadFiles === true;
  const canStartIngestion = capabilities.canStartIngestion === true;
  const canExportToTally = capabilities.canExportToTally === true;
  const canOverrideGlCode = capabilities.canOverrideGlCode === true;
  const canOverrideTds = capabilities.canOverrideTds === true;
  const canDismissRiskSignals = capabilities.canSignOffCompliance === true || canEditInvoiceFields;
  const canUseToolbarActions = canApproveInvoices || canDeleteInvoices || canRetryInvoices || canUploadFiles || canStartIngestion;

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

  const prevFiltersRef = useRef({ statusFilter, invoiceDateFrom, invoiceDateTo, pageSize, approvedByFilter, sortColumn, sortDirection });
  useEffect(() => {
    const prev = prevFiltersRef.current;
    const filtersChanged = prev.statusFilter !== statusFilter || prev.invoiceDateFrom !== invoiceDateFrom || prev.invoiceDateTo !== invoiceDateTo || prev.pageSize !== pageSize || prev.approvedByFilter !== approvedByFilter;
    prevFiltersRef.current = { statusFilter, invoiceDateFrom, invoiceDateTo, pageSize, approvedByFilter, sortColumn, sortDirection };
    if (invoiceDateFrom && invoiceDateTo && invoiceDateFrom > invoiceDateTo) {
      addToast("error", "Start date must be before end date");
      return;
    }
    if (invoiceDateTo) {
      const maxDate = new Date();
      maxDate.setFullYear(maxDate.getFullYear() + 1);
      const maxDateStr = maxDate.toISOString().slice(0, 10);
      if (invoiceDateTo > maxDateStr) {
        addToast("error", "End date cannot be more than one year from today");
        return;
      }
    }
    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
      return;
    }
    void loadInvoices();
  }, [statusFilter, invoiceDateFrom, invoiceDateTo, currentPage, pageSize, approvedByFilter, sortColumn, sortDirection]);

  useEffect(() => {
    void refreshIngestionStatus();
    fetchGlCodes().then(r => setTenantGlCodes(r.items)).catch(() => {});
    fetchTdsRates().then(r => setTenantTdsRates(r)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!popupInvoiceId) {
      return;
    }
    setPopupSourcePreviewExpanded(false);
    setPopupExtractedFieldsExpanded(true);
    setPopupLineItemsExpanded(false);
  }, [popupInvoiceId]);

  useEffect(() => {
    setActiveSourcePreviewExpanded(false);
    setActiveExtractedFieldsExpanded(true);
    setActiveLineItemsExpanded(false);
  }, [activeId]);

  useEffect(() => {
    if (!popupInvoiceId) {
      return undefined;
    }

    popupRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEsc(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPopupInvoiceId(null);
      }
    }

    window.addEventListener("keydown", handleEsc);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleEsc);
    };
  }, [popupInvoiceId]);

  useEffect(() => {
    if (!ingestionStatus?.running) {
      return undefined;
    }

    const unsub = subscribeIngestionSSE(
      (status) => {
        if (status.systemAlert) {
          addToast("error", status.systemAlert);
        }
        setIngestionStatus(status);
        if (!sseLoadTimerRef.current) {
          void loadInvoices();
          sseLoadTimerRef.current = setTimeout(() => {
            sseLoadTimerRef.current = null;
            if (sseLoadPendingRef.current) {
              sseLoadPendingRef.current = false;
              void loadInvoices();
            }
          }, 2000);
        } else {
          sseLoadPendingRef.current = true;
        }
      },
      () => {
        void refreshIngestionStatus();
        void loadInvoices();
      }
    );

    return () => {
      unsub();
      if (sseLoadTimerRef.current) {
        clearTimeout(sseLoadTimerRef.current);
        sseLoadTimerRef.current = null;
      }
    };
  }, [ingestionStatus?.running]);

  useEffect(() => {
    if (!ingestionStatus?.running) {
      return undefined;
    }
    const poller = window.setInterval(() => {
      void refreshIngestionStatus();
      void loadInvoices();
    }, 3000);
    return () => window.clearInterval(poller);
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

  const activeCropUrlByField = useMemo(() => {
    if (!activeInvoice) return {};
    return buildFieldCropUrlMap(activeInvoice._id, getInvoiceSourceHighlights(activeInvoice), getInvoiceBlockCropUrl);
  }, [activeInvoice]);

  const popupCropUrlByField = useMemo(() => {
    if (!popupInvoice) return {};
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

  useKeyboardShortcuts({
    enabled: !popupInvoiceId && !confirmDialog && !showShortcutsHelp,
    onMoveDown: () => {
      const idx = filteredInvoices.findIndex((inv) => inv._id === activeId);
      const next = filteredInvoices[idx + 1];
      if (next) {
        setActiveId(next._id);
        setDetailsPanelVisible(true);
        requestAnimationFrame(() => {
          document.querySelector(`[data-invoice-id="${next._id}"]`)?.scrollIntoView({ block: "nearest" });
        });
      }
    },
    onMoveUp: () => {
      const idx = filteredInvoices.findIndex((inv) => inv._id === activeId);
      const prev = filteredInvoices[idx - 1];
      if (prev) {
        setActiveId(prev._id);
        setDetailsPanelVisible(true);
        requestAnimationFrame(() => {
          document.querySelector(`[data-invoice-id="${prev._id}"]`)?.scrollIntoView({ block: "nearest" });
        });
      }
    },
    onToggleSelect: () => {
      if (!activeId) return;
      const inv = filteredInvoices.find((i) => i._id === activeId);
      if (inv) toggleSelection(inv);
    },
    onOpenDetail: () => { if (activeId) setPopupInvoiceId(activeId); },
    onApprove: () => { if (selectedApprovableIds.length > 0) void handleApprove(); },
    onExport: () => { if (selectedExportableIds.length > 0) handleExport(); },
    onEscape: () => {
      if (selectedIds.length > 0) { setSelectedIds([]); return; }
      if (detailsPanelVisible) { setDetailsPanelVisible(false); }
    },
    onShowHelp: () => setShowShortcutsHelp(true)
  });

  const handleColumnResize = useCallback((colKey: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).parentElement;
    if (!th) return;
    const startX = e.clientX;
    const startWidth = th.offsetWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(60, startWidth + ev.clientX - startX);
      setColumnWidths((prev) => {
        const next = { ...prev, [colKey]: newWidth };
        localStorage.setItem("billforge:col-widths", JSON.stringify(next));
        return next;
      });
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

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
      localStorage.setItem("billforge:panel-split", String(listPanelPercent));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [listPanelPercent]);

  async function loadInvoices() {
    setLoading(true);
    setError(null);
    try {
      const statusParam = statusFilter === "ALL" ? undefined
        : statusFilter === "FAILED" ? "FAILED_OCR,FAILED_PARSE"
        : statusFilter;
      const data = await fetchInvoices(
        statusParam,
        invoiceDateFrom || undefined,
        invoiceDateTo || undefined,
        currentPage,
        pageSize,
        approvedByFilter || undefined,
        sortColumn || undefined,
        sortColumn ? sortDirection : undefined
      );
      setInvoices(data.items);
      setTotalInvoices(data.total);
      onNavCountsChange({
        total: data.totalAll ?? data.total,
        approved: data.approvedAll ?? 0,
        pending: data.pendingAll ?? 0,
        failed: data.failedAll ?? 0
      });
      if (statusFilter === "ALL") {
        setAllStatusCounts({
          ALL: data.totalAll ?? data.total,
          PARSED: data.parsedAll ?? 0,
          NEEDS_REVIEW: data.needsReviewAll ?? 0,
          AWAITING_APPROVAL: data.awaitingApprovalAll ?? 0,
          FAILED: (data.failedOcrAll ?? 0) + (data.failedParseAll ?? 0),
          APPROVED: data.approvedAll ?? 0,
          EXPORTED: data.exportedAll ?? 0
        });
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

  function handleApprove() {
    if (!canApproveInvoices) {
      addToast("error", "You do not have permission to approve invoices.");
      return;
    }
    if (selectedApprovableIds.length === 0) {
      addToast("error", "Select at least one invoice to approve.");
      return;
    }
    const count = selectedApprovableIds.length;
    setConfirmDialog({
      title: "Approve Invoices",
      message: `Approve ${count} invoice${count === 1 ? "" : "s"}? This action is recorded in the audit trail.`,
      confirmLabel: `Approve ${count}`,
      destructive: false,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setActionLoading("approve");
          const response = await approveInvoices(selectedApprovableIds, userEmail);
          if (response.modifiedCount === 0) {
            addToast("info", "No eligible invoices found for approval.");
          } else {
            addToast("success", `${response.modifiedCount} invoice(s) approved.`);
          }
          await loadInvoices();
        } catch (approveError) {
          addToast("error", getUserFacingErrorMessage(approveError, "Approval failed."));
        } finally {
          setActionLoading(null);
        }
      }
    });
  }

  function handleDelete() {
    if (!canDeleteInvoices) {
      addToast("error", "You do not have permission to delete invoices.");
      return;
    }
    if (selectedIds.length === 0) return;
    setConfirmDialog({
      title: "Delete Invoices",
      message: `Delete ${selectedIds.length} invoice${selectedIds.length === 1 ? "" : "s"}? This cannot be undone.`,
      confirmLabel: `Delete ${selectedIds.length} invoice${selectedIds.length === 1 ? "" : "s"}`,
      destructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          setActionLoading("delete");
          const response = await deleteInvoices(selectedIds);
          if (response.deletedCount === 0) {
            addToast("info", "No invoices were eligible for deletion.");
          } else {
            addToast("success", `${response.deletedCount} invoice(s) deleted.`);
          }
          setSelectedIds([]);
          await loadInvoices();
        } catch (deleteError) {
          addToast("error", getUserFacingErrorMessage(deleteError, "Deletion failed."));
        } finally {
          setActionLoading(null);
        }
      }
    });
  }

  async function handleApproveSingle(invoiceId: string) {
    if (!canApproveInvoices) {
      addToast("error", "You do not have permission to approve invoices.");
      return;
    }
    try {
      const response = await approveInvoices([invoiceId], userEmail);
      if (response.modifiedCount === 0) {
        addToast("info", "Invoice was not eligible for approval.");
      }
      await loadInvoices();
    } catch (approveError) {
      addToast("error", getUserFacingErrorMessage(approveError, "Approval failed."));
    }
  }

  async function handleWorkflowApproveSingle(invoiceId: string) {
    if (!canApproveInvoices) {
      addToast("error", "You do not have permission to approve invoices.");
      return;
    }
    try {
      await approveWorkflowStep(invoiceId);
      addToast("success", "Workflow step approved.");
      await loadInvoices();
      if (activeInvoice?._id === invoiceId) {
        await refreshActiveInvoiceDetail();
      }
    } catch (approveError) {
      addToast("error", getUserFacingErrorMessage(approveError, "Workflow approval failed."));
    }
  }

  function handleWorkflowRejectSingle(invoiceId: string) {
    if (!canApproveInvoices) {
      addToast("error", "You do not have permission to reject workflow steps.");
      return;
    }
    setConfirmDialog({
      title: "Reject Approval Step",
      message: "Reject the current workflow step and return the invoice to Needs Review?",
      confirmLabel: "Reject Step",
      destructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          await rejectWorkflowStep(invoiceId, "Rejected from UI workflow action");
          addToast("info", "Workflow step rejected.");
          await loadInvoices();
          if (activeInvoice?._id === invoiceId) {
            await refreshActiveInvoiceDetail();
          }
        } catch (rejectError) {
          addToast("error", getUserFacingErrorMessage(rejectError, "Workflow rejection failed."));
        }
      }
    });
  }

  async function handleRetrySingle(invoiceId: string) {
    if (!canRetryInvoices) {
      addToast("error", "You do not have permission to retry invoices.");
      return;
    }
    setIngestingIds((prev) => new Set(prev).add(invoiceId));
    try {
      const response = await retryInvoices([invoiceId]);
      if (response.modifiedCount === 0) {
        addToast("info", "Invoice was not eligible for retry.");
        setIngestingIds((prev) => { const next = new Set(prev); next.delete(invoiceId); return next; });
        return;
      }
      if (ingestionStatus?.running) return;
      const status = await runIngestion();
      setIngestionStatus(status);
      if (!status.running) {
        setIngestingIds((prev) => { const next = new Set(prev); next.delete(invoiceId); return next; });
        await loadInvoices();
      }
    } catch (retryError) {
      addToast("error", getUserFacingErrorMessage(retryError, "Retry failed."));
      setIngestingIds((prev) => { const next = new Set(prev); next.delete(invoiceId); return next; });
    }
  }

  function handleDeleteSingle(invoiceId: string, fileName: string) {
    if (!canDeleteInvoices) {
      addToast("error", "You do not have permission to delete invoices.");
      return;
    }
    setConfirmDialog({
      title: "Delete Invoice",
      message: `Delete "${fileName}"? This cannot be undone.`,
      confirmLabel: "Delete invoice",
      destructive: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const response = await deleteInvoices([invoiceId]);
          if (response.deletedCount === 0) {
            addToast("info", "Invoice could not be deleted.");
          } else {
            addToast("success", `"${fileName}" deleted.`);
          }
          setSelectedIds((current) => current.filter((id) => id !== invoiceId));
          await loadInvoices();
        } catch (deleteError) {
          addToast("error", getUserFacingErrorMessage(deleteError, "Deletion failed."));
        }
      }
    });
  }

  async function handleRetry() {
    if (!canRetryInvoices) {
      addToast("error", "You do not have permission to retry invoices.");
      return;
    }
    if (selectedRetryableIds.length === 0) {
      addToast("error", "Select at least one invoice to retry.");
      return;
    }
    try {
      setError(null);
      const response = await retryInvoices(selectedRetryableIds);
      if (response.modifiedCount === 0) {
        addToast("info", "No invoices were eligible for retry.");
      }
      setSelectedIds([]);
      await loadInvoices();
    } catch (retryError) {
      addToast("error", getUserFacingErrorMessage(retryError, "Retry failed."));
    }
  }

  async function handleExport() {
    if (!canExportToTally) {
      addToast("error", "You do not have permission to export invoices.");
      return;
    }
    if (selectedExportableIds.length === 0) {
      addToast("error", "Select at least one approved invoice to export.");
      return;
    }
    if (selectedNonExportableCount > 0) {
      addToast("error", "Deselect non-approved invoices before exporting.");
      return;
    }
    try {
      setActionLoading("export");
      const fileResult = await generateTallyXmlFile(selectedExportableIds);
      if (!fileResult.batchId) {
        addToast("error", "Export failed — invoices may have invalid amounts or are already exported.");
        setSelectedIds([]);
        await loadInvoices();
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
      addToast("success", `${fileResult.includedCount} invoice(s) exported. XML file downloaded.`);
      await loadInvoices();
      if (fileResult.skippedCount > 0) {
        addToast("info", `${fileResult.skippedCount} invoice(s) skipped (already exported or missing fields).`);
      }
    } catch (downloadError) {
      addToast("error", getUserFacingErrorMessage(downloadError, "Export failed."));
      await loadInvoices();
    } finally {
      setActionLoading(null);
    }
  }

  async function uploadFiles(files: File[]) {
    if (!canUploadFiles) {
      addToast("error", "You do not have permission to upload files.");
      return;
    }
    if (files.length === 0) return;

    const MAX_FILES = 50;
    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

    if (files.length > MAX_FILES) {
      addToast("error", "Maximum 50 files per upload");
      return;
    }

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        addToast("error", `File ${file.name} exceeds the 20 MB limit`);
        return;
      }
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        addToast("error", `File ${file.name} has an unsupported format. Supported: PDF, JPG, PNG, WEBP`);
        return;
      }
    }

    try {
      setError(null);

      const fileMeta = files.map((f) => ({
        name: f.name,
        contentType: f.type || "application/octet-stream",
        sizeBytes: f.size
      }));

      let presignResponse: Awaited<ReturnType<typeof requestPresignedUrls>> | null = null;
      try {
        presignResponse = await requestPresignedUrls(fileMeta);
      } catch {
        presignResponse = null;
      }

      if (presignResponse && presignResponse.uploads.length === files.length) {
        const progressMap = new Map<string, number>();
        for (const file of files) progressMap.set(file.name, 0);
        setUploadProgress(new Map(progressMap));

        const uploadPromises = presignResponse.uploads.map((entry, idx) => {
          const file = files[idx];
          return new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", entry.uploadUrl);
            xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable) {
                progressMap.set(file.name, Math.round((event.loaded / event.total) * 100));
                setUploadProgress(new Map(progressMap));
              }
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                progressMap.set(file.name, 100);
                setUploadProgress(new Map(progressMap));
                resolve();
              } else {
                reject(new Error(`Upload failed for ${file.name}: ${xhr.status}`));
              }
            };
            xhr.onerror = () => reject(new Error(`Upload failed for ${file.name}`));
            xhr.send(file);
          });
        });

        await Promise.all(uploadPromises);

        const keys = presignResponse.uploads.map((entry) => entry.key);
        await registerUploadedKeys(keys);
        setUploadProgress(new Map());
      } else {
        await uploadInvoiceFiles(files);
      }

      await loadInvoices();
      const status = await runIngestion();
      setIngestionStatus(status);
    } catch (uploadError) {
      setUploadProgress(new Map());
      addToast("error", getUserFacingErrorMessage(uploadError, "File upload failed."));
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    try {
      await uploadFiles(files ? Array.from(files) : []);
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function handleUploadDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setUploadDragActive(false);
    await uploadFiles(Array.from(event.dataTransfer.files ?? []));
  }

  async function handleIngest() {
    if (!canStartIngestion) {
      addToast("error", "You do not have permission to run ingestion.");
      return;
    }
    try {
      setError(null);
      const status = await runIngestion();
      setIngestionStatus(status);
    } catch (ingestError) {
      addToast("error", getUserFacingErrorMessage(ingestError, "Ingestion run failed."));
    }
  }

  async function handlePauseIngestion() {
    if (!canStartIngestion) {
      addToast("error", "You do not have permission to manage ingestion.");
      return;
    }
    try {
      setError(null);
      const status = await pauseIngestion();
      setIngestionStatus(status);
    } catch (pauseError) {
      addToast("error", getUserFacingErrorMessage(pauseError, "Failed to pause ingestion."));
    }
  }

  async function handleSaveField(
    invoice: Invoice | null,
    fieldKey: string,
    value: string,
    refreshDetail: () => Promise<void>
  ) {
    if (!canEditInvoiceFields) {
      addToast("error", "You do not have permission to edit invoice fields.");
      return;
    }
    if (!invoice) return;
    const trimmed = value.trim();
    const parsed: Record<string, unknown> = {};
    if (fieldKey === "totalAmountMinor") {
      parsed.totalAmountMajor = trimmed || null;
    } else if (fieldKey === "currency") {
      parsed.currency = trimmed ? trimmed.toUpperCase() : null;
    } else if (fieldKey.startsWith("gst.")) {
      const gstKey = fieldKey.slice(4);
      const gstAmountFields = ["subtotalMinor", "cgstMinor", "sgstMinor", "igstMinor", "cessMinor", "totalTaxMinor"];
      const existingGst = invoice.parsed?.gst ?? {};
      if (gstAmountFields.includes(gstKey)) {
        const major = parseFloat((trimmed || "0").replace(/,/g, ""));
        const minor = Number.isFinite(major) && major > 0 ? Math.round(major * 100) : null;
        parsed.gst = { ...existingGst, [gstKey]: minor };
      } else {
        parsed.gst = { ...existingGst, [gstKey]: trimmed || null };
      }
    } else {
      parsed[fieldKey] = trimmed || null;
    }
    try {
      await updateInvoiceParsedFields(invoice._id, { parsed: parsed as Parameters<typeof updateInvoiceParsedFields>[1]["parsed"], updatedBy: "ui-user" });
      await loadInvoices();
      await refreshDetail();
    } catch (saveError) {
      addToast("error", getUserFacingErrorMessage(saveError, "Failed to save field."));
    }
  }

  async function handleSaveListCell() {
    if (!canEditInvoiceFields) {
      addToast("error", "You do not have permission to edit invoice fields.");
      return;
    }
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
      addToast("error", getUserFacingErrorMessage(saveError, "Failed to save field."));
    }
  }

  async function handleTableGlCodeSelect(invoiceId: string, glCode: string, glName: string) {
    setGlCodeEditingInvoiceId(null);
    try {
      await updateInvoiceComplianceOverride(invoiceId, { glCode, glName } as Record<string, unknown>);
      await loadInvoices();
      if (activeId === invoiceId) {
        await refreshActiveInvoiceDetail();
      }
      addToast("success", "GL code updated and compliance recalculated.");
    } catch {
      addToast("error", "Failed to update GL code.");
    }
  }

  async function handleTableGlCodeClear(invoiceId: string) {
    setGlCodeEditingInvoiceId(null);
    try {
      await updateInvoiceComplianceOverride(invoiceId, { glCode: "" } as Record<string, unknown>);
      await loadInvoices();
      if (activeId === invoiceId) {
        await refreshActiveInvoiceDetail();
      }
      addToast("success", "GL code cleared.");
    } catch {
      addToast("error", "Failed to clear GL code.");
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
      <TenantInvoicesToolbar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        invoiceDateFrom={invoiceDateFrom}
        onInvoiceDateFromChange={setInvoiceDateFrom}
        invoiceDateTo={invoiceDateTo}
        onInvoiceDateToChange={setInvoiceDateTo}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        allStatusCounts={allStatusCounts}
        hasActiveFilters={hasActiveFilters}
        onClearAllFilters={clearAllFilters}
        canViewAllInvoices={canViewAllInvoices}
        tenantUsers={tenantUsers}
        approvedByFilter={approvedByFilter}
        onApprovedByFilterChange={setApprovedByFilter}
        canApproveInvoices={canApproveInvoices}
        canDeleteInvoices={canDeleteInvoices}
        canRetryInvoices={canRetryInvoices}
        canUploadFiles={canUploadFiles}
        canStartIngestion={canStartIngestion}
        requiresTenantSetup={requiresTenantSetup}
        selectedApprovableCount={selectedApprovableIds.length}
        selectedDeleteCount={selectedIds.length}
        selectedRetryableCount={selectedRetryableIds.length}
        actionLoading={actionLoading}
        ingestionStatus={ingestionStatus}
        detailsPanelVisible={detailsPanelVisible}
        onToggleDetailsPanel={() => setDetailsPanelVisible((currentValue) => !currentValue)}
        tableDensity={tableDensity}
        onTableDensityChange={(density) => {
          setTableDensity(density);
          localStorage.setItem("billforge:table-density", density);
        }}
        uploadInputRef={uploadInputRef}
        onUploadButtonClick={() => uploadInputRef.current?.click()}
        onUploadFileChange={(e) => void handleUpload(e)}
        uploadDragActive={uploadDragActive}
        onUploadDragEnter={(event) => {
          event.preventDefault();
          setUploadDragActive(true);
        }}
        onUploadDragOver={(event) => {
          event.preventDefault();
          setUploadDragActive(true);
        }}
        onUploadDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) setUploadDragActive(false);
        }}
        onUploadDrop={(event) => void handleUploadDrop(event)}
        onApprove={() => void handleApprove()}
        onDelete={handleDelete}
        onRetry={() => void handleRetry()}
        onIngest={() => void handleIngest()}
        onPauseIngestion={() => void handlePauseIngestion()}
      />
      <IngestionProgressCard
        status={ingestionStatus}
        progressPercent={ingestionProgressPercent}
        successfulFiles={ingestionSuccessfulFiles}
        fading={ingestionFading}
        label="Invoice Ingestion"
        uploadProgress={uploadProgress}
      />
      {error ? <p className="error">{error}</p> : null}
      <main ref={contentRef} className={contentClassName} style={contentStyle}>
        <>
          <section className="panel list-panel" data-density={tableDensity}>
            <div className="panel-title">
              <h2>Invoices</h2>
              {loading ? <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>Loading...</span> : <span>{invoices.length} records</span>}
            </div>

            {loading && invoices.length === 0 ? (
              <div style={{ padding: "1rem" }}>
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
              </div>
            ) : null}

            {!loading && invoices.length === 0 ? (
              <EmptyState
                icon={hasActiveFilters ? "filter_list_off" : "receipt_long"}
                heading={hasActiveFilters ? "No matching invoices" : "No invoices yet"}
                description={hasActiveFilters ? "Try adjusting your filters or date range." : "Upload invoice PDFs or connect a Gmail inbox to start processing."}
                action={hasActiveFilters
                  ? <button type="button" className="app-button app-button-secondary" onClick={clearAllFilters}>Clear Filters</button>
                  : (canUploadFiles ? <button type="button" className="app-button app-button-primary" onClick={() => uploadInputRef.current?.click()}>Upload Files</button> : undefined)}
              />
            ) : null}

            {invoices.length > 0 || loading ? (
            <div className={`list-scroll${loading && invoices.length > 0 ? " list-scroll-loading" : ""}`}>
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={areAllVisibleSelectableSelected && selectableVisibleIds.length > 0} disabled={selectableVisibleIds.length === 0} onChange={toggleSelectAllVisible} /></th>
                    {([["file", "File"], ["vendor", "Vendor"], ["invoiceNumber", "Invoice #"], ["invoiceDate", "Invoice Date"], ["total", "Total"], ["tax", "Tax"], ["glCode", "GL Code"], ["tds", "TDS"], ["signals", "Signals"], ["confidence", "Score"], ["status", "Status"], ["approvedBy", "Approved By"], ["received", "Received"]] as const).map(([key, label]) => (
                      <th
                        key={key}
                        className="sortable-th"
                        style={columnWidths[key] ? { width: columnWidths[key], position: "relative" } : { position: "relative" }}
                        onClick={() => { if (sortColumn === key) { setSortDirection((d) => d === "asc" ? "desc" : "asc"); } else { setSortColumn(key); setSortDirection("asc"); } }}
                      >
                        {label}
                        {sortColumn === key ? <span className="sort-indicator">{sortDirection === "asc" ? " \u25B2" : " \u25BC"}</span> : null}
                        <span className="col-resize-handle" onMouseDown={(e) => handleColumnResize(key, e)} />
                      </th>
                    ))}
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
                    const canEditCell = invoice.status !== "EXPORTED" && canEditInvoiceFields;

                    return (
                      <tr key={invoice._id} data-invoice-id={invoice._id} className={rowClasses || undefined} onClick={() => { setActiveId(invoice._id); setDetailsPanelVisible(true); }}>
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
                                <button type="button" className="row-action-button field-edit-button" title="Edit date" onClick={() => { setEditingListCell({ invoiceId: invoice._id, field: "invoiceDate" }); const raw = invoice.parsed?.invoiceDate ?? ""; const d = raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(raw) : null; setEditListValue(d && !isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : raw); }}>
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
                        <td className="muted">{formatTaxSummary(invoice)}</td>
                        <td className="gl-code-cell" style={{ fontSize: "0.82rem" }} onClick={(e) => e.stopPropagation()}>
                          {glCodeEditingInvoiceId === invoice._id ? (
                            <div className="gl-code-inline-dropdown">
                              <GlCodeDropdown
                                glCodes={tenantGlCodes}
                                currentCode={invoice.compliance?.glCode?.code ?? null}
                                onSelect={(code, name) => void handleTableGlCodeSelect(invoice._id, code, name)}
                                onClear={() => void handleTableGlCodeClear(invoice._id)}
                                onClose={() => setGlCodeEditingInvoiceId(null)}
                              />
                            </div>
                          ) : (
                            <>
                              <span title={invoice.compliance?.glCode?.code ?? ""}>
                                {invoice.complianceSummary?.glCode ?? invoice.compliance?.glCode?.name ?? ""}
                                {!invoice.complianceSummary?.glCode && !invoice.compliance?.glCode?.name ? <span className="muted">—</span> : null}
                              </span>
                              {canOverrideGlCode && invoice.status !== "EXPORTED" ? (
                                <button
                                  type="button"
                                  className="row-action-button field-edit-button"
                                  title="Edit GL code"
                                  onClick={() => setGlCodeEditingInvoiceId(invoice._id)}
                                >
                                  <span className="material-symbols-outlined">edit</span>
                                </button>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td style={{ fontSize: "0.82rem" }}>
                          {invoice.complianceSummary?.tdsSection ?? invoice.compliance?.tds?.section
                            ? <span>{invoice.complianceSummary?.tdsSection ?? invoice.compliance?.tds?.section} {invoice.compliance?.tds?.rate ? `${invoice.compliance.tds.rate / 100}%` : ""}</span>
                            : <span className="muted">—</span>}
                        </td>
                        <td>
                          {(() => {
                            const count = invoice.complianceSummary?.riskSignalCount ?? invoice.compliance?.riskSignals?.filter(s => s.status === "open").length ?? 0;
                            const maxSev = invoice.complianceSummary?.riskSignalMaxSeverity ?? (invoice.compliance?.riskSignals?.length ? invoice.compliance.riskSignals.reduce((m, s) => s.severity === "critical" ? "critical" : s.severity === "warning" && m !== "critical" ? "warning" : m, "info" as string) : null);
                            if (count === 0) return <span className="muted">—</span>;
                            const color = maxSev === "critical" ? "var(--color-error, #ef4444)" : maxSev === "warning" ? "var(--color-warning, #f59e0b)" : "var(--color-info, #3b82f6)";
                            return <span style={{ fontSize: "0.7rem", fontWeight: 600, padding: "0.1rem 0.35rem", borderRadius: "0.75rem", backgroundColor: color, color: "#fff" }}>{count}</span>;
                          })()}
                        </td>
                        <td>
                          <ConfidenceBadge score={invoice.confidenceScore ?? 0} tone={invoice.confidenceTone} />
                        </td>
                        <td>
                          {ingestingIds.has(invoice._id) ? (
                            <span className="status status-reprocessing">Reprocessing</span>
                          ) : (
                            <span className={`status status-${invoice.status.toLowerCase()}`}>
                              {STATUS_ICONS[invoice.status] ? <span className="material-symbols-outlined status-badge-icon">{STATUS_ICONS[invoice.status]}</span> : null}
                              {invoice.status === "AWAITING_APPROVAL" && invoice.workflowState?.currentStep
                                ? `Step ${invoice.workflowState.currentStep}`
                                : (STATUS_LABELS[invoice.status] ?? invoice.status)}
                            </span>
                          )}
                          {invoice.possibleDuplicate ? (
                            <span className="material-symbols-outlined duplicate-warning" title="Possible duplicate — another invoice has identical file contents">warning</span>
                          ) : null}
                        </td>
                        <td style={{ fontSize: "0.82rem", color: "var(--ink-soft)" }} title={invoice.approval?.email ?? invoice.approval?.approvedBy ?? ""}>{formatApproverName(invoice.approval?.email ?? invoice.approval?.approvedBy)}</td>
                        <td>{new Date(invoice.receivedAt).toLocaleString()}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const actions = getAvailableRowActions(invoice).filter((action) => {
                              if (action === "approve") return canApproveInvoices;
                              if (action === "reingest") return canRetryInvoices;
                              if (action === "delete") return canDeleteInvoices;
                              return false;
                            });
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
            ) : null}
            {selectedIds.length > 0 && (canApproveInvoices || canExportToTally || canDeleteInvoices) ? (
              <div className="bulk-action-bar">
                <span className="bulk-count">{selectedIds.length} selected</span>
                {canApproveInvoices ? (
                  <button type="button" className="app-button app-button-primary app-button-sm" disabled={selectedApprovableIds.length === 0} onClick={() => void handleApprove()}>
                    Approve ({selectedApprovableIds.length})
                  </button>
                ) : null}
                {canExportToTally ? (
                  <button type="button" className="app-button app-button-sm" style={{ background: "var(--chart-violet)", borderColor: "var(--chart-violet)", color: "#fff" }} disabled={selectedExportableIds.length === 0} onClick={() => void handleExport()}>
                    Export ({selectedExportableIds.length})
                  </button>
                ) : null}
                {canDeleteInvoices ? (
                  <button type="button" className="app-button app-button-sm" style={{ background: "var(--warn)", borderColor: "var(--warn)", color: "#fff" }} onClick={handleDelete}>
                    Delete ({selectedIds.length})
                  </button>
                ) : null}
                <button type="button" className="bulk-deselect" onClick={() => setSelectedIds([])}>Deselect All</button>
              </div>
            ) : null}
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
              {activeInvoice ? (
                <TenantInvoiceDetailPanel
                  invoice={activeInvoice}
                  loading={activeInvoiceDetailLoading}
                  canApproveInvoices={canApproveInvoices}
                  canEditInvoiceFields={canEditInvoiceFields}
                  canDismissRiskSignals={canDismissRiskSignals}
                  canOverrideGlCode={canOverrideGlCode}
                  canOverrideTds={canOverrideTds}
                  tenantGlCodes={tenantGlCodes}
                  tenantTdsRates={tenantTdsRates}
                  activeOverlayUrlByField={activeOverlayUrlByField}
                  activeCropUrlByField={activeCropUrlByField}
                  resolvePreviewUrl={(page) => getInvoicePreviewUrl(activeInvoice._id, page)}
                  activeSourcePreviewExpanded={activeSourcePreviewExpanded}
                  setActiveSourcePreviewExpanded={setActiveSourcePreviewExpanded}
                  activeExtractedFieldsExpanded={activeExtractedFieldsExpanded}
                  setActiveExtractedFieldsExpanded={setActiveExtractedFieldsExpanded}
                  activeLineItemsExpanded={activeLineItemsExpanded}
                  setActiveLineItemsExpanded={setActiveLineItemsExpanded}
                  onWorkflowApproveSingle={(invoiceId) => void handleWorkflowApproveSingle(invoiceId)}
                  onWorkflowRejectSingle={(invoiceId) => void handleWorkflowRejectSingle(invoiceId)}
                  onSaveField={(fieldKey, value, refreshDetail) => handleSaveField(activeInvoice, fieldKey, value, refreshDetail)}
                  refreshActiveInvoiceDetail={refreshActiveInvoiceDetail}
                  onClose={() => setDetailsPanelVisible(false)}
                  extractedRows={getExtractedFieldRows(activeInvoice)}
                  onOverrideGlCode={async (glCode, glName) => {
                    if (!glCode) {
                      try {
                        await updateInvoiceComplianceOverride(activeInvoice._id, { glCode: "" } as Record<string, unknown>);
                        await refreshActiveInvoiceDetail();
                        await loadInvoices();
                        addToast("success", "GL code cleared.");
                      } catch {
                        addToast("error", "Failed to clear GL code.");
                      }
                      return;
                    }
                    try {
                      await updateInvoiceComplianceOverride(activeInvoice._id, { glCode, glName } as Record<string, unknown>);
                      await refreshActiveInvoiceDetail();
                      await loadInvoices();
                      addToast("success", "GL code updated and compliance recalculated.");
                    } catch {
                      addToast("error", "Failed to update GL code.");
                    }
                  }}
                  onOverrideTdsSection={async (section) => {
                    try {
                      await updateInvoiceComplianceOverride(activeInvoice._id, { tdsSection: section } as Record<string, unknown>);
                      await refreshActiveInvoiceDetail();
                      addToast("success", "TDS section updated.");
                    } catch {
                      addToast("error", "Failed to update TDS section.");
                    }
                  }}
                  onDismissRiskSignal={async (signalCode) => {
                    try {
                      await updateInvoiceComplianceOverride(activeInvoice._id, { dismissRiskSignal: signalCode } as Record<string, unknown>);
                      await refreshActiveInvoiceDetail();
                      addToast("info", "Signal dismissed.");
                    } catch {
                      addToast("error", "Failed to dismiss signal.");
                    }
                  }}
                />
              ) : (
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
                  <p className="muted" style={{ padding: "1rem" }}>Select an invoice to inspect details.</p>
                </section>
              )}
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
      <KeyboardShortcutsOverlay open={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />

      {popupInvoice ? (
        <TenantInvoicePopup
          invoice={popupInvoice}
          loading={popupInvoiceDetailLoading}
          tenantMode={tenantMode}
          popupRef={popupRef}
          popupSourcePreviewExpanded={popupSourcePreviewExpanded}
          setPopupSourcePreviewExpanded={setPopupSourcePreviewExpanded}
          popupExtractedFieldsExpanded={popupExtractedFieldsExpanded}
          setPopupExtractedFieldsExpanded={setPopupExtractedFieldsExpanded}
          popupLineItemsExpanded={popupLineItemsExpanded}
          setPopupLineItemsExpanded={setPopupLineItemsExpanded}
          popupRawOcrExpanded={popupRawOcrExpanded}
          setPopupRawOcrExpanded={setPopupRawOcrExpanded}
          popupMappingExpanded={popupMappingExpanded}
          setPopupMappingExpanded={setPopupMappingExpanded}
          popupOverlayUrlByField={popupOverlayUrlByField}
          popupCropUrlByField={popupCropUrlByField}
          popupExtractedRows={popupExtractedRows}
          popupTallyMappings={popupTallyMappings}
          onClose={() => setPopupInvoiceId(null)}
          onSaveField={(fieldKey, value, refreshDetail) => handleSaveField(popupInvoice, fieldKey, value, refreshDetail)}
          refreshPopupInvoiceDetail={refreshPopupInvoiceDetail}
          resolvePreviewUrl={(page) => getInvoicePreviewUrl(popupInvoice._id, page)}
        />
      ) : null}
    </>
  );
}
