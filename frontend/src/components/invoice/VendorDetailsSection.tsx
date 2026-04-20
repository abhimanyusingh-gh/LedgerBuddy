import type { Invoice } from "@/types";
import { CollapsibleSectionHeader } from "@/features/tenant-admin/CollapsibleSectionHeader";
import { isValidGstinFormat, isValidPanFormat, doesPanMatchGstin } from "@/lib/invoice/taxIdValidation";

interface VendorDetailsSectionProps {
  invoice: Invoice;
  expanded: boolean;
  onToggle: () => void;
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

function PanBadge({ pan, gstin }: { pan: string | null | undefined; gstin: string | null | undefined }) {
  if (!pan) return null;
  const formatValid = isValidPanFormat(pan);
  if (!formatValid) {
    return (
      <span className="tax-id-badge tax-id-invalid" title="Invalid PAN format">
        Invalid format
      </span>
    );
  }
  const crossChecked = doesPanMatchGstin(pan, gstin);
  return (
    <span
      className={crossChecked ? "tax-id-badge tax-id-cross-checked" : "tax-id-badge tax-id-valid"}
      title={crossChecked ? "PAN matches GSTIN (cross-checked)" : "Valid PAN format"}
    >
      {crossChecked ? "GSTIN cross-checked" : "Format valid"}
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

export function VendorDetailsSection({ invoice, expanded, onToggle }: VendorDetailsSectionProps) {
  const parsed = invoice.parsed;
  const vendorName = parsed?.vendorName;
  const vendorAddress = parsed?.vendorAddress;
  const vendorGstin = parsed?.vendorGstin;
  const vendorPan = parsed?.vendorPan;

  const hasAnyVendorField = !!(vendorAddress || vendorGstin || vendorPan);

  return (
    <div className="details-section vendor-details-section">
      <CollapsibleSectionHeader
        label="Vendor Details"
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className="details-body">
          {vendorName && (
            <FieldRow label="Vendor Name">
              <span className="muted" style={{ fontSize: "0.85rem" }}>Shown in key fields above</span>
            </FieldRow>
          )}
          <FieldRow label="PAN">
            {vendorPan ? (
              <span className="details-field-inline">
                <span>{vendorPan}</span>
                <PanBadge pan={vendorPan} gstin={vendorGstin} />
              </span>
            ) : (
              <NotExtractedLabel />
            )}
          </FieldRow>
          <FieldRow label="GSTIN">
            {vendorGstin ? (
              <span className="details-field-inline">
                <span>{vendorGstin}</span>
                <GstinBadge value={vendorGstin} />
              </span>
            ) : (
              <NotExtractedLabel />
            )}
          </FieldRow>
          <FieldRow label="Address">
            {vendorAddress ? (
              <span style={{ whiteSpace: "pre-line", fontSize: "0.85rem" }}>{vendorAddress}</span>
            ) : (
              <NotExtractedLabel />
            )}
          </FieldRow>
          {!hasAnyVendorField && !vendorName && (
            <NotExtractedLabel />
          )}
        </div>
      )}
    </div>
  );
}
