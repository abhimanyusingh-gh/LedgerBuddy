const TOKEN_CSS_VAR = {
  "color.bg.main": "--bg-main",
  "color.bg.panel": "--bg-panel",
  "color.bg.sunken": "--bg-sunken",
  "color.bg.overlay": "--bg-overlay",
  "color.ink": "--ink",
  "color.ink.soft": "--ink-soft",
  "color.ink.muted": "--ink-muted",
  "color.accent": "--accent",
  "color.accent.hover": "--accent-2",
  "color.accent.softBg": "--accent-soft-bg",
  "color.accent.softBgHover": "--accent-soft-bg-hover",
  "color.warn": "--warn",
  "color.warn.softBg": "--warn-soft-bg",
  "color.amber": "--amber",
  "color.amber.softBg": "--amber-soft-bg",
  "color.emerald": "--emerald",
  "color.emerald.softBg": "--emerald-soft-bg",
  "color.line": "--line",
  "color.line.soft": "--line-soft",
  "color.severity.info": "--severity-info",
  "color.severity.warning": "--severity-warning",
  "color.severity.critical": "--severity-critical",
  "color.status.approved": "--status-approved",
  "color.status.exported": "--status-exported",
  "color.status.parsed": "--status-parsed",
  "color.status.needsReview": "--status-needs-review",
  "color.status.awaitingApproval": "--status-awaiting-approval",
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
  "space.10": "--sp-10",
  "space.12": "--sp-12",
  "radius.sm": "--radius-sm",
  "radius.md": "--radius-md",
  "radius.lg": "--radius-lg",
  "radius.pill": "--radius-pill",
  "shadow.sm": "--shadow-sm",
  "shadow.md": "--shadow-md",
  "shadow.lg": "--shadow-lg",
  "shadow.focus": "--shadow-focus",
  "font.family.sans": "--font-sans",
  "font.family.mono": "--font-mono",
  "font.size.xxs": "--fs-xxs",
  "font.size.xs": "--fs-xs",
  "font.size.sm": "--fs-sm",
  "font.size.md": "--fs-md",
  "font.size.base": "--fs-base",
  "font.size.lg": "--fs-lg",
  "font.size.xl": "--fs-xl",
  "font.size.2xl": "--fs-2xl",
  "font.size.3xl": "--fs-3xl",
  "row.compact": "--row-h-compact",
  "row.comfortable": "--row-h-comfortable"
} as const;

type TokenPath = keyof typeof TOKEN_CSS_VAR;

export function cssVar(path: TokenPath): string {
  return `var(${TOKEN_CSS_VAR[path]})`;
}

export const tokens = {
  color: {
    bg: {
      main: cssVar("color.bg.main"),
      panel: cssVar("color.bg.panel"),
      sunken: cssVar("color.bg.sunken"),
      overlay: cssVar("color.bg.overlay")
    },
    ink: {
      base: cssVar("color.ink"),
      soft: cssVar("color.ink.soft"),
      muted: cssVar("color.ink.muted")
    },
    accent: {
      base: cssVar("color.accent"),
      hover: cssVar("color.accent.hover"),
      softBg: cssVar("color.accent.softBg"),
      softBgHover: cssVar("color.accent.softBgHover")
    },
    warn: { base: cssVar("color.warn"), softBg: cssVar("color.warn.softBg") },
    amber: { base: cssVar("color.amber"), softBg: cssVar("color.amber.softBg") },
    emerald: { base: cssVar("color.emerald"), softBg: cssVar("color.emerald.softBg") },
    line: cssVar("color.line"),
    lineSoft: cssVar("color.line.soft"),
    severity: {
      info: cssVar("color.severity.info"),
      warning: cssVar("color.severity.warning"),
      critical: cssVar("color.severity.critical")
    },
    status: {
      approved: cssVar("color.status.approved"),
      exported: cssVar("color.status.exported"),
      parsed: cssVar("color.status.parsed"),
      needsReview: cssVar("color.status.needsReview"),
      awaitingApproval: cssVar("color.status.awaitingApproval"),
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
    s8: cssVar("space.8"),
    s10: cssVar("space.10"),
    s12: cssVar("space.12")
  },
  radius: {
    sm: cssVar("radius.sm"),
    md: cssVar("radius.md"),
    lg: cssVar("radius.lg"),
    pill: cssVar("radius.pill")
  },
  shadow: {
    sm: cssVar("shadow.sm"),
    md: cssVar("shadow.md"),
    lg: cssVar("shadow.lg"),
    focus: cssVar("shadow.focus")
  },
  rowHeight: {
    compact: cssVar("row.compact"),
    comfortable: cssVar("row.comfortable")
  },
  font: {
    family: cssVar("font.family.sans"),
    familySans: cssVar("font.family.sans"),
    familyMono: cssVar("font.family.mono"),
    size: {
      xxs: cssVar("font.size.xxs"),
      xs: cssVar("font.size.xs"),
      sm: cssVar("font.size.sm"),
      md: cssVar("font.size.md"),
      base: cssVar("font.size.base"),
      lg: cssVar("font.size.lg"),
      xl: cssVar("font.size.xl"),
      "2xl": cssVar("font.size.2xl"),
      "3xl": cssVar("font.size.3xl")
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
