import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/common/EmptyState";
import { fetchVendorList } from "@/api/vendors";
import { VendorFilters } from "@/features/vendors/VendorFilters";
import { VendorPaginationBar } from "@/features/vendors/VendorPaginationBar";
import { VendorSearchBox } from "@/features/vendors/VendorSearchBox";
import { VendorTable } from "@/features/vendors/VendorTable";
import { useVendorListHashState } from "@/features/vendors/useVendorListHashState";
import { VENDOR_LIST_DEFAULT_STATE } from "@/features/vendors/vendorListHashState";
import {
  VENDOR_SORT_DIRECTION,
  type VendorListItemSummary,
  type VendorListResponse,
  type VendorSortField
} from "@/types/vendor";

const VENDORS_QUERY_KEY = "vendorsList";
const ROW_HEIGHT_PX = 64;
const BODY_HEIGHT_PX = 560;

export function VendorListPage() {
  const { state, patch, reset } = useVendorListHashState();
  const [mergeTarget, setMergeTarget] = useState<VendorListItemSummary | null>(null);

  const queryKey = useMemo(
    () => [
      VENDORS_QUERY_KEY,
      state.search,
      state.status,
      state.hasMsme,
      state.hasSection197Cert,
      state.sortField,
      state.sortDirection,
      state.page,
      state.pageSize
    ],
    [state]
  );

  const query = useQuery<VendorListResponse>({
    queryKey,
    queryFn: () =>
      fetchVendorList({
        search: state.search,
        status: state.status,
        hasMsme: state.hasMsme,
        hasSection197Cert: state.hasSection197Cert,
        sortField: state.sortField,
        sortDirection: state.sortDirection,
        page: state.page,
        limit: state.pageSize
      }),
    staleTime: 0
  });

  function handleSortChange(field: VendorSortField) {
    if (field === state.sortField) {
      patch({
        sortDirection:
          state.sortDirection === VENDOR_SORT_DIRECTION.ASC
            ? VENDOR_SORT_DIRECTION.DESC
            : VENDOR_SORT_DIRECTION.ASC,
        page: 1
      });
      return;
    }
    patch({
      sortField: field,
      sortDirection: VENDOR_SORT_DIRECTION.DESC,
      page: 1
    });
  }

  function handleView(vendor: VendorListItemSummary) {
    window.location.hash = `#/vendors/${encodeURIComponent(vendor._id)}`;
  }

  function handleMerge(vendor: VendorListItemSummary) {
    setMergeTarget(vendor);
  }

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const isFiltered =
    state.search !== VENDOR_LIST_DEFAULT_STATE.search ||
    state.status !== VENDOR_LIST_DEFAULT_STATE.status ||
    state.hasMsme !== VENDOR_LIST_DEFAULT_STATE.hasMsme ||
    state.hasSection197Cert !== VENDOR_LIST_DEFAULT_STATE.hasSection197Cert;

  return (
    <section className="panel vendors-panel" data-testid="vendors-page">
      <header className="vendors-header">
        <div>
          <h2>Vendors</h2>
          <p className="vendors-subhead">
            {total} vendor{total === 1 ? "" : "s"}.
          </p>
        </div>
      </header>

      <div className="vendors-toolbar">
        <VendorSearchBox value={state.search} onChange={(next) => patch({ search: next, page: 1 })} />
        <VendorFilters
          status={state.status}
          hasMsme={state.hasMsme}
          hasSection197Cert={state.hasSection197Cert}
          onStatusChange={(next) => patch({ status: next, page: 1 })}
          onHasMsmeChange={(next) => patch({ hasMsme: next, page: 1 })}
          onHasSection197CertChange={(next) => patch({ hasSection197Cert: next, page: 1 })}
          onResetFilters={reset}
        />
      </div>

      {query.isPending ? (
        <div className="vendors-state" data-testid="vendors-loading" role="status" aria-busy="true">
          Loading vendors…
        </div>
      ) : query.isError ? (
        <div className="vendors-state" data-testid="vendors-error">
          <EmptyState
            icon="error"
            heading="Couldn't load vendors"
            description="The server didn't respond. Try again."
            action={
              <button
                type="button"
                className="app-button app-button-secondary"
                onClick={() => void query.refetch()}
                data-testid="vendors-error-retry"
              >
                Retry
              </button>
            }
          />
        </div>
      ) : items.length === 0 && isFiltered ? (
        <div className="vendors-state" data-testid="vendors-zero-result">
          <EmptyState
            icon="filter_alt_off"
            heading="No vendors match these filters"
            description="Adjust your search or filters to see more results."
            action={
              <button
                type="button"
                className="app-button app-button-secondary"
                onClick={reset}
                data-testid="vendors-zero-result-reset"
              >
                Reset filters
              </button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="vendors-state" data-testid="vendors-empty">
          <EmptyState
            icon="store"
            heading="No vendors yet"
            description="Vendors appear here once invoices are processed."
          />
        </div>
      ) : (
        <>
          <VendorTable
            vendors={items}
            sortField={state.sortField}
            sortDirection={state.sortDirection}
            onSortChange={handleSortChange}
            onView={handleView}
            onMerge={handleMerge}
            bodyHeightPx={BODY_HEIGHT_PX}
            rowHeightPx={ROW_HEIGHT_PX}
          />
          <VendorPaginationBar
            page={state.page}
            pageSize={state.pageSize}
            total={total}
            onPageChange={(next) => patch({ page: next })}
            onPageSizeChange={(next) => patch({ pageSize: next, page: 1 })}
          />
        </>
      )}

      <VendorMergePlaceholderDialog
        open={mergeTarget !== null}
        vendorName={mergeTarget?.name ?? null}
        onClose={() => setMergeTarget(null)}
      />
    </section>
  );
}

interface VendorMergePlaceholderDialogProps {
  open: boolean;
  vendorName: string | null;
  onClose: () => void;
}

function VendorMergePlaceholderDialog({ open, vendorName, onClose }: VendorMergePlaceholderDialogProps) {
  if (!open) return null;
  return (
    <div
      className="vendors-merge-placeholder"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vendors-merge-placeholder-title"
      data-testid="vendors-merge-placeholder"
    >
      <div className="vendors-merge-placeholder-card">
        <h3 id="vendors-merge-placeholder-title">Merge vendor</h3>
        <p>
          Merge dialog ships in #264. Selected vendor: <strong>{vendorName ?? "—"}</strong>.
        </p>
        <div className="vendors-merge-placeholder-actions">
          <button
            type="button"
            className="app-button app-button-secondary"
            onClick={onClose}
            data-testid="vendors-merge-placeholder-close"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
