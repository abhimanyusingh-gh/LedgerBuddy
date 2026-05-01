import {
  VENDOR_STATUS,
  VENDOR_STATUSES,
  type VendorStatus
} from "@/types/vendor";

interface VendorFiltersProps {
  status: VendorStatus | null;
  hasMsme: boolean | null;
  hasSection197Cert: boolean | null;
  onStatusChange: (next: VendorStatus | null) => void;
  onHasMsmeChange: (next: boolean | null) => void;
  onHasSection197CertChange: (next: boolean | null) => void;
  onResetFilters: () => void;
}

const STATUS_LABEL: Record<VendorStatus, string> = {
  [VENDOR_STATUS.ACTIVE]: "Active",
  [VENDOR_STATUS.INACTIVE]: "Inactive",
  [VENDOR_STATUS.BLOCKED]: "Blocked",
  [VENDOR_STATUS.MERGED]: "Merged"
};

const TRI_BOOL_OPTION = {
  ANY: "any",
  YES: "yes",
  NO: "no"
} as const;

type TriBoolOption = (typeof TRI_BOOL_OPTION)[keyof typeof TRI_BOOL_OPTION];

function triBoolToOption(value: boolean | null): TriBoolOption {
  if (value === true) return TRI_BOOL_OPTION.YES;
  if (value === false) return TRI_BOOL_OPTION.NO;
  return TRI_BOOL_OPTION.ANY;
}

function optionToTriBool(value: TriBoolOption): boolean | null {
  if (value === TRI_BOOL_OPTION.YES) return true;
  if (value === TRI_BOOL_OPTION.NO) return false;
  return null;
}

export function VendorFilters({
  status,
  hasMsme,
  hasSection197Cert,
  onStatusChange,
  onHasMsmeChange,
  onHasSection197CertChange,
  onResetFilters
}: VendorFiltersProps) {
  return (
    <div className="vendors-filters" data-testid="vendors-filters">
      <label className="vendors-filter">
        <span className="vendors-filter-label">Status</span>
        <select
          className="vendors-filter-select"
          value={status ?? ""}
          data-testid="vendors-filter-status"
          onChange={(e) => onStatusChange(e.target.value === "" ? null : (e.target.value as VendorStatus))}
        >
          <option value="">Any status</option>
          {VENDOR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="vendors-filter">
        <span className="vendors-filter-label">MSME</span>
        <select
          className="vendors-filter-select"
          value={triBoolToOption(hasMsme)}
          data-testid="vendors-filter-msme"
          onChange={(e) => onHasMsmeChange(optionToTriBool(e.target.value as TriBoolOption))}
        >
          <option value={TRI_BOOL_OPTION.ANY}>Any</option>
          <option value={TRI_BOOL_OPTION.YES}>MSME-classified</option>
          <option value={TRI_BOOL_OPTION.NO}>Not MSME</option>
        </select>
      </label>
      <label className="vendors-filter">
        <span className="vendors-filter-label">Sec. 197 cert</span>
        <select
          className="vendors-filter-select"
          value={triBoolToOption(hasSection197Cert)}
          data-testid="vendors-filter-cert197"
          onChange={(e) => onHasSection197CertChange(optionToTriBool(e.target.value as TriBoolOption))}
        >
          <option value={TRI_BOOL_OPTION.ANY}>Any</option>
          <option value={TRI_BOOL_OPTION.YES}>Has certificate</option>
          <option value={TRI_BOOL_OPTION.NO}>No certificate</option>
        </select>
      </label>
      <button
        type="button"
        className="app-button app-button-secondary app-button-sm"
        onClick={onResetFilters}
        data-testid="vendors-filter-reset"
      >
        Reset
      </button>
    </div>
  );
}
