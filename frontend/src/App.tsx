import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveInvoices,
  assignTenantUserRole,
  changePassword,
  clearStoredSessionToken,
  completeTenantOnboarding,
  deleteInvoices,
  downloadTallyXmlFile,
  exportToTally,
  generateTallyXmlFile,
  fetchGmailConnectUrl,
  fetchGmailConnectionStatus,
  fetchIngestionStatus,
  fetchInvoices,
  loginWithCredentials,
  fetchPlatformTenantUsage,
  onboardTenantAdmin,
  fetchSessionContext,
  fetchTenantUsers,
  getInvoiceBlockCropUrl,
  getInvoiceFieldOverlayUrl,
  getInvoicePreviewUrl,
  getStoredSessionToken,
  inviteTenantUser,
  pauseIngestion,
  runIngestion,
  setStoredSessionToken,
  removeTenantUser,
  subscribeIngestionSSE,
  updateInvoiceParsedFields,
  uploadInvoiceFiles
} from "./api";
import type { GmailConnectionStatus, IngestionJobStatus, Invoice } from "./types";
import type { PlatformTenantUsageSummary } from "./api";
import { ConfidenceBadge } from "./components/ConfidenceBadge";
import { ExtractedFieldsTable } from "./components/ExtractedFieldsTable";
import { IngestionProgressCard } from "./components/IngestionProgressCard";
import { InvoiceSourceViewer } from "./components/InvoiceSourceViewer";
import { TallyMappingTable } from "./components/TallyMappingTable";
import { LoginPage } from "./components/login/LoginPage";
import { PlatformAdminTopNav } from "./components/platformAdmin/PlatformAdminTopNav";
import { PlatformActivityMonitor } from "./components/platformAdmin/PlatformActivityMonitor";
import { PlatformOnboardSection } from "./components/platformAdmin/PlatformOnboardSection";
import { PlatformOverviewHero } from "./components/platformAdmin/PlatformOverviewHero";
import { PlatformStatsSection } from "./components/platformAdmin/PlatformStatsSection";
import { PlatformUsageOverviewSection } from "./components/platformAdmin/PlatformUsageOverviewSection";
import { TenantAdminTopNav } from "./components/tenantAdmin/TenantAdminTopNav";
import { TenantViewTabs, type TenantViewTab } from "./components/tenantAdmin/TenantViewTabs";
import { ExportHistoryDashboard } from "./components/ExportHistoryDashboard";

import { getExtractedFieldRows } from "./extractedFields";
import { getInvoiceSourceHighlights } from "./sourceHighlights";
import {
  isInvoiceApprovable,
  isInvoiceExportable,
  isInvoiceSelectable,
  mergeSelectedIds,
  removeSelectedIds
} from "./selection";
import { getInvoiceTallyMappings } from "./tallyMapping";
import { formatMinorAmountWithCurrency } from "./currency";
import {
  buildFieldCropUrlMap,
  buildFieldOverlayUrlMap,
  STATUSES
} from "./invoiceView";
import { useInvoiceDetail } from "./hooks/useInvoiceDetail";
import { getUserFacingErrorMessage, isAuthenticationError } from "./apiError";

function selectNewerInvoice(detail: Invoice | null, summary: Invoice | null): Invoice | null {
  if (!summary) return detail;
  if (!detail || detail._id !== summary._id) return summary;
  const dt = Date.parse(detail.updatedAt);
  const st = Date.parse(summary.updatedAt);
  return Number.isFinite(dt) && dt >= st ? detail : summary;
}

export function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<{
    user: { id: string; email: string; role: "TENANT_ADMIN" | "MEMBER"; isPlatformAdmin: boolean };
    tenant: { id: string; name: string; onboarding_status: "pending" | "completed"; mode?: "test" | "live" };
    flags: {
      requires_tenant_setup: boolean;
      requires_reauth: boolean;
      requires_admin_action: boolean;
      requires_email_confirmation: boolean;
    };
  } | null>(null);
  const [tenantUsers, setTenantUsers] = useState<Array<{ userId: string; email: string; role: "TENANT_ADMIN" | "MEMBER" }>>(
    []
  );
  const [platformUsage, setPlatformUsage] = useState<PlatformTenantUsageSummary[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [onboardingForm, setOnboardingForm] = useState({
    tenantName: "",
    adminEmail: ""
  });
  const [platformOnboardForm, setPlatformOnboardForm] = useState({
    tenantName: "",
    adminEmail: "",
    adminDisplayName: "",
    mode: "test" as string
  });
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [navCounts, setNavCounts] = useState({ total: 0, approved: 0, pending: 0 });
  const [popupSourcePreviewExpanded, setPopupSourcePreviewExpanded] = useState(false);
  const [popupRawOcrExpanded, setPopupRawOcrExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [popupInvoiceId, setPopupInvoiceId] = useState<string | null>(null);
  const [detailsPanelVisible, setDetailsPanelVisible] = useState(true);
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(true);
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionStatus | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<TenantViewTab>("dashboard");
  const [selectedPlatformTenantId, setSelectedPlatformTenantId] = useState<string | null>(null);
  const [platformStatsCollapsed, setPlatformStatsCollapsed] = useState(false);
  const [platformOnboardCollapsed, setPlatformOnboardCollapsed] = useState(false);
  const [platformUsageCollapsed, setPlatformUsageCollapsed] = useState(false);
  const [platformActivityCollapsed, setPlatformActivityCollapsed] = useState(false);
  const [ingestionStatus, setIngestionStatus] = useState<IngestionJobStatus | null>(null);
  const [ingestionFading, setIngestionFading] = useState(false);
  const [editingListCell, setEditingListCell] = useState<{ invoiceId: string; field: string } | null>(null);
  const [editListValue, setEditListValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [popupMappingExpanded, setPopupMappingExpanded] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [changePasswordForm, setChangePasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [platformOnboardResult, setPlatformOnboardResult] = useState<{ tempPassword: string; adminEmail: string } | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const ingestionWasRunningRef = useRef(false);
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

  useEffect(() => {
    void bootstrapSession();
  }, []);

  useEffect(() => {
    if (!session || session.user.isPlatformAdmin) {
      return;
    }
    void loadInvoices();
  }, [session, statusFilter]);

  useEffect(() => {
    if (!session) {
      setActiveTab("dashboard");
      return;
    }
    if (session.user.isPlatformAdmin) {
      void loadPlatformUsage();
      setTenantUsers([]);
      setGmailConnection(null);
      setIngestionStatus(null);
    } else {
      setPlatformUsage([]);
      setSelectedPlatformTenantId(null);
      void refreshIngestionStatus();
      void loadGmailConnectionStatus();
      if (session.user.role === "TENANT_ADMIN") {
        void loadTenantUsers();
        setOnboardingForm({
          tenantName: session.tenant.name,
          adminEmail: session.user.email
        });
      } else {
        setTenantUsers([]);
      }
    }
  }, [session?.user.id, session?.tenant.id]);

  useEffect(() => {
    if (platformUsage.length === 0) {
      setSelectedPlatformTenantId(null);
      return;
    }

    setSelectedPlatformTenantId((currentValue) =>
      currentValue && platformUsage.some((entry) => entry.tenantId === currentValue)
        ? currentValue
        : platformUsage[0].tenantId
    );
  }, [platformUsage]);

  useEffect(() => {
    if (session?.user.role !== "TENANT_ADMIN") {
      setActiveTab("dashboard");
    }
  }, [session?.user.role]);

  useEffect(() => {
    setPopupSourcePreviewExpanded(false);
  }, [popupInvoiceId]);

  const activeInvoiceSummary = useMemo(
    () => invoices.find((invoice) => invoice._id === activeId) ?? null,
    [activeId, invoices]
  );
  const activeInvoice = useMemo(
    () => selectNewerInvoice(activeInvoiceDetail, activeInvoiceSummary),
    [activeInvoiceDetail, activeInvoiceSummary]
  );

  const platformStats = useMemo(() => {
    return {
      tenants: platformUsage.length,
      users: platformUsage.reduce((sum, entry) => sum + entry.userCount, 0),
      totalDocuments: platformUsage.reduce((sum, entry) => sum + entry.totalDocuments, 0),
      approvedDocuments: platformUsage.reduce((sum, entry) => sum + entry.approvedDocuments, 0),
      exportedDocuments: platformUsage.reduce((sum, entry) => sum + entry.exportedDocuments, 0),
      failedDocuments: platformUsage.reduce((sum, entry) => sum + entry.failedDocuments, 0)
    };
  }, [platformUsage]);
  const selectedPlatformTenant = useMemo(
    () => platformUsage.find((entry) => entry.tenantId === selectedPlatformTenantId) ?? null,
    [platformUsage, selectedPlatformTenantId]
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

  const filteredInvoices = useMemo(() => {
    if (!searchQuery.trim()) {
      return invoices;
    }
    const q = searchQuery.trim().toLowerCase();
    return invoices.filter(
      (invoice) =>
        invoice.attachmentName.toLowerCase().includes(q) ||
        (invoice.parsed?.vendorName ?? "").toLowerCase().includes(q) ||
        (invoice.parsed?.invoiceNumber ?? "").toLowerCase().includes(q)
    );
  }, [invoices, searchQuery]);

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

    return detailsPanelCollapsed ? "content content-details-collapsed" : "content";
  }, [detailsPanelVisible, detailsPanelCollapsed]);

  const gmailConnectionState = gmailConnection?.connectionState ?? "DISCONNECTED";
  const gmailNeedsReauth = gmailConnectionState === "NEEDS_REAUTH";
  const gmailConnected = gmailConnectionState === "CONNECTED";
  const gmailEmailAddress = gmailConnection?.emailAddress ?? "";

  async function bootstrapSession() {
    setAuthLoading(true);
    const params = new URLSearchParams(window.location.search);
    const callbackToken = params.get("token");
    const callbackNext = params.get("next");
    if (callbackToken) {
      setStoredSessionToken(callbackToken);
      params.delete("token");
      params.delete("next");
      const query = params.toString();
      const targetPath = callbackNext && callbackNext.startsWith("/") ? callbackNext : window.location.pathname;
      window.history.replaceState({}, "", `${targetPath}${query.length > 0 ? `?${query}` : ""}`);
    }

    const storedToken = getStoredSessionToken();
    if (!storedToken) {
      setSession(null);
      setAuthLoading(false);
      return;
    }

    try {
      const sessionContext = await fetchSessionContext();
      setSession(sessionContext);
      setError(null);
      if ((sessionContext.flags as Record<string, unknown>).must_change_password) {
        setShowChangePassword(true);
      }
    } catch {
      clearStoredSessionToken();
      setSession(null);
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadTenantUsers() {
    if (!session || session.user.role !== "TENANT_ADMIN") {
      return;
    }
    try {
      const users = await fetchTenantUsers();
      setTenantUsers(users);
    } catch (loadError) {
      setError(getUserFacingErrorMessage(loadError, "Failed to load tenant users."));
    }
  }

  async function loadPlatformUsage() {
    if (!session?.user.isPlatformAdmin) {
      return;
    }
    try {
      const usage = await fetchPlatformTenantUsage();
      setPlatformUsage(usage);
    } catch (loadError) {
      setError(getUserFacingErrorMessage(loadError, "Failed to load tenant usage overview."));
    }
  }

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
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (!gmailStatus) {
      return;
    }

    if (gmailStatus === "error") {
      const reason = params.get("reason");
      setError(reason ? `Gmail reconnect failed: ${reason}` : "Gmail reconnect failed.");
    }

    if (gmailStatus === "connected") {
      setError(null);
    }

    if (session) {
      void loadGmailConnectionStatus();
      if (session.user.isPlatformAdmin) {
        void loadPlatformUsage();
      }
    }
    params.delete("gmail");
    params.delete("reason");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query.length > 0 ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [session]);

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
      void loadGmailConnectionStatus();
    }

    ingestionWasRunningRef.current = isRunning;
  }, [ingestionStatus?.running, ingestionStatus?.state, ingestionStatus?.error]);

  useEffect(() => {
    if (ingestionStatus?.state !== "completed") {
      setIngestionFading(false);
      return;
    }
    const fadeTimer = setTimeout(() => setIngestionFading(true), 2000);
    const hideTimer = setTimeout(() => setIngestionStatus(null), 3500);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [ingestionStatus?.state]);

  async function loadInvoices() {
    if (!session) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const data = await fetchInvoices(statusFilter === "ALL" ? undefined : statusFilter);
      setInvoices(data.items);
      setNavCounts({
        total: data.totalAll ?? data.total,
        approved: data.approvedAll ?? 0,
        pending: data.pendingAll ?? 0
      });
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
        clearStoredSessionToken();
        setSession(null);
      } else {
        setError(getUserFacingErrorMessage(loadError, "Failed to fetch invoices."));
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshIngestionStatus() {
    if (!session) {
      return;
    }
    try {
      const status = await fetchIngestionStatus();
      setIngestionStatus(status);
    } catch {
      // Keep UI usable even if status endpoint temporarily fails.
    }
  }

  async function loadGmailConnectionStatus() {
    if (!session) {
      return;
    }
    try {
      const status = await fetchGmailConnectionStatus();
      setGmailConnection(status);
    } catch {
      setGmailConnection({
        provider: "gmail",
        connectionState: "DISCONNECTED"
      });
    }
  }

  async function handleConnectGmail() {
    try {
      const connectUrl = await fetchGmailConnectUrl();
      window.location.assign(connectUrl);
    } catch (connectError) {
      setError(getUserFacingErrorMessage(connectError, "Failed to start Gmail connection flow."));
    }
  }

  async function handleApprove() {
    if (selectedApprovableIds.length === 0) {
      setError("Select at least one PARSED / NEEDS_REVIEW / FAILED_PARSE invoice to approve.");
      return;
    }

    try {
      setError(null);
      const response = await approveInvoices(selectedApprovableIds, session!.user.email);
      if (response.modifiedCount === 0) {
        setError("No selected invoices were eligible for approval.");
        return;
      }
      await loadInvoices();
    } catch (approveError) {
      setError(getUserFacingErrorMessage(approveError, "Approval failed."));
    }
  }

  async function handleDelete() {
    if (selectedIds.length === 0) {
      return;
    }

    if (!window.confirm(`Delete ${selectedIds.length} invoice(s)? This cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      const response = await deleteInvoices(selectedIds);
      if (response.deletedCount === 0) {
        setError("No selected invoices were eligible for deletion (exported invoices cannot be deleted).");
        return;
      }
      setSelectedIds([]);
      await loadInvoices();
    } catch (deleteError) {
      setError(getUserFacingErrorMessage(deleteError, "Deletion failed."));
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
      setError(getUserFacingErrorMessage(exportError, "Export failed."));
    }
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

  async function handleChangePassword() {
    if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (changePasswordForm.newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    try {
      setError(null);
      await changePassword(changePasswordForm.currentPassword, changePasswordForm.newPassword);
      setShowChangePassword(false);
      setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      await bootstrapSession();
    } catch (changeError) {
      setError(getUserFacingErrorMessage(changeError, "Failed to change password."));
    }
  }

  function handleLogout() {
    clearStoredSessionToken();
    setSession(null);
    setInvoices([]);
    setTenantUsers([]);
    setActiveId(null);
    setPopupInvoiceId(null);
    setActiveTab("dashboard");
    setShowChangePassword(false);
    setPlatformOnboardResult(null);
  }

  async function handleLogin() {
    const normalizedEmail = loginEmail.trim().toLowerCase();
    if (!normalizedEmail || !loginPassword) {
      setError("Enter email and password.");
      return;
    }

    try {
      setLoginSubmitting(true);
      setError(null);
      const token = await loginWithCredentials(normalizedEmail, loginPassword);
      setStoredSessionToken(token);
      setLoginPassword("");
      await bootstrapSession();
    } catch (loginError) {
      setError(getUserFacingErrorMessage(loginError, "Login failed."));
      clearStoredSessionToken();
      setSession(null);
    } finally {
      setLoginSubmitting(false);
    }
  }

  async function handleCompleteOnboarding() {
    if (!session) {
      return;
    }
    try {
      setError(null);
      await completeTenantOnboarding({
        tenantName: onboardingForm.tenantName,
        adminEmail: onboardingForm.adminEmail
      });
      const refreshed = await fetchSessionContext();
      setSession(refreshed);
    } catch (setupError) {
      setError(getUserFacingErrorMessage(setupError, "Failed to complete onboarding."));
    }
  }

  async function handleInviteUser() {
    try {
      setError(null);
      await inviteTenantUser(inviteEmail);
      setInviteEmail("");
      await loadTenantUsers();
    } catch (inviteError) {
      setError(getUserFacingErrorMessage(inviteError, "Failed to invite user."));
    }
  }

  async function handlePlatformOnboardTenantAdmin() {
    const tenantName = platformOnboardForm.tenantName.trim();
    const adminEmail = platformOnboardForm.adminEmail.trim().toLowerCase();
    const adminDisplayName = platformOnboardForm.adminDisplayName.trim();
    if (!tenantName || !adminEmail) {
      setError("Enter tenant name and tenant admin email.");
      return;
    }

    try {
      setError(null);
      const result = await onboardTenantAdmin({
        tenantName,
        adminEmail,
        ...(adminDisplayName ? { adminDisplayName } : {}),
        mode: platformOnboardForm.mode
      });
      setPlatformOnboardForm({
        tenantName: "",
        adminEmail: "",
        adminDisplayName: "",
        mode: "test"
      });
      if (result.tempPassword) {
        setPlatformOnboardResult({ tempPassword: result.tempPassword, adminEmail: result.adminEmail });
      }
      await loadPlatformUsage();
      setPlatformUsageCollapsed(false);
    } catch (onboardError) {
      setError(getUserFacingErrorMessage(onboardError, "Failed to onboard tenant admin."));
    }
  }

  async function handleRoleChange(userId: string, role: "TENANT_ADMIN" | "MEMBER") {
    try {
      setError(null);
      await assignTenantUserRole(userId, role);
      await loadTenantUsers();
    } catch (assignError) {
      setError(getUserFacingErrorMessage(assignError, "Failed to update role."));
    }
  }

  async function handleRemoveUser(userId: string) {
    try {
      setError(null);
      await removeTenantUser(userId);
      await loadTenantUsers();
    } catch (removeError) {
      setError(getUserFacingErrorMessage(removeError, "Failed to remove user."));
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
      if (session?.user.isPlatformAdmin) {
        await loadPlatformUsage();
      }
    } catch (saveError) {
      setError(getUserFacingErrorMessage(saveError, "Failed to save field."));
    }
  }

  async function handleSaveListCell() {
    if (!editingListCell) return;
    const { invoiceId, field } = editingListCell;
    const trimmed = editListValue.trim();
    const parsed: Record<string, string | null> = {};

    if (field === "totalAmountMinor") {
      parsed.totalAmountMajor = trimmed || null;
    } else {
      parsed[field] = trimmed || null;
    }

    try {
      await updateInvoiceParsedFields(invoiceId, { parsed, updatedBy: "ui-user" });
      setEditingListCell(null);
      await loadInvoices();
      if (activeId === invoiceId) {
        await refreshActiveInvoiceDetail();
      }
    } catch (saveError) {
      setError(getUserFacingErrorMessage(saveError, "Failed to save field."));
    }
  }

  if (authLoading) {
    return (
      <div className="layout">
        <main className="content content-list-expanded">
          <section className="panel list-panel">
            <h2>Authenticating...</h2>
          </section>
        </main>
      </div>
    );
  }

  if (!session) {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get("verified") === "true";
    return (
      <>
        {verified ? <div className="verified-banner" style={{ background: "#1f7a6c", color: "#fff", padding: "12px 16px", textAlign: "center" }}>Email verified! You can now log in.</div> : null}
        <LoginPage
          email={loginEmail}
          password={loginPassword}
          submitting={loginSubmitting}
          error={error}
          onEmailChange={setLoginEmail}
          onPasswordChange={setLoginPassword}
          onSubmit={() => {
            void handleLogin();
          }}
        />
      </>
    );
  }

  if (showChangePassword) {
    return (
      <div className="layout">
        <main className="content content-list-expanded">
          <section className="panel list-panel" style={{ maxWidth: 420, margin: "60px auto", padding: 32 }}>
            <h2>Change Your Password</h2>
            <p style={{ marginBottom: 16 }}>You must change your temporary password before continuing.</p>
            {error ? <p className="error">{error}</p> : null}
            <label style={{ display: "block", marginBottom: 12 }}>
              <span>Current Password</span>
              <input type="password" value={changePasswordForm.currentPassword} onChange={(e) => setChangePasswordForm((f) => ({ ...f, currentPassword: e.target.value }))} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span>New Password</span>
              <input type="password" value={changePasswordForm.newPassword} onChange={(e) => setChangePasswordForm((f) => ({ ...f, newPassword: e.target.value }))} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label style={{ display: "block", marginBottom: 16 }}>
              <span>Confirm New Password</span>
              <input type="password" value={changePasswordForm.confirmPassword} onChange={(e) => setChangePasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <button type="button" className="app-button app-button-primary" onClick={() => { void handleChangePassword(); }}>Change Password</button>
          </section>
        </main>
      </div>
    );
  }

  const isTenantAdmin = session.user.role === "TENANT_ADMIN";
  const isPlatformAdmin = session.user.isPlatformAdmin;
  const requiresTenantSetup = session.flags.requires_tenant_setup;

  return (
    <div className={isPlatformAdmin ? "layout layout-platform" : "layout"}>
      {isPlatformAdmin ? (
        <PlatformAdminTopNav userEmail={session.user.email} onLogout={handleLogout} />
      ) : (
        <TenantAdminTopNav userEmail={session.user.email} onLogout={handleLogout} counts={navCounts} />
      )}

      {!isPlatformAdmin ? (
        <TenantViewTabs
          activeTab={activeTab}
          canViewTenantConfig={isTenantAdmin}
          onTabChange={setActiveTab}
        />
      ) : null}

      <section className="controls">

        {requiresTenantSetup && !isPlatformAdmin ? (
          <div className="editor-card">
            <div className="editor-header">
              <h3>Tenant Onboarding</h3>
              {isTenantAdmin ? (
                <button type="button" onClick={() => void handleCompleteOnboarding()}>
                  Complete Onboarding
                </button>
              ) : null}
            </div>
            <div className="edit-grid">
              <label>
                Tenant Name
                <input
                  value={onboardingForm.tenantName}
                  disabled={!isTenantAdmin}
                  onChange={(event) => setOnboardingForm((state) => ({ ...state, tenantName: event.target.value }))}
                />
              </label>
              <label>
                Admin Email
                <input
                  value={onboardingForm.adminEmail}
                  disabled={!isTenantAdmin}
                  onChange={(event) => setOnboardingForm((state) => ({ ...state, adminEmail: event.target.value }))}
                />
              </label>
            </div>
            {!isTenantAdmin ? <p className="muted">Only tenant admins can complete onboarding.</p> : null}
          </div>
        ) : null}

        {activeTab === "exports" && isTenantAdmin && !isPlatformAdmin ? (
          <ExportHistoryDashboard />
        ) : null}

        {activeTab === "config" && isTenantAdmin && !isPlatformAdmin ? (
          <>
            {gmailNeedsReauth ? (
              <div className="mailbox-banner" role="alert">
                <strong>We lost access to your mailbox. Please reconnect.</strong>
                <button type="button" className="app-button app-button-primary" onClick={handleConnectGmail}>
                  Reconnect Gmail
                </button>
              </div>
            ) : null}

            <div className="mailbox-connection-card">
              <span
                className={gmailConnected ? "mailbox-state mailbox-state-connected" : "mailbox-state mailbox-state-idle"}
              >
                {gmailConnected ? "Mailbox Connected" : "Mailbox Not Connected"}
              </span>
              {gmailConnected && gmailEmailAddress ? <span className="mailbox-email">{gmailEmailAddress}</span> : null}
              {!gmailConnected ? (
                <button type="button" className="app-button app-button-secondary" onClick={handleConnectGmail}>
                  {gmailNeedsReauth ? "Reconnect Gmail" : "Connect Gmail"}
                </button>
              ) : null}
            </div>

            <div className="editor-card">
              <div className="editor-header">
                <h3>Tenant Settings</h3>
              </div>
              <div className="edit-grid">
                <label>
                  Invite User Email
                  <input
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="user@example.com"
                  />
                </label>
                <button
                  type="button"
                  className="app-button app-button-primary"
                  onClick={() => void handleInviteUser()}
                  disabled={!inviteEmail.trim()}
                >
                  Send Invite
                </button>
              </div>
              <div className="list-scroll" style={{ maxHeight: "160px" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenantUsers.map((user) => (
                      <tr key={user.userId}>
                        <td>{user.email}</td>
                        <td>
                          <select
                            value={user.role}
                            onChange={(event) =>
                              void handleRoleChange(user.userId, event.target.value as "TENANT_ADMIN" | "MEMBER")
                            }
                          >
                            <option value="TENANT_ADMIN">Tenant Admin</option>
                            <option value="MEMBER">Member</option>
                          </select>
                        </td>
                        <td>
                          <button type="button" className="app-button app-button-secondary" onClick={() => void handleRemoveUser(user.userId)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "dashboard" ? (
          <>
            {isPlatformAdmin ? (
              <>
                <PlatformOverviewHero
                  tenantCount={platformStats.tenants}
                  failedDocuments={platformStats.failedDocuments}
                />
                <PlatformStatsSection
                  stats={platformStats}
                  collapsed={platformStatsCollapsed}
                  onToggle={() => setPlatformStatsCollapsed((currentValue) => !currentValue)}
                />
                <PlatformOnboardSection
                  form={platformOnboardForm}
                  collapsed={platformOnboardCollapsed}
                  onToggle={() => setPlatformOnboardCollapsed((currentValue) => !currentValue)}
                  onChange={setPlatformOnboardForm}
                  onSubmit={() => {
                    void handlePlatformOnboardTenantAdmin();
                  }}
                />
                {platformOnboardResult ? (
                  <div style={{ background: "#e8f5e9", border: "1px solid #4caf50", borderRadius: 6, padding: "12px 16px", margin: "8px 0 16px" }}>
                    <strong>Tenant created.</strong> Temporary password for <code>{platformOnboardResult.adminEmail}</code>: <code>{platformOnboardResult.tempPassword}</code>
                    <button type="button" style={{ marginLeft: 12 }} className="app-button app-button-secondary" onClick={() => setPlatformOnboardResult(null)}>Dismiss</button>
                  </div>
                ) : null}
                <PlatformUsageOverviewSection
                  usage={platformUsage}
                  selectedTenantId={selectedPlatformTenantId}
                  collapsed={platformUsageCollapsed}
                  onToggle={() => setPlatformUsageCollapsed((currentValue) => !currentValue)}
                  onRefresh={() => {
                    void loadPlatformUsage();
                  }}
                  onSelectTenant={setSelectedPlatformTenantId}
                />
                <PlatformActivityMonitor
                  selectedTenant={selectedPlatformTenant}
                  collapsed={platformActivityCollapsed}
                  onToggle={() => setPlatformActivityCollapsed((currentValue) => !currentValue)}
                  onRefresh={() => {
                    void loadPlatformUsage();
                  }}
                />
              </>
            ) : null}

            {!isPlatformAdmin ? (
              <>
                <div className="toolbar">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Search by file, vendor, or invoice #..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
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
                  <span className="toolbar-icon-wrap">
                    <button type="button" className="toolbar-icon-button" onClick={handleApprove} disabled={requiresTenantSetup || selectedApprovableIds.length === 0}>
                      <span className="material-symbols-outlined">check_circle</span>
                    </button>
                    <span className="toolbar-icon-label">Approve</span>
                  </span>
                  <span className="toolbar-icon-wrap">
                    <button type="button" className="toolbar-icon-button" onClick={handleDelete} disabled={requiresTenantSetup || selectedIds.length === 0}>
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                    <span className="toolbar-icon-label">Delete</span>
                  </span>
                  <span className="toolbar-icon-wrap">
                    <button type="button" className="toolbar-icon-button" onClick={handleExport} disabled={requiresTenantSetup || selectedExportableIds.length === 0 || selectedNonExportableCount > 0}>
                      <span className="material-symbols-outlined">upload</span>
                    </button>
                    <span className="toolbar-icon-label">Export to Tally</span>
                  </span>
                  <span className="toolbar-icon-wrap">
                    <button type="button" className="toolbar-icon-button" onClick={handleDownloadXml} disabled={requiresTenantSetup || selectedExportableIds.length === 0 || selectedNonExportableCount > 0}>
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
                  <input ref={uploadInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{ display: "none" }} onChange={handleUpload} />
                  <span className="toolbar-icon-wrap">
                    <button type="button" className="toolbar-icon-button" onClick={handleIngest} disabled={requiresTenantSetup || ingestionStatus?.running === true}>
                      <span className="material-symbols-outlined">play_arrow</span>
                    </button>
                    <span className="toolbar-icon-label">{ingestionStatus?.state === "paused" ? "Resume" : "Ingest"}</span>
                  </span>
                  {ingestionStatus?.running === true ? (
                    <span className="toolbar-icon-wrap">
                      <button type="button" className="toolbar-icon-button" onClick={handlePauseIngestion}>
                        <span className="material-symbols-outlined">pause</span>
                      </button>
                      <span className="toolbar-icon-label">Pause</span>
                    </span>
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
              </>
            ) : null}
          </>
        ) : null}
      </section>

      {error ? <p className="error">{error}</p> : null}

      {!isPlatformAdmin && activeTab === "dashboard" ? (
        <main className={contentClassName}>
          <>
            <section className="panel list-panel">
              <div className="panel-title">
                <h2>Invoices</h2>
                {loading ? <span>Loading...</span> : <span>{invoices.length} records</span>}
              </div>

              <div className="list-scroll">
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
                        <tr key={invoice._id} className={rowClasses || undefined} onClick={() => { setActiveId(invoice._id); setDetailsPanelCollapsed(false); }}>
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
                                setPopupInvoiceId(invoice._id);
                              }}
                            >
                              {invoice.attachmentName}
                            </button>
                          </td>
                          <td className="extracted-value-cell" onClick={(e) => e.stopPropagation()}>
                            {editingListCell?.invoiceId === invoice._id && editingListCell.field === "vendorName" ? (
                              <>
                                <input className="extracted-value-input" value={editListValue} onChange={(e) => setEditListValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveListCell(); if (e.key === "Escape") setEditingListCell(null); }} autoFocus />
                                <button type="button" className="field-save-button" onClick={() => void handleSaveListCell()}>&#10003;</button>
                              </>
                            ) : (
                              <span className="extracted-value-display" {...(canEditCell ? { "data-editable": true, onClick: () => { setEditingListCell({ invoiceId: invoice._id, field: "vendorName" }); setEditListValue(invoice.parsed?.vendorName ?? ""); } } : {})}>{invoice.parsed?.vendorName ?? "-"}</span>
                            )}
                          </td>
                          <td className="extracted-value-cell" onClick={(e) => e.stopPropagation()}>
                            {editingListCell?.invoiceId === invoice._id && editingListCell.field === "invoiceNumber" ? (
                              <>
                                <input className="extracted-value-input" value={editListValue} onChange={(e) => setEditListValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveListCell(); if (e.key === "Escape") setEditingListCell(null); }} autoFocus />
                                <button type="button" className="field-save-button" onClick={() => void handleSaveListCell()}>&#10003;</button>
                              </>
                            ) : (
                              <span className="extracted-value-display" {...(canEditCell ? { "data-editable": true, onClick: () => { setEditingListCell({ invoiceId: invoice._id, field: "invoiceNumber" }); setEditListValue(invoice.parsed?.invoiceNumber ?? ""); } } : {})}>{invoice.parsed?.invoiceNumber ?? "-"}</span>
                            )}
                          </td>
                          <td>{invoice.parsed?.invoiceDate ?? "-"}</td>
                          <td
                            className={
                              [invoice.riskFlags.includes("TOTAL_AMOUNT_ABOVE_EXPECTED") ? "value-risk" : null, "extracted-value-cell"].filter(Boolean).join(" ")
                            }
                            onClick={(e) => e.stopPropagation()}
                          >
                            {editingListCell?.invoiceId === invoice._id && editingListCell.field === "totalAmountMinor" ? (
                              <>
                                <input className="extracted-value-input" value={editListValue} onChange={(e) => setEditListValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleSaveListCell(); if (e.key === "Escape") setEditingListCell(null); }} autoFocus />
                                <button type="button" className="field-save-button" onClick={() => void handleSaveListCell()}>&#10003;</button>
                              </>
                            ) : (
                              <span className="extracted-value-display" {...(canEditCell ? { "data-editable": true, onClick: () => { setEditingListCell({ invoiceId: invoice._id, field: "totalAmountMinor" }); setEditListValue(invoice.parsed?.totalAmountMinor != null ? String(invoice.parsed.totalAmountMinor / 100) : ""); } } : {})}>{formatMinorAmountWithCurrency(invoice.parsed?.totalAmountMinor, invoice.parsed?.currency)}</span>
                            )}
                          </td>
                          <td>
                            <ConfidenceBadge score={invoice.confidenceScore ?? 0} />
                          </td>
                          <td>
                            <span className={`status status-${invoice.status.toLowerCase()}`} title={invoice.approval?.approvedBy ? `Approved by ${invoice.approval.approvedBy}` : undefined}>{invoice.status}</span>
                            {invoice.possibleDuplicate ? (
                              <span className="material-symbols-outlined duplicate-warning" title="Possible duplicate — another invoice has identical file contents">warning</span>
                            ) : null}
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
            ) : null}
          </>
        </main>
      ) : null}

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
              {popupInvoice.ocrText && session?.tenant.mode !== "live" ? (
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
    </div>
  );
}
