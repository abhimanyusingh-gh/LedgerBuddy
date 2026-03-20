interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", destructive, onConfirm, onCancel }: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="popup-overlay" role="presentation" onClick={onCancel}>
      <section
        className="popup-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 440 }}
      >
        <div className="popup-header">
          <h2>{title}</h2>
        </div>
        <p style={{ margin: "0.75rem 0 0", color: "var(--ink-soft)", lineHeight: 1.5 }}>{message}</p>
        <div className="confirm-actions">
          <button type="button" className="app-button app-button-secondary" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={`app-button ${destructive ? "app-button-primary" : "app-button-primary"}`}
            style={destructive ? { background: "var(--warn)", borderColor: "var(--warn)" } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
