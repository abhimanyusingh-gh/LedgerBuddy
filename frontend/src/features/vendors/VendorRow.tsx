import { Badge, type BadgeTone } from "@/components/ds/Badge";
import { VENDOR_STATUS, type VendorListItemSummary, type VendorStatus } from "@/types/vendor";

const STATUS_TONE: Record<VendorStatus, BadgeTone> = {
  [VENDOR_STATUS.ACTIVE]: "success",
  [VENDOR_STATUS.INACTIVE]: "neutral",
  [VENDOR_STATUS.BLOCKED]: "danger",
  [VENDOR_STATUS.MERGED]: "info"
};

const STATUS_ICON: Record<VendorStatus, string> = {
  [VENDOR_STATUS.ACTIVE]: "check_circle",
  [VENDOR_STATUS.INACTIVE]: "pause_circle",
  [VENDOR_STATUS.BLOCKED]: "block",
  [VENDOR_STATUS.MERGED]: "merge"
};

const STATUS_LABEL: Record<VendorStatus, string> = {
  [VENDOR_STATUS.ACTIVE]: "Active",
  [VENDOR_STATUS.INACTIVE]: "Inactive",
  [VENDOR_STATUS.BLOCKED]: "Blocked",
  [VENDOR_STATUS.MERGED]: "Merged"
};

function VendorStatusBadge({ status }: { status: VendorStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} size="sm" icon={STATUS_ICON[status]} title={STATUS_LABEL[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

interface VendorRowProps {
  vendor: VendorListItemSummary;
  onView: (vendor: VendorListItemSummary) => void;
  onMerge: (vendor: VendorListItemSummary) => void;
}

const RUPEE = "₹";

function formatRupeesMinor(minor: number | null): string {
  if (minor === null || !Number.isFinite(minor)) return "—";
  const rupees = minor / 100;
  return `${RUPEE}${rupees.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
}

export function VendorRow({ vendor, onView, onMerge }: VendorRowProps) {
  return (
    <div className="vendors-row" data-testid="vendors-row" data-vendor-id={vendor._id}>
      <div className="vendors-row-cell vendors-row-cell-name">
        <span className="vendors-row-name">{vendor.name}</span>
        <span className="vendors-row-ids">
          {vendor.gstin ? <span className="vendors-row-id">GSTIN {vendor.gstin}</span> : null}
          {vendor.pan ? <span className="vendors-row-id">PAN {vendor.pan}</span> : null}
        </span>
      </div>
      <div className="vendors-row-cell vendors-row-cell-status">
        <VendorStatusBadge status={vendor.vendorStatus} />
        {vendor.msme ? (
          <Badge tone="accent" size="sm" icon="verified" title={`MSME: ${vendor.msme.classification}`}>
            MSME
          </Badge>
        ) : null}
        {vendor.section197Cert ? (
          <Badge tone="info" size="sm" icon="badge" title="Section 197 certificate on file">
            §197
          </Badge>
        ) : null}
      </div>
      <div className="vendors-row-cell vendors-row-cell-numeric">{formatDate(vendor.lastInvoiceDate)}</div>
      <div className="vendors-row-cell vendors-row-cell-numeric">{formatRupeesMinor(vendor.fytdSpendMinor)}</div>
      <div className="vendors-row-cell vendors-row-cell-numeric">{formatRupeesMinor(vendor.fytdTdsMinor)}</div>
      <div className="vendors-row-cell vendors-row-cell-actions">
        <button
          type="button"
          className="app-button app-button-secondary app-button-sm"
          onClick={() => onView(vendor)}
          data-testid="vendors-row-view"
        >
          View
        </button>
        <button
          type="button"
          className="app-button app-button-secondary app-button-sm"
          onClick={() => onMerge(vendor)}
          data-testid="vendors-row-merge"
        >
          Merge
        </button>
      </div>
    </div>
  );
}
