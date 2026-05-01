import { EmptyState } from "@/components/common/EmptyState";

interface VendorInvoicesTabProps {
  vendorFingerprint: string;
}

export function VendorInvoicesTab({ vendorFingerprint }: VendorInvoicesTabProps) {
  return (
    <section
      className="vendor-detail-panel"
      data-testid="vendor-invoices-tab"
      data-vendor-fingerprint={vendorFingerprint}
    >
      <div className="vendor-detail-panel-empty">
        <EmptyState
          icon="hourglass_empty"
          heading="Per-vendor invoice list pending"
          description="The /invoices endpoint does not yet accept a vendorFingerprint filter. Tracked at #380. The list will populate automatically once the endpoint ships."
        />
      </div>
    </section>
  );
}
