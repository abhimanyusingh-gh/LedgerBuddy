import { useState, useEffect } from "react";
import { fetchExportHistory, downloadTallyXmlFile } from "@/api";
import type { ExportBatchSummary } from "@/types";
import { EmptyState } from "@/components/common/EmptyState";

function formatName(value?: string): string {
  if (!value) return "-";
  const at = value.indexOf("@");
  if (at <= 0) return value;
  return value.slice(0, at).replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function loadStored<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}

function persist(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }

type SortKey = "date" | "total" | "success" | "failed" | "requestedBy";

export function ExportHistoryDashboard() {
  const [items, setItems] = useState<ExportBatchSummary[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => loadStored("ledgerbuddy:export-page-size", 20));
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(() => loadStored("ledgerbuddy:export-from", ""));
  const [dateTo, setDateTo] = useState(() => loadStored("ledgerbuddy:export-to", ""));
  const [sortKey, setSortKey] = useState<SortKey>(() => loadStored("ledgerbuddy:export-sort-key", "date"));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => loadStored("ledgerbuddy:export-sort-dir", "desc"));

  useEffect(() => { void loadHistory(); }, [page, pageSize]);
  useEffect(() => { persist("ledgerbuddy:export-from", dateFrom); }, [dateFrom]);
  useEffect(() => { persist("ledgerbuddy:export-to", dateTo); }, [dateTo]);
  useEffect(() => { persist("ledgerbuddy:export-page-size", pageSize); }, [pageSize]);
  useEffect(() => { persist("ledgerbuddy:export-sort-key", sortKey); }, [sortKey]);
  useEffect(() => { persist("ledgerbuddy:export-sort-dir", sortDir); }, [sortDir]);

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

  function toggleSort(key: SortKey) {
    if (sortKey === key) { setSortDir((d) => d === "asc" ? "desc" : "asc"); }
    else { setSortKey(key); setSortDir("asc"); }
  }

  let displayed = items;
  if (dateFrom) { const from = new Date(dateFrom); displayed = displayed.filter((b) => new Date(b.createdAt) >= from); }
  if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); displayed = displayed.filter((b) => new Date(b.createdAt) <= to); }

  const dir = sortDir === "asc" ? 1 : -1;
  displayed = [...displayed].sort((a, b) => {
    switch (sortKey) {
      case "date": return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      case "total": return (a.total - b.total) * dir;
      case "success": return (a.successCount - b.successCount) * dir;
      case "failed": return (a.failureCount - b.failureCount) * dir;
      case "requestedBy": return a.requestedBy.localeCompare(b.requestedBy) * dir;
      default: return 0;
    }
  });

  const totalPages = Math.ceil(total / pageSize);
  const hasFilters = dateFrom !== "" || dateTo !== "";
  const sortIcon = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : "";

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
                  <th className="sortable-th" onClick={() => toggleSort("date")}>Date{sortIcon("date")}</th>
                  <th className="sortable-th" onClick={() => toggleSort("total")}>Total{sortIcon("total")}</th>
                  <th className="sortable-th" onClick={() => toggleSort("success")}>Success{sortIcon("success")}</th>
                  <th className="sortable-th" onClick={() => toggleSort("failed")}>Failed{sortIcon("failed")}</th>
                  <th className="sortable-th" onClick={() => toggleSort("requestedBy")}>Requested By{sortIcon("requestedBy")}</th>
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
