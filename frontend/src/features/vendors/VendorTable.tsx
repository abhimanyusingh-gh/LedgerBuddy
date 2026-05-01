import { VirtualisedRows } from "@/components/virtualised/VirtualisedRows";
import { VendorRow } from "@/features/vendors/VendorRow";
import {
  VENDOR_SORT_DIRECTION,
  VENDOR_SORT_FIELD,
  type VendorListItemSummary,
  type VendorSortDirection,
  type VendorSortField
} from "@/types/vendor";

interface VendorTableProps {
  vendors: VendorListItemSummary[];
  sortField: VendorSortField;
  sortDirection: VendorSortDirection;
  onSortChange: (field: VendorSortField) => void;
  onView: (vendor: VendorListItemSummary) => void;
  onMerge: (vendor: VendorListItemSummary) => void;
  bodyHeightPx: number;
  rowHeightPx: number;
}

interface ColumnDef {
  id: VendorSortField | "status" | "actions";
  label: string;
  sortable: boolean;
  className: string;
}

const COLUMNS: readonly ColumnDef[] = [
  { id: VENDOR_SORT_FIELD.NAME, label: "Vendor", sortable: true, className: "vendors-th-name" },
  { id: "status", label: "Status", sortable: false, className: "vendors-th-status" },
  { id: VENDOR_SORT_FIELD.LAST_INVOICE_DATE, label: "Last invoice", sortable: true, className: "vendors-th-numeric" },
  { id: VENDOR_SORT_FIELD.FYTD_SPEND, label: "FYTD spend", sortable: true, className: "vendors-th-numeric" },
  { id: VENDOR_SORT_FIELD.FYTD_TDS, label: "FYTD TDS", sortable: true, className: "vendors-th-numeric" },
  { id: "actions", label: "Actions", sortable: false, className: "vendors-th-actions" }
];

function ariaSortFor(
  column: ColumnDef,
  sortField: VendorSortField,
  sortDirection: VendorSortDirection
): "ascending" | "descending" | "none" | undefined {
  if (!column.sortable) return undefined;
  if (column.id !== sortField) return "none";
  return sortDirection === VENDOR_SORT_DIRECTION.ASC ? "ascending" : "descending";
}

function sortIndicator(active: boolean, direction: VendorSortDirection): string {
  if (!active) return "unfold_more";
  return direction === VENDOR_SORT_DIRECTION.ASC ? "arrow_upward" : "arrow_downward";
}

export function VendorTable({
  vendors,
  sortField,
  sortDirection,
  onSortChange,
  onView,
  onMerge,
  bodyHeightPx,
  rowHeightPx
}: VendorTableProps) {
  return (
    <div className="vendors-table" data-testid="vendors-table" role="table" aria-rowcount={vendors.length + 1}>
      <div className="vendors-thead" role="row">
        {COLUMNS.map((column) => {
          const isActive = column.sortable && column.id === sortField;
          if (!column.sortable) {
            return (
              <div key={column.id} className={`vendors-th ${column.className}`} role="columnheader">
                {column.label}
              </div>
            );
          }
          return (
            <button
              key={column.id}
              type="button"
              role="columnheader"
              aria-sort={ariaSortFor(column, sortField, sortDirection)}
              className={`vendors-th vendors-th-sortable ${column.className}`}
              data-testid={`vendors-th-${column.id}`}
              onClick={() => onSortChange(column.id as VendorSortField)}
            >
              <span>{column.label}</span>
              <span className="material-symbols-outlined vendors-th-sort-icon" aria-hidden="true">
                {sortIndicator(isActive, sortDirection)}
              </span>
            </button>
          );
        })}
      </div>
      <VirtualisedRows
        items={vendors}
        rowHeight={rowHeightPx}
        height={bodyHeightPx}
        rowKey={(vendor) => vendor._id}
        testId="vendors-virtualised-body"
        renderRow={(vendor) => <VendorRow vendor={vendor} onView={onView} onMerge={onMerge} />}
      />
    </div>
  );
}
