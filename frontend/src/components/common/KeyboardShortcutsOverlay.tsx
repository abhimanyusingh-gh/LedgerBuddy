interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  ["↓ / j", "Move to next invoice"],
  ["↑ / k", "Move to previous invoice"],
  ["Space", "Toggle selection"],
  ["Enter", "Open invoice detail popup"],
  ["a", "Approve selected"],
  ["e", "Export selected"],
  ["Escape", "Close popup / clear selection"],
  ["?", "Show this overlay"]
];

export function KeyboardShortcutsOverlay({ open, onClose }: KeyboardShortcutsOverlayProps) {
  if (!open) return null;

  return (
    <div className="popup-overlay" role="presentation" onClick={onClose}>
      <section className="popup-card" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
        <div className="popup-header">
          <h2>Keyboard Shortcuts</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "0.35rem 0", borderBottom: "1px solid var(--line)" }}>
              <kbd style={{ background: "var(--bg-main)", borderRadius: 4, padding: "0.15rem 0.5rem", fontSize: "0.8rem", fontFamily: "monospace", fontWeight: 600, border: "1px solid var(--line)" }}>{key}</kbd>
              <span style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>{desc}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
