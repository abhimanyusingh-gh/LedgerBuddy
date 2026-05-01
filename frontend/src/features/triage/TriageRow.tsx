import type { TriageInvoice } from "@/api/triage";
import { formatMinorAmountWithCurrency } from "@/lib/common/currency";

interface TriageRowProps {
  invoice: TriageInvoice;
  selected: boolean;
  onToggleSelected: () => void;
  onAssign: () => void;
  onReject: () => void;
  isMutating: boolean;
}

function formatReceivedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function valueOrPlaceholder(value: string | null | undefined): string {
  if (typeof value !== "string") return "—";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "—";
}

export function TriageRow({
  invoice,
  selected,
  onToggleSelected,
  onAssign,
  onReject,
  isMutating
}: TriageRowProps) {
  return (
    <tr data-testid={`triage-row-${invoice._id}`} data-mutating={isMutating ? "true" : undefined}>
      <td>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          aria-label={`Select invoice ${valueOrPlaceholder(invoice.invoiceNumber)}`}
          data-testid={`triage-row-checkbox-${invoice._id}`}
          disabled={isMutating}
        />
      </td>
      <td className="triage-cell-invoice-number">{valueOrPlaceholder(invoice.invoiceNumber)}</td>
      <td>
        <div className="triage-cell-stacked">
          <span>{valueOrPlaceholder(invoice.vendorName)}</span>
          <small>{valueOrPlaceholder(invoice.vendorGstin)}</small>
        </div>
      </td>
      <td>
        <div className="triage-cell-stacked">
          <span>{valueOrPlaceholder(invoice.customerName)}</span>
          <small>{valueOrPlaceholder(invoice.customerGstin)}</small>
        </div>
      </td>
      <td className="triage-cell-amount">
        {invoice.totalAmountMinor === null
          ? "—"
          : formatMinorAmountWithCurrency(invoice.totalAmountMinor, invoice.currency ?? undefined)}
      </td>
      <td className="triage-cell-source">{valueOrPlaceholder(invoice.sourceMailbox)}</td>
      <td className="triage-cell-received">{formatReceivedAt(invoice.receivedAt)}</td>
      <td className="triage-actions-cell">
        <button
          type="button"
          className="app-button app-button-primary app-button-sm"
          onClick={onAssign}
          disabled={isMutating}
          data-testid={`triage-row-assign-${invoice._id}`}
        >
          Assign
        </button>
        <button
          type="button"
          className="app-button app-button-secondary app-button-sm"
          onClick={onReject}
          disabled={isMutating}
          data-testid={`triage-row-reject-${invoice._id}`}
        >
          Reject
        </button>
      </td>
    </tr>
  );
}
