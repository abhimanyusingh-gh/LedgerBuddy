import { useModalDismiss } from "@/hooks/useModalDismiss";

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_ROWS = [
  { keys: ["↓", "j"], description: "Move to next invoice" },
  { keys: ["↑", "k"], description: "Move to previous invoice" },
  { keys: ["Space"], description: "Toggle risk-signals expand on active invoice" },
  { keys: ["Enter"], description: "Open invoice detail popup" },
  { keys: ["a"], description: "Approve active invoice" },
  { keys: ["e"], description: "Export active invoice to Tally" },
  { keys: ["Escape"], description: "Close popup / clear selection" },
  { keys: ["?"], description: "Show this help overlay" }
] as const;

export function KeyboardShortcutsOverlay({ open, onClose }: KeyboardShortcutsOverlayProps) {
  useModalDismiss({ open, onClose, options: { saveFocusOnOpen: true } });
  if (!open) return null;

  return (
    <div
      className="popup-overlay"
      role="presentation"
      onClick={onClose}
      data-testid="shortcuts-overlay"
    >
      <section
        className="popup-card shortcuts-help-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="popup-header">
          <h2 id="shortcuts-help-title">Keyboard Shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close keyboard shortcuts help">
            Close
          </button>
        </div>
        <ul className="shortcuts-help-list">
          {SHORTCUT_ROWS.map((row) => (
            <li key={row.description} className="shortcuts-help-row">
              <span className="shortcuts-help-keys">
                {row.keys.map((k, idx) => (
                  <kbd key={`${row.description}-${idx}`} className="shortcuts-help-kbd">
                    {k}
                  </kbd>
                ))}
              </span>
              <span className="shortcuts-help-desc">{row.description}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
