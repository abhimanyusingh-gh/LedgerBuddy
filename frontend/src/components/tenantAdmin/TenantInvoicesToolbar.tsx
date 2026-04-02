import { type ChangeEvent, type DragEvent, type RefObject } from "react";
import type { IngestionJobStatus, TenantRole } from "../../types";
import { STATUS_LABELS, STATUSES } from "../../invoiceView";

interface TenantUserSummary {
  userId: string;
  email: string;
  role: TenantRole;
  enabled: boolean;
}

interface TenantInvoicesToolbarProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  invoiceDateFrom: string;
  onInvoiceDateFromChange: (value: string) => void;
  invoiceDateTo: string;
  onInvoiceDateToChange: (value: string) => void;
  statusFilter: (typeof STATUSES)[number];
  onStatusFilterChange: (value: (typeof STATUSES)[number]) => void;
  allStatusCounts: Record<string, number>;
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
  canViewAllInvoices: boolean;
  tenantUsers?: TenantUserSummary[];
  approvedByFilter: string;
  onApprovedByFilterChange: (value: string) => void;
  canApproveInvoices: boolean;
  canDeleteInvoices: boolean;
  canRetryInvoices: boolean;
  canUploadFiles: boolean;
  canStartIngestion: boolean;
  requiresTenantSetup: boolean;
  selectedApprovableCount: number;
  selectedDeleteCount: number;
  selectedRetryableCount: number;
  actionLoading: string | null;
  ingestionStatus: IngestionJobStatus | null;
  detailsPanelVisible: boolean;
  onToggleDetailsPanel: () => void;
  tableDensity: "compact" | "comfortable" | "spacious";
  onTableDensityChange: (value: "compact" | "comfortable" | "spacious") => void;
  uploadInputRef: RefObject<HTMLInputElement>;
  onUploadButtonClick: () => void;
  onUploadFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  uploadDragActive: boolean;
  onUploadDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onUploadDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onUploadDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onUploadDrop: (event: DragEvent<HTMLDivElement>) => void;
  onApprove: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onIngest: () => void;
  onPauseIngestion: () => void;
}

export function TenantInvoicesToolbar({
  searchQuery,
  onSearchQueryChange,
  invoiceDateFrom,
  onInvoiceDateFromChange,
  invoiceDateTo,
  onInvoiceDateToChange,
  statusFilter,
  onStatusFilterChange,
  allStatusCounts,
  hasActiveFilters,
  onClearAllFilters,
  canViewAllInvoices,
  tenantUsers,
  approvedByFilter,
  onApprovedByFilterChange,
  canApproveInvoices,
  canDeleteInvoices,
  canRetryInvoices,
  canUploadFiles,
  canStartIngestion,
  requiresTenantSetup,
  selectedApprovableCount,
  selectedDeleteCount,
  selectedRetryableCount,
  actionLoading,
  ingestionStatus,
  detailsPanelVisible,
  onToggleDetailsPanel,
  tableDensity,
  onTableDensityChange,
  uploadInputRef,
  onUploadButtonClick,
  onUploadFileChange,
  uploadDragActive,
  onUploadDragEnter,
  onUploadDragOver,
  onUploadDragLeave,
  onUploadDrop,
  onApprove,
  onDelete,
  onRetry,
  onIngest,
  onPauseIngestion
}: TenantInvoicesToolbarProps) {
  return (
    <>
      <div className="toolbar">
        <div className="toolbar-filter-group">
          <input
            type="text"
            className="search-input"
            placeholder="Search by file, vendor, or invoice #..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
          />
          <input
            type="date"
            style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}
            value={invoiceDateFrom}
            max={invoiceDateTo || undefined}
            onChange={(e) => onInvoiceDateFromChange(e.target.value)}
            title="Filter from date"
          />
          <input
            type="date"
            style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "0.3rem 0.5rem", fontSize: "0.82rem" }}
            value={invoiceDateTo}
            min={invoiceDateFrom || undefined}
            onChange={(e) => onInvoiceDateToChange(e.target.value)}
            title="Filter to date"
          />
        </div>
        <div className="toolbar-divider" />
        <div className="status-tabs">
          {STATUSES.map((status) => (
            <button
              key={status}
              className={status === statusFilter ? "tab tab-active" : "tab"}
              onClick={() => onStatusFilterChange(status)}
            >
              {STATUS_LABELS[status] ?? status}
              {allStatusCounts[status] != null ? <span className="tab-count">{allStatusCounts[status]}</span> : null}
            </button>
          ))}
        </div>
        {hasActiveFilters ? (
          <button type="button" className="clear-filters-pill" onClick={onClearAllFilters}>
            <span className="material-symbols-outlined" style={{ fontSize: "0.85rem" }}>close</span>
            Clear filters
          </button>
        ) : null}
        {canViewAllInvoices && tenantUsers && tenantUsers.length > 0 ? (
          <>
            <div className="toolbar-divider" />
            <select className="search-input" style={{ flex: "none", minWidth: "auto", width: "auto" }} value={approvedByFilter} onChange={(e) => onApprovedByFilterChange(e.target.value)}>
              <option value="">All Users</option>
              {tenantUsers.map((u) => <option key={u.userId} value={u.userId}>{u.email}</option>)}
            </select>
          </>
        ) : null}
        {canApproveInvoices || canDeleteInvoices || canRetryInvoices || canUploadFiles || canStartIngestion ? (
          <>
            <div className="toolbar-divider" />
            {canApproveInvoices ? (
              <span className="toolbar-icon-wrap">
                <button type="button" className={`toolbar-icon-button${actionLoading === "approve" ? " app-button-loading" : ""}`} onClick={onApprove} disabled={requiresTenantSetup || selectedApprovableCount === 0}>
                  <span className="material-symbols-outlined">check_circle</span>
                </button>
                <span className="toolbar-icon-label">Approve</span>
              </span>
            ) : null}
            {canDeleteInvoices ? (
              <span className="toolbar-icon-wrap">
                <button type="button" className={`toolbar-icon-button${actionLoading === "delete" ? " app-button-loading" : ""}`} onClick={onDelete} disabled={requiresTenantSetup || selectedDeleteCount === 0}>
                  <span className="material-symbols-outlined">delete</span>
                </button>
                <span className="toolbar-icon-label">Delete</span>
              </span>
            ) : null}
            {canRetryInvoices ? (
              <span className="toolbar-icon-wrap">
                <button type="button" className="toolbar-icon-button" onClick={onRetry} disabled={requiresTenantSetup || selectedRetryableCount === 0}>
                  <span className="material-symbols-outlined">replay</span>
                </button>
                <span className="toolbar-icon-label">Retry</span>
              </span>
            ) : null}
            {canUploadFiles ? (
              <>
                <span className="toolbar-icon-wrap">
                  <button type="button" className="toolbar-icon-button" onClick={onUploadButtonClick} disabled={requiresTenantSetup}>
                    <span className="material-symbols-outlined">upload_file</span>
                  </button>
                  <span className="toolbar-icon-label">Upload</span>
                </span>
                <input ref={uploadInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png" style={{ display: "none" }} onChange={onUploadFileChange} />
              </>
            ) : null}
            {canStartIngestion ? (
              <>
                <span className="toolbar-icon-wrap">
                  <button type="button" className="toolbar-icon-button" onClick={onIngest} disabled={requiresTenantSetup || ingestionStatus?.running === true}>
                    <span className="material-symbols-outlined">play_arrow</span>
                  </button>
                  <span className="toolbar-icon-label">{ingestionStatus?.state === "paused" ? "Resume" : "Ingest"}</span>
                </span>
                {ingestionStatus?.running === true ? (
                  <span className="toolbar-icon-wrap">
                    <button type="button" className="toolbar-icon-button" onClick={onPauseIngestion}>
                      <span className="material-symbols-outlined">pause</span>
                    </button>
                    <span className="toolbar-icon-label">Pause</span>
                  </span>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
        <span className="toolbar-icon-wrap">
          <button type="button" className="toolbar-icon-button" onClick={onToggleDetailsPanel}>
            <span className="material-symbols-outlined">{detailsPanelVisible ? "visibility_off" : "visibility"}</span>
          </button>
          <span className="toolbar-icon-label">{detailsPanelVisible ? "Hide Details" : "Show Details"}</span>
        </span>
        <div className="toolbar-divider" />
        <select className="search-input" style={{ flex: "none", minWidth: "auto", width: "auto", fontSize: "0.8rem" }} value={tableDensity} onChange={(e) => onTableDensityChange(e.target.value as "compact" | "comfortable" | "spacious")}>
          <option value="compact">Compact</option>
          <option value="comfortable">Comfortable</option>
          <option value="spacious">Spacious</option>
        </select>
      </div>
      {canUploadFiles ? (
        <div
          className={uploadDragActive ? "file-dropzone file-dropzone-active" : "file-dropzone"}
          role="button"
          tabIndex={0}
          onClick={onUploadButtonClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onUploadButtonClick();
            }
          }}
          onDragEnter={onUploadDragEnter}
          onDragOver={onUploadDragOver}
          onDragLeave={onUploadDragLeave}
          onDrop={onUploadDrop}
        >
          <span className="material-symbols-outlined" aria-hidden="true">upload_file</span>
          <div>
            <strong>Drop invoices here</strong>
            <p>PDF, JPG, JPEG, and PNG supported. Click to browse.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
