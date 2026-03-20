import { useEffect } from "react";

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
  useEffect(() => {
    if (!actions.enabled) return;

    function handler(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault();
          actions.onMoveDown?.();
          break;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          actions.onMoveUp?.();
          break;
        case " ":
          e.preventDefault();
          actions.onToggleSelect?.();
          break;
        case "Enter":
          e.preventDefault();
          actions.onOpenDetail?.();
          break;
        case "a":
          actions.onApprove?.();
          break;
        case "e":
          actions.onExport?.();
          break;
        case "Escape":
          actions.onEscape?.();
          break;
        case "?":
          actions.onShowHelp?.();
          break;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions]);
}
