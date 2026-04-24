import { Badge, type BadgeTone } from "@/components/ds/Badge";

export const RISK_SEVERITY = {
  CRITICAL: "critical",
  WARNING: "warning",
  INFO: "info",
  CLEAN: "clean"
} as const;

export type RiskSeverity = (typeof RISK_SEVERITY)[keyof typeof RISK_SEVERITY];

interface RiskDotProps {
  severity: RiskSeverity;
  count: number;
}

const TONE_BY_SEVERITY: Record<RiskSeverity, BadgeTone> = {
  critical: "danger",
  warning: "warning",
  info: "info",
  clean: "success"
};

const ICON_BY_SEVERITY: Record<RiskSeverity, string> = {
  critical: "error",
  warning: "warning",
  info: "info",
  clean: "check_circle"
};

const LABEL_BY_SEVERITY: Record<RiskSeverity, string> = {
  critical: "critical",
  warning: "warning",
  info: "info",
  clean: "clean"
};

function buildAriaLabel(severity: RiskSeverity, count: number): string {
  if (severity === RISK_SEVERITY.CLEAN || count === 0) {
    return "No risk signals";
  }
  const noun = count === 1 ? "risk signal" : "risk signals";
  return `${count} ${LABEL_BY_SEVERITY[severity]} ${noun}`;
}

export function RiskDot({ severity, count }: RiskDotProps) {
  const isClean = severity === RISK_SEVERITY.CLEAN || count === 0;
  const tone = TONE_BY_SEVERITY[severity];
  const icon = ICON_BY_SEVERITY[severity];
  const ariaLabel = buildAriaLabel(severity, count);
  if (isClean) {
    return <Badge tone={tone} size="sm" icon={icon} title={ariaLabel} className="risk-dot" />;
  }
  return (
    <span role="img" aria-label={ariaLabel} className="risk-dot-wrapper">
      <Badge tone={tone} size="sm" icon={icon} title={ariaLabel} className="risk-dot">
        {count}
      </Badge>
    </span>
  );
}
