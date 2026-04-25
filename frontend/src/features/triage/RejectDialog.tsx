import { useEffect, useId, useRef, useState } from "react";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import {
  TRIAGE_REJECT_REASON,
  TRIAGE_REJECT_REASON_OPTIONS,
  buildRejectPayload,
  type TriageRejectPayload,
  type TriageRejectReason
} from "@/features/triage/triageReasons";

interface RejectDialogProps {
  open: boolean;
  invoiceCount: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (payload: TriageRejectPayload) => void;
}

function isReasonValid(reason: TriageRejectReason, freeText: string): boolean {
  const option = TRIAGE_REJECT_REASON_OPTIONS.find((opt) => opt.value === reason);
  if (!option) return false;
  if (!option.requiresFreeText) return true;
  return freeText.trim().length > 0;
}

export function RejectDialog({ open, invoiceCount, isSubmitting, onCancel, onConfirm }: RejectDialogProps) {
  const titleId = useId();
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState<TriageRejectReason>(TRIAGE_REJECT_REASON.NotForAnyClient);
  const [freeText, setFreeText] = useState("");

  useModalDismiss({ open, onClose: onCancel });

  useEffect(() => {
    if (!open) return;
    setReason(TRIAGE_REJECT_REASON.NotForAnyClient);
    setFreeText("");
    const id = window.setTimeout(() => firstButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  const valid = isReasonValid(reason, freeText);

  function handleConfirm() {
    if (!valid || isSubmitting) return;
    onConfirm(buildRejectPayload(reason, freeText));
  }

  return (
    <div
      className="popup-overlay"
      role="presentation"
      onClick={onCancel}
      data-testid="reject-dialog-overlay"
    >
      <section
        className="popup-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popup-header">
          <h2 id={titleId}>
            {invoiceCount === 1 ? "Reject invoice" : `Reject ${invoiceCount} invoices`}
          </h2>
          <button type="button" onClick={onCancel} aria-label="Close reject dialog">
            Close
          </button>
        </div>
        <p className="reject-dialog-description">
          Choose a reason. Rejected invoices are archived and removed from the triage queue.
        </p>
        <fieldset className="reject-dialog-fieldset">
          <legend className="reject-dialog-legend">Reason</legend>
          {TRIAGE_REJECT_REASON_OPTIONS.map((option, idx) => (
            <label key={option.value} className="reject-dialog-option">
              <input
                ref={idx === 0 ? undefined : undefined}
                type="radio"
                name="triage-reject-reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                data-testid={`reject-dialog-reason-${option.value}`}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
        <label className="reject-dialog-freetext">
          <span>
            Notes
            {TRIAGE_REJECT_REASON_OPTIONS.find((opt) => opt.value === reason)?.requiresFreeText
              ? " (required)"
              : " (optional)"}
          </span>
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            data-testid="reject-dialog-freetext"
            rows={3}
          />
        </label>
        <div className="confirm-actions">
          <button
            ref={firstButtonRef}
            type="button"
            className="app-button app-button-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
            data-testid="reject-dialog-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="app-button app-button-destructive"
            onClick={handleConfirm}
            disabled={!valid || isSubmitting}
            data-testid="reject-dialog-confirm"
          >
            {isSubmitting ? "Rejecting..." : "Reject"}
          </button>
        </div>
      </section>
    </div>
  );
}
