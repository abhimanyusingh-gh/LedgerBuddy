import { useEffect, useRef } from "react";

interface KeyboardShortcutActions {
  onMoveDown?: () => void;
  onMoveUp?: () => void;
  onToggleSelect?: () => void;
  onOpenDetail?: () => void;
  onApprove?: () => void;
  onExport?: () => void;
  onEscape?: () => void;
  onShowHelp?: () => void;
  enabled: boolean;
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!actionsRef.current.enabled) return;

    function handler(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      const a = actionsRef.current;
      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          a.onMoveDown?.();
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          a.onMoveUp?.();
          break;
        case " ":
          e.preventDefault();
          a.onToggleSelect?.();
          break;
        case "Enter":
          e.preventDefault();
          a.onOpenDetail?.();
          break;
        case "a":
          a.onApprove?.();
          break;
        case "e":
          a.onExport?.();
          break;
        case "Escape":
          a.onEscape?.();
          break;
        case "?":
          a.onShowHelp?.();
          break;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions.enabled]);
}
