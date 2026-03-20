import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: string;
  heading: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, heading, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon-wrap">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <h4>{heading}</h4>
      <p>{description}</p>
      {action ?? null}
    </div>
  );
}
