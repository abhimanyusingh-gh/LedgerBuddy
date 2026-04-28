import { useEffect, useState } from "react";
import { fetchExportHistory, downloadTallyXmlFile } from "@/api";
import type { ExportBatchSummary } from "@/types";
import { EmptyState } from "@/components/common/EmptyState";
import {
  useUserPrefsStore,
  EXPORT_SORT_KEY,
  SORT_DIRECTION,
  type ExportSortKey
} from "@/stores/userPrefsStore";

function formatName(value?: string): string {
  if (!value) return "-";
  const at = value.indexOf("@");
  if (at <= 0) return value;
  return value.slice(0, at).replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ExportHistoryDashboard() {
  const [items, setItems] = useState<ExportBatchSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const pageSize = useUserPrefsStore((state) => state.exportHistory.pageSize);
  const dateFrom = useUserPrefsStore((state) => state.exportHistory.dateFrom);
  const dateTo = useUserPrefsStore((state) => state.exportHistory.dateTo);
  const sortKey = useUserPrefsStore((state) => state.exportHistory.sortKey);
  const sortDir = useUserPrefsStore((state) => state.exportHistory.sortDirection);
  const setExportHistory = useUserPrefsStore((state) => state.setExportHistory);

  useEffect(() => { void loadHistory(); }, [page, pageSize]);

  async function loadHistory() {
    setLoading(true);
    try {
      const result = await fetchExportHistory(page, pageSize);
      setItems(result.items);
      setTotal(result.total);
    } catch { setItems([]); } finally { setLoading(false); }
  }

  async function handleDownload(batchId: string) {
    try {
      const blob = await downloadTallyXmlFile(batchId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `tally-export-${batchId}.xml`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  }

  function toggleSort(key: ExportSortKey) {
    if (sortKey === key) {
      setExportHistory({
        sortDirection: sortDir === SORT_DIRECTION.ASC ? SORT_DIRECTION.DESC : SORT_DIRECTION.ASC
      });
    } else {
      setExportHistory({ sortKey: key, sortDirection: SORT_DIRECTION.ASC });
    }
  }

  let displayed = items;
  if (dateFrom) { const from = new Date(dateFrom); displayed = displayed.filter((b) => new Date(b.createdAt) >= from); }
  if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); displayed = displayed.filter((b) => new Date(b.createdAt) <= to); }

  const dir: number = sortDir === SORT_DIRECTION.ASC ? 1 : -1;
  displayed = [...displayed].sort((a, b) => {
    switch (sortKey) {
      case EXPORT_SORT_KEY.DATE: return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      case EXPORT_SORT_KEY.TOTAL: return (a.total - b.total) * dir;
      case EXPORT_SORT_KEY.SUCCESS: return (a.successCount - b.successCount) * dir;
      case EXPORT_SORT_KEY.FAILED: return (a.failureCount - b.failureCount) * dir;
      case EXPORT_SORT_KEY.REQUESTED_BY: return a.requestedBy.localeCompare(b.requestedBy) * dir;
      default: return 0;
    }
  });

  const totalPages = Math.ceil(total / pageSize);
  const hasFilters = dateFrom !== "" || dateTo !== "";
  const sortIcon = (key: ExportSortKey) =>
    sortKey === key ? (sortDir === SORT_DIRECTION.ASC ? " ▲" : " ▼") : "";

  const setDateFrom = (value: string) => setExportHistory({ dateFrom: value });
  const setDateTo = (value: string) => setExportHistory({ dateTo: value });
  const setPageSize = (value: number) => setExportHistory({ pageSize: value });

  return (
    <section className="export-history-section">
      <div className="panel-title">
        <h2>Export History</h2>
        <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{total} records</span>
      </div>
      <div className="toolbar-filter-row" style={{ padding: "0.4rem 0.65rem" }}>
        <input type="date" className="toolbar-date-input" value={dateFrom} max={dateTo || undefined} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} title="From date" />
        <input type="date" className="toolbar-date-input" value={dateTo} min={dateFrom || undefined} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} title="To date" />
        {hasFilters ? (
          <button type="button" className="clear-filters-pill" onClick={() => { setDateFrom(""); setDateTo(""); setPage(1); }}>
            <span className="material-symbols-outlined" style={{ fontSize: "0.85rem" }}>close</span> Clear
          </button>
        ) : null}
      </div>

      {loading ? <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem", padding: "0.5rem 0.65rem" }}>Loading...</p> : null}

      {!loading && displayed.length === 0 ? (
        <EmptyState
          icon={hasFilters ? "filter_list_off" : "cloud_done"}
          heading={hasFilters ? "No exports in this range" : "No exports yet"}
          description={hasFilters ? "Try adjusting the date range." : "Approve invoices and export them to Tally to see history here."}
          action={hasFilters ? <button type="button" className="app-button app-button-secondary" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear Filters</button> : undefined}
        />
      ) : null}

      {displayed.length > 0 ? (
        <>
          <div className="export-history-table-wrap">
            <table className="export-history-table">
              <thead>
                <tr>
                  <th className="sortable-th" onClick={() => toggleSort(EXPORT_SORT_KEY.DATE)}>Date{sortIcon(EXPORT_SORT_KEY.DATE)}</th>
                  <th className="sortable-th" onClick={() => toggleSort(EXPORT_SORT_KEY.TOTAL)}>Total{sortIcon(EXPORT_SORT_KEY.TOTAL)}</th>
                  <th className="sortable-th" onClick={() => toggleSort(EXPORT_SORT_KEY.SUCCESS)}>Success{sortIcon(EXPORT_SORT_KEY.SUCCESS)}</th>
                  <th className="sortable-th" onClick={() => toggleSort(EXPORT_SORT_KEY.FAILED)}>Failed{sortIcon(EXPORT_SORT_KEY.FAILED)}</th>
                  <th className="sortable-th" onClick={() => toggleSort(EXPORT_SORT_KEY.REQUESTED_BY)}>Requested By{sortIcon(EXPORT_SORT_KEY.REQUESTED_BY)}</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((batch) => (
                  <tr key={batch.batchId}>
                    <td>{new Date(batch.createdAt).toLocaleString()}</td>
                    <td>{batch.total}</td>
                    <td>{batch.successCount}</td>
                    <td>{batch.failureCount}</td>
                    <td title={batch.requestedBy}>{formatName(batch.requestedBy)}</td>
                    <td>
                      {batch.hasFile ? (
                        <button type="button" className="app-button app-button-secondary app-button-sm" onClick={() => void handleDownload(batch.batchId)}>Download</button>
                      ) : <span style={{ color: "var(--ink-soft)" }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-bar">
            <div className="pagination-info">{Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)} of {total}</div>
            <div className="pagination">
              <button type="button" className="app-button app-button-secondary app-button-sm" disabled={page <= 1} onClick={() => setPage(1)}>First</button>
              <button type="button" className="app-button app-button-secondary app-button-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <button type="button" className="app-button app-button-secondary app-button-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              <button type="button" className="app-button app-button-secondary app-button-sm" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Last</button>
            </div>
            <div className="pagination-size">
              <span>Rows:</span>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
