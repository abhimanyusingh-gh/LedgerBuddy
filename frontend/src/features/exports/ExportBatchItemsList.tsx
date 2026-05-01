import type { ExportBatchItem } from "@/types";
import { ExportBatchItemBadge } from "@/features/exports/ExportBatchItemBadge";

interface ExportBatchItemsListProps {
  items: ExportBatchItem[];
}

export function ExportBatchItemsList({ items }: ExportBatchItemsListProps) {
  if (items.length === 0) {
    return (
      <p className="export-batch-items-empty">
        No per-invoice detail recorded for this batch.
      </p>
    );
  }
  return (
    <ul className="export-batch-items-list">
      {items.map((item) => (
        <li key={`${item.invoiceId}-${item.exportVersion}`} className="export-batch-items-row">
          <span className="export-batch-items-id" title={item.invoiceId}>
            {item.invoiceId}
          </span>
          <ExportBatchItemBadge status={item.status} />
          {item.tallyResponse?.lineError ? (
            <span className="export-batch-items-error">
              {item.tallyResponse.lineErrorOrdinal !== undefined
                ? `LINEERROR #${item.tallyResponse.lineErrorOrdinal}: `
                : ""}
              {item.tallyResponse.lineError}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
