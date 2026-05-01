import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@/components/common/EmptyState";
import {
  TDS_LIABILITY_QUERY_KEY,
  fetchTdsLiabilityReport,
  type TdsLiabilityReport,
  type TdsLiabilityVendorBucket
} from "@/api/reports";
import { determineFY, fyOptions } from "@/features/reports/fiscalYear";
import { formatMinorAmountWithCurrency } from "@/lib/common/currency";

interface VendorTdsTabProps {
  vendorFingerprint: string;
}

const FY_OPTION_COUNT = 5;

export function VendorTdsTab({ vendorFingerprint }: VendorTdsTabProps) {
  const currentFy = useMemo(() => determineFY(new Date()), []);
  const [fy, setFy] = useState<string>(currentFy);
  const fyChoices = useMemo(() => fyOptions(new Date(), FY_OPTION_COUNT), []);

  const query = useQuery<TdsLiabilityReport>({
    queryKey: [TDS_LIABILITY_QUERY_KEY, "vendor-detail", fy, vendorFingerprint],
    queryFn: () => fetchTdsLiabilityReport({ fy, vendorFingerprint }),
    staleTime: 0
  });

  return (
    <section className="vendor-detail-panel" data-testid="vendor-tds-tab">
      <div className="vendor-tds-toolbar">
        <label className="vendor-tds-fy-label">
          Financial year
          <select
            className="vendors-filter-select"
            value={fy}
            onChange={(event) => setFy(event.target.value)}
            data-testid="vendor-tds-fy-select"
          >
            {fyChoices.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>

      {query.isPending ? (
        <div
          className="vendor-detail-panel-state"
          role="status"
          aria-busy="true"
          data-testid="vendor-tds-loading"
        >
          Loading TDS ledger…
        </div>
      ) : query.isError ? (
        <div className="vendor-detail-panel-state" data-testid="vendor-tds-error">
          <EmptyState
            icon="error"
            heading="Couldn't load TDS ledger"
            description="The server didn't respond. Try again."
            action={
              <button
                type="button"
                className="app-button app-button-secondary"
                onClick={() => void query.refetch()}
                data-testid="vendor-tds-error-retry"
              >
                Retry
              </button>
            }
          />
        </div>
      ) : query.data && query.data.byVendor.length > 0 ? (
        <VendorTdsLedgerTable
          fy={fy}
          buckets={query.data.byVendor}
        />
      ) : (
        <div className="vendor-detail-panel-state" data-testid="vendor-tds-empty">
          <EmptyState
            icon="receipt_long"
            heading="No TDS deductions in this FY"
            description="TDS rows appear here once an invoice for this vendor crosses the section threshold."
          />
        </div>
      )}
    </section>
  );
}

interface VendorTdsLedgerTableProps {
  fy: string;
  buckets: TdsLiabilityVendorBucket[];
}

function VendorTdsLedgerTable({ fy, buckets }: VendorTdsLedgerTableProps) {
  return (
    <div className="vendor-tds-table" data-testid="vendor-tds-table">
      <div className="vendor-tds-thead">
        <span>Section</span>
        <span className="vendor-tds-th-numeric">Cumulative base</span>
        <span className="vendor-tds-th-numeric">Cumulative TDS</span>
        <span className="vendor-tds-th-numeric">Invoices</span>
        <span>Threshold</span>
        <span className="vendor-tds-th-actions">Drill-down</span>
      </div>
      <ul className="vendor-tds-tbody">
        {buckets.map((bucket) => (
          <li key={bucket.section} className="vendor-tds-row" data-testid="vendor-tds-row">
            <span className="vendor-tds-section">{bucket.section}</span>
            <span className="vendor-tds-numeric">
              {formatMinorAmountWithCurrency(bucket.cumulativeBaseMinor, "INR")}
            </span>
            <span className="vendor-tds-numeric">
              {formatMinorAmountWithCurrency(bucket.cumulativeTdsMinor, "INR")}
            </span>
            <span className="vendor-tds-numeric">{bucket.invoiceCount}</span>
            <span className="vendor-tds-threshold">
              {bucket.thresholdCrossedAt ? "Crossed" : "Below"}
            </span>
            <span className="vendor-tds-drilldown">
              <a
                className="app-button app-button-secondary vendor-tds-drilldown-link"
                href={`#/reports/tds?fy=${encodeURIComponent(fy)}&section=${encodeURIComponent(bucket.section)}`}
                data-testid="vendor-tds-drilldown-link"
              >
                View
              </a>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
