import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/common/EmptyState";
import { fetchVendorList, mergeVendor } from "@/api/vendors";
import {
  TDS_LIABILITY_QUERY_KEY,
  fetchTdsLiabilityReport,
  type TdsLiabilityReport,
  type TdsLiabilityVendorBucket
} from "@/api/reports";
import { determineFY } from "@/features/reports/fiscalYear";
import { formatMinorAmountWithCurrency } from "@/lib/common/currency";
import {
  type VendorDetail,
  type VendorId,
  type VendorListItemSummary,
  type VendorListResponse,
  type VendorMergeResult
} from "@/types/vendor";

interface VendorMergeDialogProps {
  open: boolean;
  target: VendorDetail;
  onClose: () => void;
  onMerged: (result: VendorMergeResult) => void;
}

const CANDIDATE_PAGE_SIZE = 25;

export function VendorMergeDialog({ open, target, onClose, onMerged }: VendorMergeDialogProps) {
  const queryClient = useQueryClient();
  const [selectedSourceId, setSelectedSourceId] = useState<VendorId | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fy = useMemo(() => determineFY(new Date()), []);

  const candidatesQuery = useQuery<VendorListResponse>({
    enabled: open,
    queryKey: ["vendorMergeCandidates", target._id, target.gstin],
    queryFn: () =>
      fetchVendorList({
        search: target.gstin?.trim() ? target.gstin.trim() : target.name,
        page: 1,
        limit: CANDIDATE_PAGE_SIZE
      })
  });

  const candidates = useMemo(
    () => filterCandidates(candidatesQuery.data?.items ?? [], target),
    [candidatesQuery.data, target]
  );

  const sourceLedgerQuery = useQuery<TdsLiabilityReport>({
    enabled: open && selectedSourceId !== null,
    queryKey: [TDS_LIABILITY_QUERY_KEY, "merge-source", fy, selectedSourceId],
    queryFn: () => {
      const source = candidates.find((candidate) => candidate._id === selectedSourceId);
      const fingerprint = source?._id ?? "";
      return fetchTdsLiabilityReport({ fy, vendorFingerprint: fingerprint });
    }
  });

  const targetLedgerQuery = useQuery<TdsLiabilityReport>({
    enabled: open,
    queryKey: [TDS_LIABILITY_QUERY_KEY, "merge-target", fy, target.vendorFingerprint],
    queryFn: () => fetchTdsLiabilityReport({ fy, vendorFingerprint: target.vendorFingerprint })
  });

  const mutation = useMutation<VendorMergeResult, Error, VendorId>({
    mutationFn: (sourceId) => mergeVendor(target._id, sourceId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["vendorsList"] });
      void queryClient.invalidateQueries({ queryKey: [TDS_LIABILITY_QUERY_KEY] });
      onMerged(result);
    },
    onError: (err) => setError(err.message)
  });

  if (!open) return null;

  function handleSelect(id: VendorId) {
    setSelectedSourceId(id);
    setConfirming(false);
    setError(null);
  }

  function handleClose() {
    setSelectedSourceId(null);
    setConfirming(false);
    setError(null);
    onClose();
  }

  function handleRequestConfirm() {
    if (!selectedSourceId) return;
    setConfirming(true);
    setError(null);
  }

  function handleConfirmMerge() {
    if (!selectedSourceId) return;
    setError(null);
    mutation.mutate(selectedSourceId);
  }

  return (
    <div
      className="vendor-merge-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendor-merge-dialog-title"
      data-testid="vendor-merge-dialog"
    >
      <div className="vendor-merge-dialog-card">
        <header className="vendor-merge-dialog-header">
          <h3 id="vendor-merge-dialog-title">Merge vendor into {target.name}</h3>
          <p>
            Pick a duplicate vendor to merge. We match GSTIN first, then name. Merge is irreversible
            — please review the consolidation preview before confirming.
          </p>
        </header>

        <CandidateList
          loading={candidatesQuery.isPending}
          error={candidatesQuery.isError}
          candidates={candidates}
          selectedId={selectedSourceId}
          onSelect={handleSelect}
          onRetry={() => void candidatesQuery.refetch()}
        />

        {selectedSourceId ? (
          <ConsolidationPreview
            target={target}
            targetReport={targetLedgerQuery.data ?? null}
            sourceReport={sourceLedgerQuery.data ?? null}
            loading={sourceLedgerQuery.isPending || targetLedgerQuery.isPending}
            error={sourceLedgerQuery.isError || targetLedgerQuery.isError}
          />
        ) : null}

        {error ? (
          <p className="error vendor-merge-error" role="alert" data-testid="vendor-merge-error">
            {error}
          </p>
        ) : null}

        <footer className="vendor-merge-dialog-actions">
          <button
            type="button"
            className="app-button app-button-secondary"
            onClick={handleClose}
            data-testid="vendor-merge-cancel"
          >
            Cancel
          </button>
          {confirming ? (
            <button
              type="button"
              className="app-button app-button-primary"
              onClick={handleConfirmMerge}
              disabled={mutation.isPending}
              data-testid="vendor-merge-confirm"
            >
              {mutation.isPending ? "Merging…" : "Yes, merge permanently"}
            </button>
          ) : (
            <button
              type="button"
              className="app-button app-button-primary"
              onClick={handleRequestConfirm}
              disabled={!selectedSourceId}
              data-testid="vendor-merge-request-confirm"
            >
              Review & confirm
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

interface CandidateListProps {
  loading: boolean;
  error: boolean;
  candidates: VendorListItemSummary[];
  selectedId: VendorId | null;
  onSelect: (id: VendorId) => void;
  onRetry: () => void;
}

function CandidateList({ loading, error, candidates, selectedId, onSelect, onRetry }: CandidateListProps) {
  if (loading) {
    return (
      <div
        className="vendor-merge-candidates-state"
        role="status"
        aria-busy="true"
        data-testid="vendor-merge-candidates-loading"
      >
        Searching for matches…
      </div>
    );
  }
  if (error) {
    return (
      <div className="vendor-merge-candidates-state" data-testid="vendor-merge-candidates-error">
        <EmptyState
          icon="error"
          heading="Couldn't load candidates"
          description="The server didn't respond. Try again."
          action={
            <button
              type="button"
              className="app-button app-button-secondary"
              onClick={onRetry}
              data-testid="vendor-merge-candidates-retry"
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }
  if (candidates.length === 0) {
    return (
      <div className="vendor-merge-candidates-state" data-testid="vendor-merge-candidates-empty">
        <EmptyState
          icon="search_off"
          heading="No merge candidates found"
          description="No other vendors match this GSTIN or name."
        />
      </div>
    );
  }
  return (
    <ul className="vendor-merge-candidates" data-testid="vendor-merge-candidates">
      {candidates.map((candidate) => {
        const isSelected = candidate._id === selectedId;
        return (
          <li key={candidate._id} className="vendor-merge-candidate">
            <button
              type="button"
              className={
                isSelected
                  ? "vendor-merge-candidate-button vendor-merge-candidate-button-selected"
                  : "vendor-merge-candidate-button"
              }
              onClick={() => onSelect(candidate._id)}
              data-testid="vendor-merge-candidate"
              data-vendor-id={candidate._id}
              aria-pressed={isSelected}
            >
              <span className="vendor-merge-candidate-name">{candidate.name}</span>
              <span className="vendor-merge-candidate-meta">
                GSTIN {candidate.gstin ?? "—"} · PAN {candidate.pan ?? "—"} · {candidate.invoiceCount} invoices
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface ConsolidationPreviewProps {
  target: VendorDetail;
  targetReport: TdsLiabilityReport | null;
  sourceReport: TdsLiabilityReport | null;
  loading: boolean;
  error: boolean;
}

interface PreviewRow {
  fy: string;
  section: string;
  targetTdsMinor: number;
  sourceTdsMinor: number;
  consolidatedTdsMinor: number;
}

function ConsolidationPreview({ target, targetReport, sourceReport, loading, error }: ConsolidationPreviewProps) {
  const rows = useMemo<PreviewRow[]>(
    () => buildPreviewRows(target, targetReport, sourceReport),
    [target, targetReport, sourceReport]
  );

  if (loading) {
    return (
      <div
        className="vendor-merge-preview-state"
        role="status"
        aria-busy="true"
        data-testid="vendor-merge-preview-loading"
      >
        Computing consolidation preview…
      </div>
    );
  }
  if (error) {
    return (
      <div className="vendor-merge-preview-state" data-testid="vendor-merge-preview-error">
        <EmptyState
          icon="error"
          heading="Couldn't load preview"
          description="The server didn't respond. Pick another candidate or try again."
        />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="vendor-merge-preview-state" data-testid="vendor-merge-preview-empty">
        <EmptyState
          icon="receipt_long"
          heading="No TDS to consolidate"
          description="Neither vendor has TDS deductions in the current FY."
        />
      </div>
    );
  }
  return (
    <div className="vendor-merge-preview" data-testid="vendor-merge-preview">
      <h4 className="vendor-merge-preview-title">Consolidation preview · current FY</h4>
      <div className="vendor-merge-preview-table">
        <div className="vendor-merge-preview-thead">
          <span>FY · Section</span>
          <span className="vendor-merge-preview-th-numeric">Target</span>
          <span className="vendor-merge-preview-th-numeric">Source</span>
          <span className="vendor-merge-preview-th-numeric">After merge</span>
        </div>
        <ul className="vendor-merge-preview-tbody">
          {rows.map((row) => (
            <li
              key={`${row.fy}-${row.section}`}
              className="vendor-merge-preview-row"
              data-testid="vendor-merge-preview-row"
            >
              <span>{row.fy} · {row.section}</span>
              <span className="vendor-merge-preview-numeric">
                {formatMinorAmountWithCurrency(row.targetTdsMinor, "INR")}
              </span>
              <span className="vendor-merge-preview-numeric">
                {formatMinorAmountWithCurrency(row.sourceTdsMinor, "INR")}
              </span>
              <span className="vendor-merge-preview-numeric vendor-merge-preview-consolidated">
                {formatMinorAmountWithCurrency(row.consolidatedTdsMinor, "INR")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function filterCandidates(items: VendorListItemSummary[], target: VendorDetail): VendorListItemSummary[] {
  const targetGstin = target.gstin?.trim() ?? null;
  const exclusionId = target._id;
  const sorted = [...items].filter((item) => item._id !== exclusionId);
  if (!targetGstin) return sorted;
  return sorted.sort((a, b) => {
    const aMatch = a.gstin === targetGstin ? 0 : 1;
    const bMatch = b.gstin === targetGstin ? 0 : 1;
    return aMatch - bMatch;
  });
}

function buildPreviewRows(
  target: VendorDetail,
  targetReport: TdsLiabilityReport | null,
  sourceReport: TdsLiabilityReport | null
): PreviewRow[] {
  const targetMap = bucketsByFySection(targetReport, target.vendorFingerprint);
  const sourceMap = bucketsByFySection(sourceReport, null);
  const fy = targetReport?.fy ?? sourceReport?.fy ?? "";
  const sections = new Set<string>([...targetMap.keys(), ...sourceMap.keys()]);
  const out: PreviewRow[] = [];
  for (const section of sections) {
    const targetTds = targetMap.get(section) ?? 0;
    const sourceTds = sourceMap.get(section) ?? 0;
    out.push({
      fy,
      section,
      targetTdsMinor: targetTds,
      sourceTdsMinor: sourceTds,
      consolidatedTdsMinor: targetTds + sourceTds
    });
  }
  return out.sort((a, b) => a.section.localeCompare(b.section));
}

function bucketsByFySection(report: TdsLiabilityReport | null, _filterFingerprint: string | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!report) return out;
  for (const bucket of report.byVendor as TdsLiabilityVendorBucket[]) {
    out.set(bucket.section, (out.get(bucket.section) ?? 0) + bucket.cumulativeTdsMinor);
  }
  return out;
}
