import { useCallback, useEffect, useMemo, useState } from "react";
import { formatOcrConfidenceLabel } from "../extractedFields";
import { getInvoiceSourceHighlights, type SourceFieldKey } from "../sourceHighlights";
import type { Invoice } from "../types";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.5;

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
  const [zoom, setZoom] = useState(1);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP)), []);
  const handleZoomReset = useCallback(() => setZoom(1), []);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + e.deltaY * -0.005)));
  }, []);

  useEffect(() => {
    if (availableHighlights.length === 0) {
      setActiveFieldKey("");
      return;
    }

    if (!availableHighlights.some((highlight) => highlight.fieldKey === activeFieldKey)) {
      setActiveFieldKey(availableHighlights[0].fieldKey);
    }
  }, [activeFieldKey, availableHighlights]);

  useEffect(() => {
    setZoom(1);
  }, [activeFieldKey]);

  if (availableHighlights.length === 0) {
    return (
      <div className="source-viewer-card">
        <div className="source-viewer-head">
          <h3>Source Preview</h3>
          <p className="muted">
            No extracted value highlights are available yet. Use the source document for manual verification.
          </p>
        </div>
        {hasDefaultPreview ? (
          <>
            <ZoomControls zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onReset={handleZoomReset} />
            <div className="source-preview-wrap">
              <div className="source-preview-image" onWheel={handleWheel}>
                <div className="source-preview-canvas" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                  <img src={defaultPreviewUrl} alt={`Source preview for ${invoice.attachmentName}`} loading="lazy" />
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="muted">Source preview is unavailable for this invoice.</p>
        )}
      </div>
    );
  }

  const activeHighlight =
    availableHighlights.find((highlight) => highlight.fieldKey === activeFieldKey) ?? availableHighlights[0];
  const activeOverlayUrl = overlayUrlByField[activeHighlight.fieldKey];
  const activePreviewUrl = canUsePreviewFallback ? resolvePreviewUrl?.(activeHighlight.page) : undefined;
  const activeImageUrl = activeOverlayUrl ?? activePreviewUrl;
  if (!activeImageUrl) {
    return (
      <div className="source-viewer-card">
        <div className="source-viewer-head">
          <h3>Value Source Highlights</h3>
          <p className="muted">Select a field to see where the value was read from.</p>
        </div>
        <p className="muted">Source preview is unavailable for the selected highlight.</p>
      </div>
    );
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

      <ZoomControls zoom={zoom} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onReset={handleZoomReset} />
      <div className="source-preview-wrap">
        <div className="source-preview-image" onWheel={handleWheel}>
          <div className="source-preview-canvas" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
            <img src={activeImageUrl} alt={`Source overlay for ${activeHighlight.label} in ${invoice.attachmentName}`} loading="lazy" />
            {renderClientSideBox ? <div className="source-preview-box" style={boxStyle} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset }: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="source-zoom-controls">
      <button type="button" onClick={onZoomOut} aria-label="Zoom out" disabled={zoom <= ZOOM_MIN}>−</button>
      <button type="button" onClick={onReset} className="source-zoom-label">{Math.round(zoom * 100)}%</button>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in" disabled={zoom >= ZOOM_MAX}>+</button>
    </div>
  );
}
