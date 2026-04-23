import type { ReactNode } from "react";
import { cssVar, tokens } from "./tokens";

/**
 * Design-system `Badge` — generic pill/chip primitive.
 *
 * **Motivation**: the codebase has a number of ad-hoc badge renderings:
 * `ConfidenceBadge` (score-specific), status classes `.status-*`, and a
 * proliferation of `--badge-*-bg/-fg` tokens. Phase 1 PRs FE-2/FE-3a/FE-5a
 * introduce `RiskDot`, `StatusBadge`, `PaymentStatusBadge`,
 * `ActionHintBadge`, and `AgingBadge` — all share the same visual
 * anatomy: a small rounded label with semantic colour + optional icon.
 *
 * This primitive owns the layout + a11y; the specialized badges compose it
 * with their own colour choice and label-forming logic.
 *
 * 4-state contract: badges are presentational — no async states. All 4
 * states of a consuming feature (empty/loading/error/data) are handled by
 * the feature deciding whether to render the badge at all.
 *
 * a11y: when `title` is supplied it is exposed via `aria-label`; otherwise
 * the text content itself is the accessible name. Colour is never the only
 * information channel — callers MUST include text or an icon name.
 */

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "accent";

export type BadgeSize = "sm" | "md";

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Material Symbols icon name, rendered before children. */
  icon?: string;
  /** Accessible label if children alone are insufficient (e.g. dot badges). */
  title?: string;
  className?: string;
  children?: ReactNode;
}

const TONE_STYLE: Record<BadgeTone, { background: string; color: string; border?: string }> = {
  neutral: {
    background: "var(--bg-main)",
    color: cssVar("color.ink.soft"),
    border: `1px solid ${cssVar("color.line")}`
  },
  info: {
    background: cssVar("color.badge.crossChecked.bg"),
    color: cssVar("color.badge.crossChecked.fg")
  },
  success: {
    background: cssVar("color.badge.valid.bg"),
    color: cssVar("color.badge.valid.fg")
  },
  warning: {
    background: "rgba(245, 158, 11, 0.15)",
    color: cssVar("color.status.parsed")
  },
  danger: {
    background: cssVar("color.badge.invalid.bg"),
    color: cssVar("color.badge.invalid.fg")
  },
  accent: {
    background: "rgba(17, 82, 212, 0.1)",
    color: cssVar("color.accent")
  }
};

const SIZE_STYLE: Record<BadgeSize, { padding: string; fontSize: string; gap: string }> = {
  sm: { padding: "0.1rem 0.4rem", fontSize: tokens.font.size.xs, gap: "0.2rem" },
  md: { padding: "0.18rem 0.55rem", fontSize: tokens.font.size.sm, gap: "0.3rem" }
};

export function Badge({
  tone = "neutral",
  size = "md",
  icon,
  title,
  className,
  children
}: BadgeProps) {
  const toneStyle = TONE_STYLE[tone];
  const sizeStyle = SIZE_STYLE[size];
  return (
    <span
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sizeStyle.gap,
        padding: sizeStyle.padding,
        borderRadius: "999px",
        fontSize: sizeStyle.fontSize,
        fontWeight: tokens.font.weight.medium,
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...toneStyle
      }}
    >
      {icon ? (
        <span
          className="material-symbols-outlined"
          aria-hidden="true"
          style={{ fontSize: sizeStyle.fontSize }}
        >
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}
