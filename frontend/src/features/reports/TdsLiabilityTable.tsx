import { useMemo, useState } from "react";
import { Badge } from "@/components/ds/Badge";
import { fmtInr } from "@/features/overview/OverviewDashboardUtils";
import type { TdsLiabilityVendorBucket } from "@/api/reports";

const TDS_TABLE_COLUMN = {
  vendor: "vendor",
  section: "section",
  cumulativeBaseMinor: "cumulativeBaseMinor",
  cumulativeTdsMinor: "cumulativeTdsMinor",
  invoiceCount: "invoiceCount",
  threshold: "threshold"
} as const;

type TdsTableColumn = (typeof TDS_TABLE_COLUMN)[keyof typeof TDS_TABLE_COLUMN];

const TDS_SORT_DIRECTION = {
  asc: "asc",
  desc: "desc"
} as const;

type TdsSortDirection = (typeof TDS_SORT_DIRECTION)[keyof typeof TDS_SORT_DIRECTION];

interface SortState {
  column: TdsTableColumn;
  direction: TdsSortDirection;
}

interface TdsLiabilityTableProps {
  rows: TdsLiabilityVendorBucket[];
  isFiltered: boolean;
  onClearFilters?: () => void;
  onSelectVendor?: (vendorFingerprint: string) => void;
}

const COLUMN_LABEL: Record<TdsTableColumn, string> = {
  [TDS_TABLE_COLUMN.vendor]: "Vendor",
  [TDS_TABLE_COLUMN.section]: "Section",
  [TDS_TABLE_COLUMN.cumulativeBaseMinor]: "Cumulative Base",
  [TDS_TABLE_COLUMN.cumulativeTdsMinor]: "Cumulative TDS",
  [TDS_TABLE_COLUMN.invoiceCount]: "Invoices",
  [TDS_TABLE_COLUMN.threshold]: "Threshold"
};

function compareRows(a: TdsLiabilityVendorBucket, b: TdsLiabilityVendorBucket, sort: SortState): number {
  const direction = sort.direction === TDS_SORT_DIRECTION.asc ? 1 : -1;
  switch (sort.column) {
    case TDS_TABLE_COLUMN.vendor:
      return a.vendorFingerprint.localeCompare(b.vendorFingerprint) * direction;
    case TDS_TABLE_COLUMN.section:
      return a.section.localeCompare(b.section) * direction;
    case TDS_TABLE_COLUMN.cumulativeBaseMinor:
      return (a.cumulativeBaseMinor - b.cumulativeBaseMinor) * direction;
    case TDS_TABLE_COLUMN.cumulativeTdsMinor:
      return (a.cumulativeTdsMinor - b.cumulativeTdsMinor) * direction;
    case TDS_TABLE_COLUMN.invoiceCount:
      return (a.invoiceCount - b.invoiceCount) * direction;
    case TDS_TABLE_COLUMN.threshold: {
      const aCrossed = a.thresholdCrossedAt ? 1 : 0;
      const bCrossed = b.thresholdCrossedAt ? 1 : 0;
      return (aCrossed - bCrossed) * direction;
    }
    default:
      return 0;
  }
}

const SORTABLE_COLUMNS: readonly TdsTableColumn[] = [
  TDS_TABLE_COLUMN.vendor,
  TDS_TABLE_COLUMN.section,
  TDS_TABLE_COLUMN.cumulativeBaseMinor,
  TDS_TABLE_COLUMN.cumulativeTdsMinor,
  TDS_TABLE_COLUMN.invoiceCount,
  TDS_TABLE_COLUMN.threshold
];

export function TdsLiabilityTable({ rows, isFiltered, onClearFilters, onSelectVendor }: TdsLiabilityTableProps) {
  const [sort, setSort] = useState<SortState>({
    column: TDS_TABLE_COLUMN.cumulativeTdsMinor,
    direction: TDS_SORT_DIRECTION.desc
  });

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compareRows(a, b, sort));
    return copy;
  }, [rows, sort]);

  function handleSort(column: TdsTableColumn) {
    setSort((prev) => {
      if (prev.column !== column) {
        return { column, direction: TDS_SORT_DIRECTION.desc };
      }
      return {
        column,
        direction: prev.direction === TDS_SORT_DIRECTION.desc ? TDS_SORT_DIRECTION.asc : TDS_SORT_DIRECTION.desc
      };
    });
  }

  if (rows.length === 0) {
    return isFiltered ? (
      <div className="tds-table-empty" data-testid="tds-table-zero-result">
        <p>No vendors match the current filter.</p>
        {onClearFilters ? (
          <button type="button" className="app-button app-button-secondary" onClick={onClearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>
    ) : (
      <div className="tds-table-empty" data-testid="tds-table-empty">
        <p>No TDS-bearing invoices recorded for this financial year yet.</p>
      </div>
    );
  }

  return (
    <table className="mapping-table tds-liability-table" data-testid="tds-liability-table">
      <thead>
        <tr>
          {SORTABLE_COLUMNS.map((column) => {
            const isActive = sort.column === column;
            const ariaSort = isActive
              ? sort.direction === TDS_SORT_DIRECTION.asc ? "ascending" : "descending"
              : "none";
            return (
              <th key={column} aria-sort={ariaSort}>
                <button
                  type="button"
                  className="tds-sort-button"
                  onClick={() => handleSort(column)}
                  data-testid={`tds-sort-${column}`}
                  data-active={isActive ? "true" : undefined}
                >
                  {COLUMN_LABEL[column]}
                  {isActive ? (
                    <span aria-hidden="true">{sort.direction === TDS_SORT_DIRECTION.asc ? " ↑" : " ↓"}</span>
                  ) : null}
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => {
          const crossed = row.thresholdCrossedAt !== null;
          const rowKey = `${row.vendorFingerprint}::${row.section}`;
          return (
            <tr key={rowKey} data-testid="tds-row" data-threshold-crossed={crossed ? "true" : undefined}>
              <td>
                {onSelectVendor ? (
                  <button
                    type="button"
                    className="tds-vendor-link"
                    onClick={() => onSelectVendor(row.vendorFingerprint)}
                    data-testid={`tds-vendor-link-${row.vendorFingerprint}`}
                  >
                    {row.vendorFingerprint}
                  </button>
                ) : (
                  row.vendorFingerprint
                )}
              </td>
              <td>{row.section}</td>
              <td className="lb-num">{fmtInr(row.cumulativeBaseMinor)}</td>
              <td className="lb-num">{fmtInr(row.cumulativeTdsMinor)}</td>
              <td className="lb-num">{row.invoiceCount}</td>
              <td>
                {crossed ? (
                  <Badge tone="danger" size="sm" icon="warning" title={`Threshold crossed on ${row.thresholdCrossedAt ?? ""}`}>
                    Crossed
                  </Badge>
                ) : (
                  <Badge tone="neutral" size="sm" icon="check" title="Threshold not yet crossed">
                    Below
                  </Badge>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
