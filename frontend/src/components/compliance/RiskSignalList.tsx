import { useState } from "react";
import type { InvoiceCompliance } from "@/types";
import { Badge } from "@/components/ds/Badge";

type RiskSignal = NonNullable<InvoiceCompliance["riskSignals"]>[number];

const RISK_SIGNAL_SEVERITY = {
  CRITICAL: "critical",
  WARNING: "warning",
  INFO: "info"
} as const;

type RiskSignalSeverity = (typeof RISK_SIGNAL_SEVERITY)[keyof typeof RISK_SIGNAL_SEVERITY];

const SEVERITY_ORDER: Record<RiskSignalSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2
};

const SEVERITY_COLOR: Record<RiskSignalSeverity, string> = {
  critical: "var(--color-error, #ef4444)",
  warning: "var(--color-warning, #f59e0b)",
  info: "var(--color-info, #3b82f6)"
};

const SEVERITY_TONE: Record<RiskSignalSeverity, "danger" | "warning" | "info"> = {
  critical: "danger",
  warning: "warning",
  info: "info"
};

function orderIndex(sev: string): number {
  return SEVERITY_ORDER[sev as RiskSignalSeverity] ?? 9;
}

function severityColor(sev: string): string {
  return SEVERITY_COLOR[sev as RiskSignalSeverity] ?? SEVERITY_COLOR.info;
}

interface RiskSignalListProps {
  signals: RiskSignal[];
  onDismiss?: (signalCode: string) => void;
  expanded?: boolean;
  onToggle?: () => void;
  controlsId?: string;
}

export function RiskSignalList({
  signals,
  onDismiss,
  expanded: expandedProp,
  onToggle,
  controlsId
}: RiskSignalListProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(true);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : uncontrolledExpanded;
  const handleToggle = () => {
    if (isControlled) {
      onToggle?.();
    } else {
      setUncontrolledExpanded((v) => !v);
    }
  };

  if (signals.length === 0) {
    return (
      <div style={{ borderTop: "1px solid var(--border-color, #e0e0e0)", padding: "0.75rem 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary, #666)" }}>
            Risk Signals
          </span>
          <Badge tone="success" size="sm" icon="check_circle" title="No risk signals">
            No risks
          </Badge>
        </div>
      </div>
    );
  }

  const openSignals = signals.filter((s) => s.status === "open");
  const sorted = [...signals].sort((a, b) => orderIndex(a.severity) - orderIndex(b.severity));
  const maxSeverity = (sorted[0]?.severity ?? RISK_SIGNAL_SEVERITY.INFO) as RiskSignalSeverity;
  const summaryTone = SEVERITY_TONE[maxSeverity] ?? "info";

  return (
    <div style={{ borderTop: "1px solid var(--border-color, #e0e0e0)", padding: "0.75rem 0" }}>
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        aria-controls={controlsId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: "pointer",
          userSelect: "none",
          background: "transparent",
          border: "none",
          padding: 0,
          font: "inherit",
          color: "inherit"
        }}
      >
        <span style={{ fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary, #666)" }}>
          Risk Signals
        </span>
        <Badge tone={summaryTone} size="sm" title={`${openSignals.length} open risk signals`}>
          {openSignals.length}
        </Badge>
        <span aria-hidden="true" style={{ fontSize: "0.75rem", color: "var(--text-secondary, #999)" }}>
          {expanded ? "collapse" : "expand"}
        </span>
      </button>

      {expanded && (
        <div id={controlsId} style={{ marginTop: "0.5rem" }}>
          {sorted.map((signal, i) => (
            <div
              key={`${signal.code}-${i}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                padding: "0.35rem 0",
                borderLeft: `3px solid ${severityColor(signal.severity)}`,
                paddingLeft: "0.5rem",
                marginBottom: "0.25rem",
                opacity: signal.status === "dismissed" ? 0.5 : 1,
                fontSize: "0.85rem"
              }}
            >
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 500, fontSize: "0.75rem", color: severityColor(signal.severity) }}>
                  {signal.severity.toUpperCase()}
                </span>
                {" "}
                <span>{signal.message}</span>
                {signal.status === "dismissed" && (
                  <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #999)", marginLeft: "0.5rem" }}>
                    (dismissed)
                  </span>
                )}
              </div>
              {signal.status === "open" && onDismiss && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDismiss(signal.code); }}
                  style={{
                    fontSize: "0.7rem",
                    padding: "0.1rem 0.4rem",
                    border: "1px solid var(--border-color, #ccc)",
                    borderRadius: "0.25rem",
                    background: "transparent",
                    cursor: "pointer",
                    whiteSpace: "nowrap"
                  }}
                >
                  Dismiss
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
