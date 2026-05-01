import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/common/EmptyState";
import { fetchVendorDetail } from "@/api/vendors";
import { Section197CertPanel } from "@/features/vendors/Section197CertPanel";
import { VendorDetailHeader } from "@/features/vendors/VendorDetailHeader";
import { VendorInvoicesTab } from "@/features/vendors/VendorInvoicesTab";
import { VendorMergeDialog } from "@/features/vendors/VendorMergeDialog";
import { VendorTdsTab } from "@/features/vendors/VendorTdsTab";
import { useVendorDetailHashState } from "@/features/vendors/useVendorDetailHashState";
import { STANDALONE_HASH_PATH } from "@/features/workspace/tabHashConfig";
import {
  VENDOR_DETAIL_SUB_TAB,
  type VendorDetail,
  type VendorDetailSubTab,
  type VendorId
} from "@/types/vendor";

const VENDOR_DETAIL_QUERY_KEY = "vendorDetail";

const SUB_TAB_LABEL: Record<VendorDetailSubTab, string> = {
  [VENDOR_DETAIL_SUB_TAB.INVOICES]: "Invoices",
  [VENDOR_DETAIL_SUB_TAB.TDS]: "TDS",
  [VENDOR_DETAIL_SUB_TAB.CERT197]: "Section 197"
};

interface VendorDetailPageProps {
  vendorId: VendorId;
}

export function VendorDetailPage({ vendorId }: VendorDetailPageProps) {
  const { route, setSubTab } = useVendorDetailHashState();
  const [mergeOpen, setMergeOpen] = useState(false);

  const queryKey = useMemo(() => [VENDOR_DETAIL_QUERY_KEY, vendorId] as const, [vendorId]);
  const query = useQuery<VendorDetail>({
    queryKey,
    queryFn: () => fetchVendorDetail(vendorId),
    staleTime: 0
  });

  function handleBack() {
    window.location.hash = STANDALONE_HASH_PATH.vendors;
  }

  if (query.isPending) {
    return (
      <section className="panel vendor-detail-panel" data-testid="vendor-detail-page">
        <div
          className="vendor-detail-state"
          role="status"
          aria-busy="true"
          data-testid="vendor-detail-loading"
        >
          Loading vendor…
        </div>
      </section>
    );
  }

  if (query.isError || !query.data) {
    return (
      <section className="panel vendor-detail-panel" data-testid="vendor-detail-page">
        <div className="vendor-detail-state" data-testid="vendor-detail-error">
          <EmptyState
            icon="error"
            heading="Couldn't load vendor"
            description="The server didn't respond. Try again."
            action={
              <button
                type="button"
                className="app-button app-button-secondary"
                onClick={() => void query.refetch()}
                data-testid="vendor-detail-error-retry"
              >
                Retry
              </button>
            }
          />
        </div>
      </section>
    );
  }

  const vendor = query.data;
  const subTab = route?.subTab ?? VENDOR_DETAIL_SUB_TAB.INVOICES;

  return (
    <section className="panel vendor-detail-panel" data-testid="vendor-detail-page">
      <VendorDetailHeader vendor={vendor} onBack={handleBack} onMerge={() => setMergeOpen(true)} />

      <nav className="vendor-detail-tabs" role="tablist" data-testid="vendor-detail-tabs">
        {(Object.values(VENDOR_DETAIL_SUB_TAB) as VendorDetailSubTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={subTab === tab}
            className={
              subTab === tab
                ? "vendor-detail-tab vendor-detail-tab-active"
                : "vendor-detail-tab"
            }
            onClick={() => setSubTab(tab)}
            data-testid={`vendor-detail-tab-${tab}`}
          >
            {SUB_TAB_LABEL[tab]}
          </button>
        ))}
      </nav>

      <div className="vendor-detail-tab-body" role="tabpanel">
        {subTab === VENDOR_DETAIL_SUB_TAB.INVOICES ? (
          <VendorInvoicesTab vendorFingerprint={vendor.vendorFingerprint} />
        ) : null}
        {subTab === VENDOR_DETAIL_SUB_TAB.TDS ? (
          <VendorTdsTab vendorFingerprint={vendor.vendorFingerprint} />
        ) : null}
        {subTab === VENDOR_DETAIL_SUB_TAB.CERT197 ? (
          <Section197CertPanel
            vendorId={vendor._id}
            cert={vendor.lowerDeductionCert}
            vendorDetailQueryKey={queryKey}
          />
        ) : null}
      </div>

      <VendorMergeDialog
        open={mergeOpen}
        target={vendor}
        onClose={() => setMergeOpen(false)}
        onMerged={() => {
          setMergeOpen(false);
          window.location.hash = STANDALONE_HASH_PATH.vendors;
        }}
      />
    </section>
  );
}
