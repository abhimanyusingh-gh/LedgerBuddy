import type { ReactNode } from "react";
import { HelpTooltip } from "@/components/common/HelpTooltip";

interface PlatformSectionProps {
  title: string;
  icon: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  testId?: string;
  helpText?: string;
}

export function PlatformSection({
  title,
  icon,
  collapsed,
  onToggle,
  children,
  actions,
  className,
  testId,
  helpText
}: PlatformSectionProps) {
  const sectionClassName = ["platform-section", className].filter(Boolean).join(" ");

  return (
    <section className={sectionClassName} data-testid={testId}>
      <header className="platform-section-header">
        <h3>
          <span className="material-symbols-outlined">{icon}</span>
          {title}
          {helpText ? <HelpTooltip text={helpText} /> : null}
        </h3>
        <div className="platform-section-actions">
          {!collapsed ? actions : null}
          <button
            type="button"
            className="app-button app-button-secondary platform-collapse-button"
            aria-label={`Toggle ${title} section`}
            onClick={onToggle}
          >
            <span className="material-symbols-outlined">{collapsed ? "expand_more" : "expand_less"}</span>
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </header>
      {collapsed ? <p className="muted section-collapsed-note">Section collapsed.</p> : children}
    </section>
  );
}
