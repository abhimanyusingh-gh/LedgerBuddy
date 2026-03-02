import { useEffect, useMemo, useState } from "react";
import { formatOcrConfidenceLabel } from "../extractedFields";
import { getInvoiceSourceHighlights, type SourceFieldKey } from "../sourceHighlights";
import type { Invoice } from "../types";

interface InvoiceSourceViewerProps {
  invoice: Invoice;
  overlayUrlByField: Partial<Record<SourceFieldKey, string>>;
}

export function InvoiceSourceViewer({ invoice, overlayUrlByField }: InvoiceSourceViewerProps) {
  const highlights = useMemo(
    () => getInvoiceSourceHighlights(invoice).filter((highlight) => Boolean(overlayUrlByField[highlight.fieldKey])),
    [invoice, overlayUrlByField]
  );
  const [activeFieldKey, setActiveFieldKey] = useState<string>("");

  useEffect(() => {
    if (highlights.length === 0) {
      setActiveFieldKey("");
      return;
    }

    if (!highlights.some((highlight) => highlight.fieldKey === activeFieldKey)) {
      setActiveFieldKey(highlights[0].fieldKey);
    }
  }, [activeFieldKey, highlights]);

  if (highlights.length === 0) {
    return null;
  }

  const activeHighlight = highlights.find((highlight) => highlight.fieldKey === activeFieldKey) ?? highlights[0];
  const activeOverlayUrl = overlayUrlByField[activeHighlight.fieldKey];
  if (!activeOverlayUrl) {
    return null;
  }

  return (
    <div className="source-viewer-card">
      <div className="source-viewer-head">
        <h3>Value Source Highlights</h3>
        <p className="muted">Select a field to see where the value was read from.</p>
      </div>

      <div className="source-highlight-list">
        {highlights.map((highlight) => {
          const isActive = highlight.fieldKey === activeHighlight.fieldKey;
          return (
            <button
              key={`${highlight.fieldKey}:${highlight.page}`}
              type="button"
              className={`source-highlight-chip ${isActive ? "source-highlight-chip-active" : ""}`}
              onClick={() => setActiveFieldKey(highlight.fieldKey)}
            >
              <span>{highlight.label}: {highlight.value}</span>
              <small>
                {formatOcrConfidenceLabel(highlight.confidence)} | page {highlight.page}
              </small>
            </button>
          );
        })}
      </div>

      <div className="source-preview-wrap">
        <div className="source-preview-image">
          <img src={activeOverlayUrl} alt={`Source overlay for ${activeHighlight.label} in ${invoice.attachmentName}`} loading="lazy" />
        </div>
      </div>
    </div>
  );
}
