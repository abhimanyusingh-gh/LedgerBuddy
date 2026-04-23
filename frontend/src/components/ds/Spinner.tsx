import { tokens } from "./tokens";

/**
 * Design-system `Spinner` — lightweight indeterminate loading indicator for
 * the "loading" quadrant of the 4-state UX contract.
 *
 * The app already has a `.skeleton` shimmer utility for row/card
 * placeholders and `.app-button-loading::after` for in-button spinners.
 * Neither works for standalone "loading" states (e.g. the
 * `ActionRequiredQueue` while fetching). This primitive fills that gap.
 *
 * a11y: exposes `role="status"` + `aria-label` so screen readers announce
 * the loading intent. Animation honours `prefers-reduced-motion` via CSS —
 * but since we're using an inline `@keyframes spin` that's already defined
 * in styles.css, and that file doesn't yet gate on reduced-motion, we keep
 * animation on (acceptable for short loads; UX polish follow-up tracked).
 */

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  /** Accessible label announced by screen readers. */
  label?: string;
}

const SIZE_PX: Record<NonNullable<SpinnerProps["size"]>, number> = {
  sm: 14,
  md: 20,
  lg: 32
};

export function Spinner({ size = "md", label = "Loading" }: SpinnerProps) {
  const px = SIZE_PX[size];
  return (
    <span
      role="status"
      aria-label={label}
      aria-live="polite"
      style={{
        display: "inline-block",
        width: px,
        height: px,
        border: `2px solid ${tokens.color.line}`,
        borderTopColor: tokens.color.accent.base,
        borderRadius: "999px",
        animation: "spin 0.7s linear infinite"
      }}
    />
  );
}
