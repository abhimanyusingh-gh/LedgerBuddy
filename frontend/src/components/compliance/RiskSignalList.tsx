import { useState } from "react";
import type { InvoiceCompliance } from "@/types";

type RiskSignal = NonNullable<InvoiceCompliance["riskSignals"]>[number];

interface RiskSignalListProps {
  signals: RiskSignal[];
  legacyRiskFlags?: string[];
  legacyRiskMessages?: string[];
  onDismiss?: (signalCode: string) => void;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 };
const SEVERITY_COLORS: Record<string, string> = {
  critical: "var(--color-error, #ef4444)",
  warning: "var(--color-warning, #f59e0b)",
  info: "var(--color-info, #3b82f6)"
};

export function RiskSignalList({ signals, legacyRiskFlags, legacyRiskMessages, onDismiss }: RiskSignalListProps) {
  const [expanded, setExpanded] = useState(false);

  const effectiveSignals: RiskSignal[] = signals.length > 0
    ? signals
    : (legacyRiskFlags ?? []).map((code, i) => ({
        code,
        category: "financial" as const,
        severity: "warning" as const,
        message: legacyRiskMessages?.[i] ?? code,
        confidencePenalty: 0,
        status: "open" as const,
        resolvedBy: null,
        resolvedAt: null
      }));

  if (effectiveSignals.length === 0) return null;

  const openSignals = effectiveSignals.filter((s) => s.status === "open");
  const sorted = [...effectiveSignals].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  const maxSeverity = sorted[0]?.severity ?? "info";
  const badgeColor = SEVERITY_COLORS[maxSeverity] ?? SEVERITY_COLORS.info;

  return (
    <div style={{ borderTop: "1px solid var(--border-color, #e0e0e0)", padding: "0.75rem 0" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", userSelect: "none" }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary, #666)" }}>
          Risk Signals
        </span>
        <span style={{
          fontSize: "0.7rem",
          fontWeight: 600,
          padding: "0.1rem 0.4rem",
          borderRadius: "0.75rem",
          backgroundColor: badgeColor,
          color: "#fff"
        }}>
          {openSignals.length}
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary, #999)" }}>
          {expanded ? "collapse" : "expand"}
        </span>
      </div>

      {expanded && (
        <div style={{ marginTop: "0.5rem" }}>
          {sorted.map((signal, i) => (
            <div
              key={`${signal.code}-${i}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                padding: "0.35rem 0",
                borderLeft: `3px solid ${SEVERITY_COLORS[signal.severity] ?? SEVERITY_COLORS.info}`,
                paddingLeft: "0.5rem",
                marginBottom: "0.25rem",
                opacity: signal.status === "dismissed" ? 0.5 : 1,
                fontSize: "0.85rem"
              }}
            >
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 500, fontSize: "0.75rem", color: SEVERITY_COLORS[signal.severity] }}>
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
