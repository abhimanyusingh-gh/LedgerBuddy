import { useEffect, useMemo, useRef, useState } from "react";
import {
  approveInvoices,
  assignTenantUserRole,
  clearStoredSessionToken,
  completeTenantOnboarding,
  exportToTally,
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
  getStoredSessionToken,
  inviteTenantUser,
  runEmailSimulationIngestion,
  runIngestion,
  setStoredSessionToken,
  removeTenantUser,
  updateInvoiceParsedFields
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
import { TenantViewTabs } from "./components/tenantAdmin/TenantViewTabs";
import { TenantWorkspaceHero } from "./components/tenantAdmin/TenantWorkspaceHero";
import { formatOcrConfidenceLabel, getExtractedFieldRows } from "./extractedFields";
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
  buildEditForm,
  buildFieldCropUrlMap,
  buildFieldOverlayUrlMap,
  EMPTY_EDIT_FORM,
  normalizeAmountInput,
  normalizeTextInput,
  type EditInvoiceFormState,
  STATUSES
} from "./invoiceView";
import { useInvoiceDetail } from "./hooks/useInvoiceDetail";

export function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState<{
    user: { id: string; email: string; role: "TENANT_ADMIN" | "MEMBER"; isPlatformAdmin: boolean };
    tenant: { id: string; name: string; onboarding_status: "pending" | "completed" };
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
    adminDisplayName: ""
  });
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [popupSourcePreviewExpanded, setPopupSourcePreviewExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [popupInvoiceId, setPopupInvoiceId] = useState<string | null>(null);
  const [detailsPanelVisible, setDetailsPanelVisible] = useState(true);
  const [detailsPanelCollapsed, setDetailsPanelCollapsed] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionStatus | null>(null);
  const [editingParsedFields, setEditingParsedFields] = useState(false);
  const [savingParsedFields, setSavingParsedFields] = useState(false);
  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginPassword, setLoginPassword] = useState<string>("");
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [showTenantConfig, setShowTenantConfig] = useState(false);
  const [selectedPlatformTenantId, setSelectedPlatformTenantId] = useState<string | null>(null);
  const [platformStatsCollapsed, setPlatformStatsCollapsed] = useState(false);
  const [platformOnboardCollapsed, setPlatformOnboardCollapsed] = useState(false);
  const [platformUsageCollapsed, setPlatformUsageCollapsed] = useState(false);
  const [platformActivityCollapsed, setPlatformActivityCollapsed] = useState(false);
  const [editForm, setEditForm] = useState<EditInvoiceFormState>(EMPTY_EDIT_FORM);
  const [ingestionStatus, setIngestionStatus] = useState<IngestionJobStatus | null>(null);
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
      setShowTenantConfig(false);
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
      setShowTenantConfig(false);
    }
  }, [session?.user.role]);

  useEffect(() => {
    setPopupSourcePreviewExpanded(false);
  }, [popupInvoiceId]);

  const activeInvoiceSummary = useMemo(
    () => invoices.find((invoice) => invoice._id === activeId) ?? null,
    [activeId, invoices]
  );
  const activeInvoice = useMemo(() => {
    if (!activeInvoiceSummary) {
      return activeInvoiceDetail;
    }
    if (!activeInvoiceDetail || activeInvoiceDetail._id !== activeInvoiceSummary._id) {
      return activeInvoiceSummary;
    }
    const detailUpdatedAt = Date.parse(activeInvoiceDetail.updatedAt);
    const summaryUpdatedAt = Date.parse(activeInvoiceSummary.updatedAt);
    return Number.isFinite(detailUpdatedAt) && detailUpdatedAt >= summaryUpdatedAt
      ? activeInvoiceDetail
      : activeInvoiceSummary;
  }, [activeInvoiceDetail, activeInvoiceSummary]);

  const failedCount = useMemo(
    () => invoices.filter((invoice) => ["FAILED_OCR", "FAILED_PARSE"].includes(invoice.status)).length,
    [invoices]
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
  const popupInvoice = useMemo(() => {
    if (!popupInvoiceSummary) {
      return popupInvoiceDetail;
    }
    if (!popupInvoiceDetail || popupInvoiceDetail._id !== popupInvoiceSummary._id) {
      return popupInvoiceSummary;
    }
    const detailUpdatedAt = Date.parse(popupInvoiceDetail.updatedAt);
    const summaryUpdatedAt = Date.parse(popupInvoiceSummary.updatedAt);
    return Number.isFinite(detailUpdatedAt) && detailUpdatedAt >= summaryUpdatedAt
      ? popupInvoiceDetail
      : popupInvoiceSummary;
  }, [popupInvoiceDetail, popupInvoiceSummary]);

  const activeExtractedRows = useMemo(
    () => (activeInvoice ? getExtractedFieldRows(activeInvoice) : []),
    [activeInvoice]
  );

  const activeTallyMappings = useMemo(
    () => (activeInvoice ? getInvoiceTallyMappings(activeInvoice) : []),
    [activeInvoice]
  );
  const activeCropUrlByField = useMemo(() => {
    if (!activeInvoice) {
      return {};
    }
    return buildFieldCropUrlMap(activeInvoice._id, getInvoiceSourceHighlights(activeInvoice), getInvoiceBlockCropUrl);
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
      setError(loadError instanceof Error ? loadError.message : "Failed to load tenant users.");
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
      setError(loadError instanceof Error ? loadError.message : "Failed to load tenant usage overview.");
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
    if (!activeInvoice) {
      setEditForm(EMPTY_EDIT_FORM);
      setEditingParsedFields(false);
      return;
    }

    setEditForm(buildEditForm(activeInvoice));
    setEditingParsedFields(false);
  }, [activeInvoice]);

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
      void loadGmailConnectionStatus();
    }

    ingestionWasRunningRef.current = isRunning;
  }, [ingestionStatus?.running, ingestionStatus?.state, ingestionStatus?.error]);

  async function loadInvoices() {
    if (!session) {
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const data = await fetchInvoices(statusFilter === "ALL" ? undefined : statusFilter);
      setInvoices(data.items);
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
      if (loadError instanceof Error && /401|Authentication required|bearer token/i.test(loadError.message)) {
        clearStoredSessionToken();
        setSession(null);
      } else {
        setError(loadError instanceof Error ? loadError.message : "Failed to fetch invoices");
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
      setError(connectError instanceof Error ? connectError.message : "Failed to start Gmail connection flow.");
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

  async function handleEmailSimulationIngest() {
    try {
      setError(null);
      const status = await runEmailSimulationIngestion();
      setIngestionStatus(status);
    } catch (ingestError) {
      setError(ingestError instanceof Error ? ingestError.message : "Email simulation ingestion failed");
    }
  }

  function handleLogout() {
    clearStoredSessionToken();
    setSession(null);
    setInvoices([]);
    setTenantUsers([]);
    setActiveId(null);
    setPopupInvoiceId(null);
    setShowTenantConfig(false);
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
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
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
      setError(setupError instanceof Error ? setupError.message : "Failed to complete onboarding.");
    }
  }

  async function handleInviteUser() {
    try {
      setError(null);
      await inviteTenantUser(inviteEmail);
      setInviteEmail("");
      await loadTenantUsers();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Failed to invite user.");
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
      await onboardTenantAdmin({
        tenantName,
        adminEmail,
        ...(adminDisplayName ? { adminDisplayName } : {})
      });
      setPlatformOnboardForm({
        tenantName: "",
        adminEmail: "",
        adminDisplayName: ""
      });
      await loadPlatformUsage();
    } catch (onboardError) {
      setError(onboardError instanceof Error ? onboardError.message : "Failed to onboard tenant admin.");
    }
  }

  async function handleRoleChange(userId: string, role: "TENANT_ADMIN" | "MEMBER") {
    try {
      setError(null);
      await assignTenantUserRole(userId, role);
      await loadTenantUsers();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Failed to update role.");
    }
  }

  async function handleRemoveUser(userId: string) {
    try {
      setError(null);
      await removeTenantUser(userId);
      await loadTenantUsers();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Failed to remove user.");
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
      if (session?.user.isPlatformAdmin) {
        await loadPlatformUsage();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update parsed invoice fields");
    } finally {
      setSavingParsedFields(false);
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
    return (
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
        <TenantAdminTopNav userEmail={session.user.email} onLogout={handleLogout} />
      )}

      {!isPlatformAdmin ? (
        <>
          <TenantWorkspaceHero
            tenantName={session.tenant.name}
            totalInvoices={invoices.length}
            failedInvoices={failedCount}
          />
          <TenantViewTabs
            showTenantConfig={showTenantConfig}
            canViewTenantConfig={isTenantAdmin}
            onShowDashboard={() => setShowTenantConfig(false)}
            onShowTenantConfig={() => setShowTenantConfig(true)}
          />
        </>
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

        {showTenantConfig && isTenantAdmin && !isPlatformAdmin ? (
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

        {!showTenantConfig ? (
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
                  <button
                    type="button"
                    className="app-button app-button-secondary"
                    onClick={handleIngest}
                    disabled={requiresTenantSetup || ingestionStatus?.running === true}
                  >
                    {ingestionStatus?.running ? "Ingestion Running..." : "Run Ingestion"}
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-secondary"
                    onClick={handleEmailSimulationIngest}
                    disabled={requiresTenantSetup || ingestionStatus?.running === true}
                  >
                    {ingestionStatus?.running ? "Ingestion Running..." : "Ingest Demo Emails"}
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-secondary"
                    onClick={toggleSelectAllVisible}
                    disabled={selectableVisibleIds.length === 0}
                  >
                    {areAllVisibleSelectableSelected ? "Deselect All" : "Select All"}
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-primary"
                    onClick={handleApprove}
                    disabled={requiresTenantSetup || selectedApprovableIds.length === 0}
                  >
                    Approve Selected
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-primary"
                    onClick={handleExport}
                    disabled={requiresTenantSetup || selectedExportableIds.length === 0 || selectedNonExportableCount > 0}
                  >
                    Export To Tally ({selectedExportableIds.length})
                  </button>
                  <button
                    type="button"
                    className="app-button app-button-secondary"
                    onClick={() => setDetailsPanelVisible((currentValue) => !currentValue)}
                  >
                    {detailsPanelVisible ? "Hide Details Panel" : "Show Details Panel"}
                  </button>
                  <button type="button" className="app-button app-button-secondary" onClick={() => void loadInvoices()}>
                    Refresh
                  </button>
                </div>
                <IngestionProgressCard
                  status={ingestionStatus}
                  progressPercent={ingestionProgressPercent}
                  successfulFiles={ingestionSuccessfulFiles}
                />
                <p className="muted export-selection">
                  {selectedIds.length} selected | {selectedExportableIds.length} approved exportable
                  {selectedNonExportableCount > 0
                    ? ` | ${selectedNonExportableCount} non-approved must be deselected for export`
                    : ""}
                </p>
              </>
            ) : null}
          </>
        ) : null}
      </section>

      {error ? <p className="error">{error}</p> : null}

      {!isPlatformAdmin ? (
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
                  {activeInvoiceDetailLoading ? <p className="muted">Loading full invoice details...</p> : null}
                  <div className="detail-grid">
                    <p>
                      <span>File</span>
                      <strong>{activeInvoice.attachmentName}</strong>
                    </p>
                    <p>
                      <span>Vendor</span>
                      <strong>{activeInvoice.parsed?.vendorName ?? "-"}</strong>
                    </p>
                    <p>
                      <span>Invoice Number</span>
                      <strong>{activeInvoice.parsed?.invoiceNumber ?? "-"}</strong>
                    </p>
                    <p>
                      <span>Invoice Date</span>
                      <strong>{activeInvoice.parsed?.invoiceDate ?? "-"}</strong>
                    </p>
                    <p>
                      <span>Due Date</span>
                      <strong>{activeInvoice.parsed?.dueDate ?? "-"}</strong>
                    </p>
                    <p>
                      <span>Total Amount</span>
                      <strong>
                        {formatMinorAmountWithCurrency(activeInvoice.parsed?.totalAmountMinor, activeInvoice.parsed?.currency)}
                      </strong>
                    </p>
                    <p>
                      <span>Status</span>
                      <strong>{activeInvoice.status}</strong>
                    </p>
                    <p>
                      <span>Confidence</span>
                      <strong><ConfidenceBadge score={activeInvoice.confidenceScore ?? 0} /></strong>
                    </p>
                    <p>
                      <span>Read Confidence</span>
                      <strong>{formatOcrConfidenceLabel(activeInvoice.ocrConfidence)}</strong>
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
                        {(activeInvoice.riskMessages ?? []).length > 0 ? (
                          <ul>
                            {(activeInvoice.riskMessages ?? []).map((entry) => (
                              <li key={entry}>{entry}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">No high-value risk signals.</p>
                        )}
                      </div>

                      <div>
                        <h3>Parse Errors / Warnings</h3>
                        {(activeInvoice.processingIssues ?? []).length > 0 ? (
                          <ul>
                            {(activeInvoice.processingIssues ?? []).map((entry) => (
                              <li key={entry}>{entry}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">None</p>
                        )}
                      </div>

                      <div>
                        <h3>Extracted Invoice Fields</h3>
                        <ExtractedFieldsTable rows={activeExtractedRows} cropUrlByField={activeCropUrlByField} />
                      </div>

                      <div>
                        <h3>Export Mapping</h3>
                        <TallyMappingTable rows={activeTallyMappings} />
                      </div>
                    </>
                  ) : (
                    <p className="muted">Details are collapsed. Expand to inspect extracted fields and export mapping.</p>
                  )}
                </div>
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
              Status: <strong>{popupInvoice.status}</strong> | Received: {new Date(popupInvoice.receivedAt).toLocaleString()}
            </p>
            <div className="popup-content">
              {popupInvoiceDetailLoading ? <p className="muted">Loading full invoice details...</p> : null}
              {Object.keys(popupOverlayUrlByField).length > 0 ? (
                <div className="source-preview-section">
                  <button
                    type="button"
                    className="source-preview-toggle"
                    onClick={() => setPopupSourcePreviewExpanded((currentValue) => !currentValue)}
                  >
                    {popupSourcePreviewExpanded ? "Hide Value Source Highlights" : "Show Value Source Highlights"}
                  </button>
                  {popupSourcePreviewExpanded ? (
                    <InvoiceSourceViewer invoice={popupInvoice} overlayUrlByField={popupOverlayUrlByField} />
                  ) : null}
                </div>
              ) : null}
              <div>
                <h3>Extracted Invoice Fields</h3>
                <ExtractedFieldsTable rows={popupExtractedRows} cropUrlByField={popupCropUrlByField} />
              </div>
              <div>
                <h3>Export Mapping</h3>
                <TallyMappingTable rows={popupTallyMappings} />
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
