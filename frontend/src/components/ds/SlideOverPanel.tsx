import { useCallback, useEffect, useId, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalDismiss } from "@/hooks/useModalDismiss";
import { tokens } from "./tokens";

const SLIDE_OVER_WIDTH = {
  sm: "20rem",
  md: "28rem",
  lg: "36rem"
} as const;

type SlideOverWidth = keyof typeof SLIDE_OVER_WIDTH;

type SlideOverSide = "right" | "left";

export interface SlideOverPanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: SlideOverWidth;
  side?: SlideOverSide;
  dismissOnBackdrop?: boolean;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function SlideOverPanel({
  open,
  title,
  onClose,
  children,
  footer,
  width = "md",
  side = "right",
  dismissOnBackdrop = true
}: SlideOverPanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  useModalDismiss({
    open,
    onClose,
    options: { lockScroll: true, saveFocusOnOpen: true }
  });

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const handleBackdrop = useCallback(() => {
    if (dismissOnBackdrop) onClose();
  }, [dismissOnBackdrop, onClose]);

  const handleFocusTrap = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => !el.hasAttribute("data-focus-guard"));
      if (focusables.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    []
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const reduceMotion = prefersReducedMotion();
  const sideIsRight = side === "right";

  return createPortal(
    <div
      data-testid="slide-over-backdrop"
      onClick={handleBackdrop}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "rgba(7, 16, 13, 0.45)",
        display: "flex",
        justifyContent: sideIsRight ? "flex-end" : "flex-start",
        transition: reduceMotion ? "none" : "opacity 180ms ease-out"
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleFocusTrap}
        style={{
          width: SLIDE_OVER_WIDTH[width],
          maxWidth: "100%",
          height: "100%",
          background: tokens.color.bg.panel,
          borderLeft: sideIsRight ? `1px solid ${tokens.color.line}` : undefined,
          borderRight: sideIsRight ? undefined : `1px solid ${tokens.color.line}`,
          boxShadow: tokens.shadow.lg,
          display: "flex",
          flexDirection: "column",
          outline: "none",
          transform: "translateX(0)",
          transition: reduceMotion
            ? "none"
            : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)"
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: tokens.space.s3,
            padding: `${tokens.space.s4} ${tokens.space.s5}`,
            borderBottom: `1px solid ${tokens.color.line}`
          }}
        >
          <h2
            id={titleId}
            style={{
              margin: 0,
              fontSize: tokens.font.size.lg,
              fontWeight: tokens.font.weight.semibold,
              color: tokens.color.ink.base
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              border: `1px solid ${tokens.color.line}`,
              background: tokens.color.bg.panel,
              color: tokens.color.ink.base,
              borderRadius: tokens.radius.sm,
              padding: `${tokens.space.s1} ${tokens.space.s3}`,
              cursor: "pointer"
            }}
          >
            Close
          </button>
        </header>
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: `${tokens.space.s4} ${tokens.space.s5}`,
            color: tokens.color.ink.base
          }}
        >
          {children}
        </div>
        {footer ? (
          <footer
            style={{
              padding: `${tokens.space.s3} ${tokens.space.s5}`,
              borderTop: `1px solid ${tokens.color.line}`,
              display: "flex",
              justifyContent: "flex-end",
              gap: tokens.space.s3
            }}
          >
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body
  );
}
