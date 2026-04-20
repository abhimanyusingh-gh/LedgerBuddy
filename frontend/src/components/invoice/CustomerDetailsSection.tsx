import type { Invoice } from "@/types";
import { CollapsibleSectionHeader } from "@/components/common/CollapsibleSectionHeader";
import { isValidGstinFormat } from "@/lib/invoice/taxIdValidation";

interface CustomerDetailsSectionProps {
  invoice: Invoice;
  expanded: boolean;
  onToggle: () => void;
  tenantGstin?: string | null;
}

function GstinBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const valid = isValidGstinFormat(value);
  return (
    <span
      className={valid ? "tax-id-badge tax-id-valid" : "tax-id-badge tax-id-invalid"}
      title={valid ? "Valid GSTIN format" : "Invalid GSTIN format"}
    >
      {valid ? "Valid" : "Invalid format"}
    </span>
  );
}

function NotExtractedLabel() {
  return <span className="muted" style={{ fontSize: "0.85rem" }}>Not extracted</span>;
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="details-field">
      <span className="details-field-label">{label}</span>
      <div className="details-field-value">{children}</div>
    </div>
  );
}

export function CustomerDetailsSection({ invoice, expanded, onToggle, tenantGstin }: CustomerDetailsSectionProps) {
  const parsed = invoice.parsed;
  const customerName = parsed?.customerName;
  const customerAddress = parsed?.customerAddress;
  const customerGstin = parsed?.customerGstin;

  const hasAnyCustomerField = !!(customerName || customerAddress || customerGstin);

  const customerGstinMatchesTenant = !!(
    tenantGstin &&
    customerGstin &&
    tenantGstin.trim().toUpperCase() === customerGstin.trim().toUpperCase()
  );

  return (
    <div className="details-section customer-details-section">
      <CollapsibleSectionHeader
        label="Customer Details"
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className="details-body">
          <FieldRow label="Name">
            {customerName ? (
              <span style={{ fontSize: "0.85rem" }}>{customerName}</span>
            ) : (
              <NotExtractedLabel />
            )}
          </FieldRow>
          <FieldRow label="GSTIN">
            {customerGstin ? (
              <span className="details-field-inline">
                <span>{customerGstin}</span>
                <GstinBadge value={customerGstin} />
                {customerGstinMatchesTenant && (
                  <span className="tax-id-badge tax-id-tenant-match" title="Customer GSTIN matches your tenant GSTIN">
                    Matches tenant GSTIN
                  </span>
                )}
              </span>
            ) : (
              <NotExtractedLabel />
            )}
          </FieldRow>
          <FieldRow label="Address">
            {customerAddress ? (
              <span style={{ whiteSpace: "pre-line", fontSize: "0.85rem" }}>{customerAddress}</span>
            ) : (
              <NotExtractedLabel />
            )}
          </FieldRow>
          {!hasAnyCustomerField && (
            <NotExtractedLabel />
          )}
        </div>
      )}
    </div>
  );
}
