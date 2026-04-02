interface CollapsibleSectionHeaderProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}

export function CollapsibleSectionHeader({ label, expanded, onToggle }: CollapsibleSectionHeaderProps) {
  return (
    <div
      className="detail-section-toggle"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <h3>
        <span className="material-symbols-outlined" aria-hidden="true">
          {expanded ? "keyboard_arrow_down" : "keyboard_arrow_right"}
        </span>
        <span>{label}</span>
      </h3>
    </div>
  );
}
