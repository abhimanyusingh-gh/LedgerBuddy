import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

interface VirtualisedRowsProps<T> {
  items: T[];
  rowHeight: number;
  height: number;
  overscan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  rowKey: (item: T, index: number) => string;
  testId?: string;
  emptyContent?: ReactNode;
}

const DEFAULT_OVERSCAN = 6;

const VROWS_CSS_VAR = {
  CONTAINER_HEIGHT: "--vrows-container-height",
  TOTAL_HEIGHT: "--vrows-total-height",
  OFFSET_Y: "--vrows-offset-y",
  ROW_HEIGHT: "--vrows-row-height"
} as const;

function pxVar(name: string, px: number): CSSProperties {
  return { [name]: `${px}px` } as CSSProperties;
}

export function VirtualisedRows<T>({
  items,
  rowHeight,
  height,
  overscan = DEFAULT_OVERSCAN,
  renderRow,
  rowKey,
  testId,
  emptyContent
}: VirtualisedRowsProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [items]);

  if (items.length === 0) {
    return (
      <div
        className="virtualised-rows virtualised-rows-empty"
        data-testid={testId}
        style={pxVar(VROWS_CSS_VAR.CONTAINER_HEIGHT, height)}
      >
        {emptyContent}
      </div>
    );
  }

  const totalHeight = items.length * rowHeight;
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const lastVisible = Math.min(
    items.length,
    Math.ceil((scrollTop + height) / rowHeight) + overscan
  );
  const offsetY = firstVisible * rowHeight;
  const visible = items.slice(firstVisible, lastVisible);

  return (
    <div
      ref={containerRef}
      className="virtualised-rows"
      data-testid={testId}
      data-rendered-count={visible.length}
      data-total-count={items.length}
      style={pxVar(VROWS_CSS_VAR.CONTAINER_HEIGHT, height)}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
    >
      <div className="virtualised-rows-spacer" style={pxVar(VROWS_CSS_VAR.TOTAL_HEIGHT, totalHeight)}>
        <div className="virtualised-rows-window" style={pxVar(VROWS_CSS_VAR.OFFSET_Y, offsetY)}>
          {visible.map((item, idx) => {
            const absoluteIndex = firstVisible + idx;
            return (
              <div
                key={rowKey(item, absoluteIndex)}
                className="virtualised-rows-row"
                data-row-index={absoluteIndex}
                style={pxVar(VROWS_CSS_VAR.ROW_HEIGHT, rowHeight)}
              >
                {renderRow(item, absoluteIndex)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
