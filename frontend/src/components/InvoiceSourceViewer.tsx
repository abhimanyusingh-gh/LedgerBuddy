import { useEffect, useMemo, useState } from "react";
import { formatOcrConfidenceLabel } from "../extractedFields";
import { getInvoiceSourceHighlights, type SourceFieldKey } from "../sourceHighlights";
import type { Invoice } from "../types";

interface InvoiceSourceViewerProps {
  invoice: Invoice;
  overlayUrlByField: Partial<Record<SourceFieldKey, string>>;
  resolvePreviewUrl?: (page: number) => string;
}

export function InvoiceSourceViewer({ invoice, overlayUrlByField, resolvePreviewUrl }: InvoiceSourceViewerProps) {
  const highlights = useMemo(() => getInvoiceSourceHighlights(invoice), [invoice]);
  const canUsePreviewFallback = invoice.sourceType === "folder";
  const availableHighlights = useMemo(
    () =>
      highlights.filter((highlight) => {
        const overlayUrl = overlayUrlByField[highlight.fieldKey];
        if (overlayUrl) {
          return true;
        }
        if (!resolvePreviewUrl || !canUsePreviewFallback) {
          return false;
        }
        return resolvePreviewUrl(highlight.page).trim().length > 0;
      }),
    [canUsePreviewFallback, highlights, overlayUrlByField, resolvePreviewUrl]
  );
  const [activeFieldKey, setActiveFieldKey] = useState<string>("");

  useEffect(() => {
    if (availableHighlights.length === 0) {
      setActiveFieldKey("");
      return;
    }

    if (!availableHighlights.some((highlight) => highlight.fieldKey === activeFieldKey)) {
      setActiveFieldKey(availableHighlights[0].fieldKey);
    }
  }, [activeFieldKey, availableHighlights]);

  if (availableHighlights.length === 0) {
    return null;
  }

  const activeHighlight =
    availableHighlights.find((highlight) => highlight.fieldKey === activeFieldKey) ?? availableHighlights[0];
  const activeOverlayUrl = overlayUrlByField[activeHighlight.fieldKey];
  const activePreviewUrl = canUsePreviewFallback ? resolvePreviewUrl?.(activeHighlight.page) : undefined;
  const activeImageUrl = activeOverlayUrl ?? activePreviewUrl;
  if (!activeImageUrl) {
    return null;
  }
  const renderClientSideBox = !activeOverlayUrl;
  const [x1, y1, x2, y2] = activeHighlight.bboxNormalized;
  const boxStyle = {
    left: `${x1 * 100}%`,
    top: `${y1 * 100}%`,
    width: `${Math.max(0, x2 - x1) * 100}%`,
    height: `${Math.max(0, y2 - y1) * 100}%`
  };

  return (
    <div className="source-viewer-card">
      <div className="source-viewer-head">
        <h3>Value Source Highlights</h3>
        <p className="muted">Select a field to see where the value was read from.</p>
      </div>

      <div className="source-highlight-list">
        {availableHighlights.map((highlight) => {
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
          <div className="source-preview-canvas">
            <img src={activeImageUrl} alt={`Source overlay for ${activeHighlight.label} in ${invoice.attachmentName}`} loading="lazy" />
            {renderClientSideBox ? <div className="source-preview-box" style={boxStyle} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
