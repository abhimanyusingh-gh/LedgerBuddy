import type { VendorDetail } from "@/types/vendor";

interface VendorDetailHeaderProps {
  vendor: VendorDetail;
  onBack: () => void;
  onMerge: () => void;
}

export function VendorDetailHeader({ vendor, onBack, onMerge }: VendorDetailHeaderProps) {
  return (
    <header className="vendor-detail-header" data-testid="vendor-detail-header">
      <div className="vendor-detail-header-row">
        <button
          type="button"
          className="app-button app-button-secondary"
          onClick={onBack}
          data-testid="vendor-detail-back"
        >
          Back to vendors
        </button>
        <button
          type="button"
          className="app-button app-button-secondary"
          onClick={onMerge}
          data-testid="vendor-detail-merge"
        >
          Merge vendor
        </button>
      </div>
      <div className="vendor-detail-header-titles">
        <h2 className="vendor-detail-name">{vendor.name}</h2>
        <span
          className="vendor-detail-status"
          data-testid="vendor-detail-status"
          data-status={vendor.vendorStatus}
        >
          {vendor.vendorStatus}
        </span>
        {vendor.msme?.classification ? (
          <span className="vendor-detail-msme-flag" data-testid="vendor-detail-msme">
            MSME · {vendor.msme.classification}
          </span>
        ) : null}
      </div>
      <dl className="vendor-detail-meta">
        <VendorMetaItem label="GSTIN" value={vendor.gstin} testId="vendor-detail-gstin" />
        <VendorMetaItem label="PAN" value={vendor.pan} testId="vendor-detail-pan" />
        <VendorMetaItem label="State" value={vendor.stateName} testId="vendor-detail-state" />
        <VendorMetaItem
          label="Tally ledger"
          value={vendor.tallyLedgerName}
          testId="vendor-detail-tally-ledger"
        />
      </dl>
    </header>
  );
}

interface VendorMetaItemProps {
  label: string;
  value: string | null;
  testId: string;
}

function VendorMetaItem({ label, value, testId }: VendorMetaItemProps) {
  return (
    <div className="vendor-detail-meta-item">
      <dt>{label}</dt>
      <dd data-testid={testId}>{value ?? "—"}</dd>
    </div>
  );
}
