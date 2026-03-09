import { useState, useEffect } from "react";
import { fetchExportHistory, downloadTallyXmlFile } from "../api";
import type { ExportBatchSummary } from "../types";

interface ExportHistoryDashboardProps {
  visible: boolean;
}

export function ExportHistoryDashboard({ visible }: ExportHistoryDashboardProps) {
  const [items, setItems] = useState<ExportBatchSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 20;

  useEffect(() => {
    if (!visible) {
      return;
    }
    void loadHistory();
  }, [visible, page]);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchExportHistory(page, limit);
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load export history.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(batchId: string) {
    try {
      const blob = await downloadTallyXmlFile(batchId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `tally-export-${batchId}.xml`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      setError("Download failed.");
    }
  }

  if (!visible) {
    return null;
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <section className="export-history-section">
      <h3>Export History</h3>
      {error ? <p className="export-history-error">{error}</p> : null}
      {loading ? <p>Loading...</p> : null}
      {!loading && items.length === 0 ? <p className="muted">No exports found.</p> : null}
      {items.length > 0 ? (
        <>
          <div className="export-history-table-wrap">
            <table className="export-history-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Total</th>
                  <th>Success</th>
                  <th>Failed</th>
                  <th>Requested By</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {items.map((batch) => (
                  <tr key={batch.batchId}>
                    <td>{new Date(batch.createdAt).toLocaleString()}</td>
                    <td>{batch.total}</td>
                    <td>{batch.successCount}</td>
                    <td>{batch.failureCount}</td>
                    <td>{batch.requestedBy}</td>
                    <td>
                      {batch.hasFile ? (
                        <button
                          type="button"
                          className="app-button app-button-secondary app-button-sm"
                          onClick={() => void handleDownload(batch.batchId)}
                        >
                          Download XML
                        </button>
                      ) : (
                        <span className="export-no-file">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div className="export-history-pagination">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
