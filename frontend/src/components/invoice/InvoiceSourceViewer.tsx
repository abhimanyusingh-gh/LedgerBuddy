import { useCallback, useEffect, useMemo, useState } from "react";
import { getInvoiceSourceHighlights, type SourceFieldKey } from "@/lib/invoice/sourceHighlights";
import type { Invoice } from "@/types";
import { InvoicePreview } from "@/components/invoice/InvoicePreview";

interface InvoiceSourceViewerProps {
  invoice: Invoice;
  overlayUrlByField: Partial<Record<SourceFieldKey, string>>;
  resolvePreviewUrl?: (page: number) => string;
}

export function InvoiceSourceViewer({ invoice, overlayUrlByField, resolvePreviewUrl }: InvoiceSourceViewerProps) {
  const highlights = useMemo(() => getInvoiceSourceHighlights(invoice), [invoice]);
  const canUsePreviewFallback = typeof resolvePreviewUrl === "function";
  const defaultPreviewUrl = canUsePreviewFallback ? resolvePreviewUrl?.(1) : undefined;
  const hasDefaultPreview = typeof defaultPreviewUrl === "string" && defaultPreviewUrl.trim().length > 0;
  const availableHighlights = useMemo(
    () =>
      highlights.filter((highlight) => {
        const overlayUrl = overlayUrlByField[highlight.fieldKey];
        if (overlayUrl) return true;
        if (!resolvePreviewUrl || !canUsePreviewFallback) return false;
        return resolvePreviewUrl(highlight.page).trim().length > 0;
      }),
    [canUsePreviewFallback, highlights, overlayUrlByField, resolvePreviewUrl]
  );
  const [activeFieldKey, setActiveFieldKey] = useState<string>("");

  const handleChipClick = useCallback(
    (fieldKey: string) => { setActiveFieldKey(fieldKey); },
    []
  );

  useEffect(() => {
    if (availableHighlights.length === 0) {
      setActiveFieldKey("");
      return;
    }
    if (!availableHighlights.some((h) => h.fieldKey === activeFieldKey)) {
      setActiveFieldKey(availableHighlights[0].fieldKey);
    }
  }, [activeFieldKey, availableHighlights]);

  if (availableHighlights.length === 0) {
    return (
      <div className="source-viewer-card">
        <div className="source-viewer-head">
          <h3>Source Preview</h3>
        </div>
        {hasDefaultPreview ? (
          <InvoicePreview
            imageUrl={defaultPreviewUrl!}
            alt={`Source preview for ${invoice.attachmentName}`}
            persistKey={invoice._id}
          />
        ) : (
          <p className="muted">Source preview is unavailable for this invoice.</p>
        )}
      </div>
    );
  }

  const activeHighlight =
    availableHighlights.find((h) => h.fieldKey === activeFieldKey) ?? availableHighlights[0];
  const activeOverlayUrl = overlayUrlByField[activeHighlight.fieldKey];
  const activePreviewUrl = canUsePreviewFallback ? resolvePreviewUrl?.(activeHighlight.page) : undefined;
  const activeImageUrl = activeOverlayUrl ?? activePreviewUrl;
  if (!activeImageUrl) {
    return (
      <div className="source-viewer-card">
        <div className="source-viewer-head"><h3>Source Preview</h3></div>
        <p className="muted">Source preview is unavailable for the selected highlight.</p>
      </div>
    );
  }

  const renderClientSideBox = !activeOverlayUrl;
  const [x1, y1, x2, y2] = activeHighlight.bboxNormalized;
  const boxStyle = renderClientSideBox ? {
    left: `${x1 * 100}%`,
    top: `${y1 * 100}%`,
    width: `${Math.max(0, x2 - x1) * 100}%`,
    height: `${Math.max(0, y2 - y1) * 100}%`
  } : undefined;

  return (
    <div className="source-viewer-card">
      <div className="source-viewer-head">
        <h3>Source Preview</h3>
      </div>

      <div className="source-highlight-list">
        {availableHighlights.map((highlight) => (
          <button
            key={`${highlight.fieldKey}:${highlight.page}`}
            type="button"
            className={`source-highlight-chip ${highlight.fieldKey === activeHighlight.fieldKey ? "source-highlight-chip-active" : ""}`}
            onClick={() => handleChipClick(highlight.fieldKey)}
          >
            <span>{highlight.label}: {highlight.value}</span>
            <small>page {highlight.page}</small>
          </button>
        ))}
      </div>

      <InvoicePreview
        imageUrl={activeImageUrl}
        alt={`Source overlay for ${activeHighlight.label} in ${invoice.attachmentName}`}
        boundingBox={boxStyle}
        persistKey={`${invoice._id}-${activeHighlight.fieldKey}`}
      />
    </div>
  );
}
