import { useCallback, useEffect, useRef, useState } from "react";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;

interface BoundingBox {
  left: string;
  top: string;
  width: string;
  height: string;
}

interface InvoicePreviewProps {
  imageUrl: string;
  alt: string;
  boundingBox?: BoundingBox;
  persistKey?: string;
}

export function InvoicePreview({ imageUrl, alt, boundingBox, persistKey }: InvoicePreviewProps) {
  const [zoom, setZoom] = useState(() => {
    if (!persistKey) return 1;
    try {
      const stored = localStorage.getItem(`ledgerbuddy:zoom:${persistKey}`);
      return stored ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(stored))) : 1;
    } catch { return 1; }
  });
  const [dragging, setDragging] = useState(false);
  const [imageError, setImageError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  useEffect(() => {
    setImageError(false);
  }, [imageUrl]);

  useEffect(() => {
    if (persistKey) {
      try { localStorage.setItem(`ledgerbuddy:zoom:${persistKey}`, String(zoom)); } catch {}
    }
  }, [zoom, persistKey]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + e.deltaY * -0.005)));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom <= 1) return;
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop
    };
  }, [zoom]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      container.scrollLeft = dragStartRef.current.scrollLeft - dx;
      container.scrollTop = dragStartRef.current.scrollTop - dy;
    };

    const onUp = () => setDragging(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const cursorStyle = zoom > 1 ? (dragging ? "grabbing" : "grab") : "default";

  return (
    <div className="source-preview-wrap">
      <div className="invoice-preview-toolbar">
        <button type="button" className="app-button app-button-secondary app-button-sm" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 0.25))}>-</button>
        <span style={{ fontSize: "0.8rem", fontWeight: 600, minWidth: "3rem", textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button type="button" className="app-button app-button-secondary app-button-sm" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 0.25))}>+</button>
        <button type="button" className="app-button app-button-secondary app-button-sm" onClick={() => setZoom(1)}>Reset</button>
      </div>
      <div
        className="source-preview-image"
        ref={containerRef}
        style={{ cursor: cursorStyle }}
        onMouseDown={handleMouseDown}
      >
        {imageError ? (
          <div className="source-preview-error">
            <span>Image unavailable</span>
          </div>
        ) : (
          <div className="source-preview-canvas" style={{ transform: `scale(${zoom})` }}>
            <img src={imageUrl} alt={alt} loading="lazy" draggable={false} onError={() => setImageError(true)} />
            {boundingBox ? <div className="source-preview-box" style={boundingBox} /> : null}
          </div>
        )}
      </div>
    </div>
  );
}
