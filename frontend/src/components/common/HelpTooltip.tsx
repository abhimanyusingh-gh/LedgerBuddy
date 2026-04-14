import { useState, useRef, useEffect, type ReactNode } from "react";

interface HelpTooltipProps {
  text: string;
  children?: ReactNode;
  position?: "top" | "bottom";
}

export function HelpTooltip({ text, children, position = "top" }: HelpTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const tooltipWidth = 220;
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    if (left < 8) left = 8;
    if (left + tooltipWidth > window.innerWidth - 8) left = window.innerWidth - tooltipWidth - 8;
    const top = position === "bottom" ? rect.bottom + 6 : rect.top - 6;
    setCoords({ top, left });
  }, [visible, position]);

  return (
    <span
      ref={triggerRef}
      className="help-tooltip-trigger"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      tabIndex={0}
      role="note"
    >
      {children ?? (
        <span className="material-symbols-outlined help-tooltip-icon">help</span>
      )}
      {visible && coords ? (
        <div
          ref={tooltipRef}
          className={`help-tooltip help-tooltip-${position}`}
          style={{ position: "fixed", top: coords.top, left: coords.left, transform: position === "top" ? "translateY(-100%)" : undefined }}
        >
          {text}
        </div>
      ) : null}
    </span>
  );
}
