import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Design-system `Button` — thin typed wrapper around the existing
 * `.app-button` + `.app-button-{variant}` + `.app-button-sm` +
 * `.app-button-loading` CSS defined in `frontend/src/styles.css`.
 *
 * **Reuse rationale**: the app already has ~20 callers using these classes
 * directly (see PR description audit). This component does NOT replace the
 * CSS — it standardizes how React components consume it (type safety,
 * loading/disabled semantics, ref forwarding, a11y defaults) so future
 * call-sites don't drift.
 *
 * 4-state contract: buttons don't fetch, so the only async state is
 * `loading` — when true, the button is visually obscured by the existing
 * spinner CSS (`app-button-loading`) and `aria-busy` + `disabled` are set
 * so assistive tech and click handlers both see it as inactive.
 */

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /**
   * Optional Material Symbols icon name rendered before children. Matches
   * the inline `<span className="material-symbols-outlined">` pattern used
   * elsewhere in the app.
   */
  icon?: string;
  children?: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "app-button-primary",
  secondary: "app-button-secondary",
  // `app-button-destructive` isn't a standalone class in styles.css today —
  // ConfirmDialog.tsx renders destructive intent via inline `background:
  // var(--warn)`. We preserve that existing visual using the same pattern.
  destructive: "app-button-primary",
  ghost: "app-button-secondary"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    disabled,
    className,
    children,
    type,
    style,
    ...rest
  },
  ref
) {
  const classes = [
    "app-button",
    VARIANT_CLASS[variant],
    size === "sm" ? "app-button-sm" : null,
    loading ? "app-button-loading" : null,
    className ?? null
  ]
    .filter(Boolean)
    .join(" ");

  const destructiveStyle =
    variant === "destructive"
      ? { background: "var(--warn)", borderColor: "var(--warn)", ...style }
      : variant === "ghost"
      ? { background: "transparent", ...style }
      : style;

  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      style={destructiveStyle}
      {...rest}
    >
      {icon ? (
        <span className="material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
});
