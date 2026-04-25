import { useId, useState } from "react";
import { Badge, BADGE_SIZE, BADGE_TONE } from "@/components/ds/Badge";
import { useActionRequiredQueue } from "@/hooks/useActionRequiredQueue";
import { ActionRequiredPanel } from "@/features/invoices/ActionRequiredPanel";

interface ActionRequiredTriggerProps {
  onSelectInvoice?: (invoiceId: string) => void;
}

export function ActionRequiredTrigger({ onSelectInvoice }: ActionRequiredTriggerProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { totalCount, isLoading } = useActionRequiredQueue();
  // null = no active realm; render the same neutral placeholder as loading
  // so the contract from the hook (null = unknown) flows through unchanged.
  const isUnknown = totalCount === null || (isLoading && totalCount === 0);
  const badgeTone = totalCount !== null && totalCount > 0 ? BADGE_TONE.danger : BADGE_TONE.neutral;
  const countLabel = isUnknown ? "—" : String(totalCount);

  return (
    <>
      <button
        type="button"
        className="app-button app-button-secondary"
        data-testid="action-required-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        title="Action required"
        onClick={() => setOpen(true)}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          priority_high
        </span>
        <span style={{ marginLeft: "0.35rem" }}>Action</span>
        <span style={{ marginLeft: "0.4rem" }}>
          <Badge tone={badgeTone} size={BADGE_SIZE.sm} title={`${countLabel} action items`}>
            {countLabel}
          </Badge>
        </span>
      </button>
      <ActionRequiredPanel
        open={open}
        panelId={panelId}
        onClose={() => setOpen(false)}
        onSelectInvoice={onSelectInvoice}
      />
    </>
  );
}
