import { formatMinorAmountWithCurrency } from "../currency";
import { formatOcrConfidenceLabel } from "../extractedFields";
import { getInvoiceSourceHighlights, type SourceFieldKey } from "../sourceHighlights";
import type { Invoice } from "../types";

interface LineItemsTableProps {
  invoice: Invoice;
}

export function LineItemsTable({ invoice }: LineItemsTableProps) {
  const lineItems = invoice.parsed?.lineItems ?? [];
  if (lineItems.length === 0) {
    return null;
  }

  const lineItemCount = Number(invoice.metadata?.lineItemCount ?? lineItems.length);

  const highlightMap = new Map(
    getInvoiceSourceHighlights(invoice).map((highlight) => [highlight.fieldKey, highlight] as const)
  );

  return (
    <div className="line-items-table-wrap">
      <div className="line-items-table-meta">
        <span className="muted">Detected line items: {Number.isFinite(lineItemCount) ? lineItemCount : lineItems.length}</span>
      </div>
      <table className="mapping-table line-items-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Description</th>
            <th scope="col">Qty</th>
            <th scope="col">Rate</th>
            <th scope="col">Amount</th>
            <th scope="col">Tax</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((item, index) => {
            const descriptionKey = `lineItems.${index}.description` as SourceFieldKey;
            const amountKey = `lineItems.${index}.amountMinor` as SourceFieldKey;
            const descriptionSource = highlightMap.get(descriptionKey);
            const amountSource = highlightMap.get(amountKey);
            const taxMinor = (item.cgstMinor ?? 0) + (item.sgstMinor ?? 0) + (item.igstMinor ?? 0);
            return (
              <tr key={`${descriptionKey}:${item.amountMinor}`}>
                <td><div className="table-cell-scroll">{index + 1}</div></td>
                <td className="line-items-description-cell"><div className="table-cell-scroll">{item.description || "-"}</div></td>
                <td><div className="table-cell-scroll">{item.quantity ?? "-"}</div></td>
                <td><div className="table-cell-scroll">{item.rate ?? "-"}</div></td>
                <td><div className="table-cell-scroll">{formatMinorAmountWithCurrency(item.amountMinor, invoice.parsed?.currency)}</div></td>
                <td><div className="table-cell-scroll">{taxMinor > 0 ? formatMinorAmountWithCurrency(taxMinor, invoice.parsed?.currency) : "-"}</div></td>
                <td className="line-items-source-cell">
                  {descriptionSource || amountSource ? (
                    <div className="table-cell-scroll line-items-source-stack">
                      {descriptionSource ? (
                        <span className="muted">
                          Desc: page {descriptionSource.page}
                          {descriptionSource.confidence !== undefined
                            ? ` | ${formatOcrConfidenceLabel(descriptionSource.confidence)}`
                            : ""}
                        </span>
                      ) : null}
                      {amountSource ? (
                        <span className="muted">
                          Amount: page {amountSource.page}
                          {amountSource.confidence !== undefined
                            ? ` | ${formatOcrConfidenceLabel(amountSource.confidence)}`
                            : ""}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="table-cell-scroll"><span className="muted">-</span></div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
