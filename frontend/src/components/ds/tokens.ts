/**
 * Design system tokens — single typed source of truth for colour, spacing,
 * radius, shadow, and typography values used across the LedgerBuddy frontend.
 *
 * **Reuse contract**: the source-of-truth for token *values* is the CSS custom
 * properties defined in `frontend/src/styles.css` (`:root` and
 * `[data-theme="dark"]` blocks). This module exposes those same names as
 * typed TS constants so components can:
 *
 *   1. reference tokens safely via `tokens.color.accent`
 *   2. resolve the live value at runtime via `cssVar("color.accent")`
 *      — which compiles to `var(--accent)` and therefore honours dark mode.
 *
 * Do NOT inline new hex values in components. If a new token is needed add it
 * to `styles.css` first, then mirror here.
 *
 * Implements D-028/D-029/D-030 groundwork (consistent Tally-export surfacing
 * uses the same colour ramp) and the UX quick-win palette referenced in
 * Phase 1 FE-2/FE-3a (risk-signal dot, action-hint badges).
 */

/** Mapping from logical token path to underlying CSS custom property name. */
export const TOKEN_CSS_VAR: Record<string, string> = {
  "color.bg.main": "--bg-main",
  "color.bg.panel": "--bg-panel",
  "color.ink": "--ink",
  "color.ink.soft": "--ink-soft",
  "color.accent": "--accent",
  "color.accent.hover": "--accent-2",
  "color.warn": "--warn",
  "color.line": "--line",
  "color.status.approved": "--status-approved",
  "color.status.exported": "--status-exported",
  "color.status.parsed": "--status-parsed",
  "color.status.needsReview": "--status-needs-review",
  "color.status.pending": "--status-pending",
  "color.status.failedOcr": "--status-failed-ocr",
  "color.status.failedParse": "--status-failed-parse",
  "color.chart.blue": "--chart-blue",
  "color.chart.emerald": "--chart-emerald",
  "color.chart.amber": "--chart-amber",
  "color.chart.rose": "--chart-rose",
  "color.chart.violet": "--chart-violet",
  "color.chart.cyan": "--chart-cyan",
  "color.badge.valid.bg": "--badge-valid-bg",
  "color.badge.valid.fg": "--badge-valid-fg",
  "color.badge.invalid.bg": "--badge-invalid-bg",
  "color.badge.invalid.fg": "--badge-invalid-fg",
  "color.badge.crossChecked.bg": "--badge-cross-checked-bg",
  "color.badge.crossChecked.fg": "--badge-cross-checked-fg",
  "color.badge.tenantMatch.bg": "--badge-tenant-match-bg",
  "color.badge.tenantMatch.fg": "--badge-tenant-match-fg",
  "color.badge.tenantMatch.border": "--badge-tenant-match-border",
  "space.1": "--sp-1",
  "space.2": "--sp-2",
  "space.3": "--sp-3",
  "space.4": "--sp-4",
  "space.5": "--sp-5",
  "space.6": "--sp-6",
  "space.8": "--sp-8",
  "radius.sm": "--radius-sm",
  "radius.md": "--radius-md",
  "radius.lg": "--radius-lg",
  "shadow.sm": "--shadow-sm",
  "shadow.md": "--shadow-md",
  "shadow.lg": "--shadow-lg"
};

export type TokenPath = keyof typeof TOKEN_CSS_VAR;

/**
 * Resolve a token path to its CSS `var(--…)` reference string.
 * Use in inline styles: `{ color: cssVar("color.ink") }`.
 */
export function cssVar(path: TokenPath): string {
  const name = TOKEN_CSS_VAR[path];
  if (!name) {
    throw new Error(`[ds/tokens] unknown token path: ${path}`);
  }
  return `var(${name})`;
}

/** Structured token tree for autocomplete-friendly access. */
export const tokens = {
  color: {
    bg: { main: cssVar("color.bg.main"), panel: cssVar("color.bg.panel") },
    ink: { base: cssVar("color.ink"), soft: cssVar("color.ink.soft") },
    accent: { base: cssVar("color.accent"), hover: cssVar("color.accent.hover") },
    warn: cssVar("color.warn"),
    line: cssVar("color.line"),
    status: {
      approved: cssVar("color.status.approved"),
      exported: cssVar("color.status.exported"),
      parsed: cssVar("color.status.parsed"),
      needsReview: cssVar("color.status.needsReview"),
      pending: cssVar("color.status.pending"),
      failedOcr: cssVar("color.status.failedOcr"),
      failedParse: cssVar("color.status.failedParse")
    }
  },
  space: {
    s1: cssVar("space.1"),
    s2: cssVar("space.2"),
    s3: cssVar("space.3"),
    s4: cssVar("space.4"),
    s5: cssVar("space.5"),
    s6: cssVar("space.6"),
    s8: cssVar("space.8")
  },
  radius: {
    sm: cssVar("radius.sm"),
    md: cssVar("radius.md"),
    lg: cssVar("radius.lg")
  },
  shadow: {
    sm: cssVar("shadow.sm"),
    md: cssVar("shadow.md"),
    lg: cssVar("shadow.lg")
  },
  /**
   * Typography: font family is inherited from `<body>` (Inter, imported in
   * styles.css). Sizes expressed in rem so they scale with user preference.
   */
  font: {
    family: '"Inter", system-ui, -apple-system, sans-serif',
    size: {
      xs: "0.75rem",
      sm: "0.82rem",
      base: "0.9rem",
      md: "1rem",
      lg: "1.15rem",
      xl: "1.4rem"
    },
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700
    },
    lineHeight: {
      tight: 1.2,
      snug: 1.35,
      normal: 1.5
    }
  }
} as const;

export type Tokens = typeof tokens;
