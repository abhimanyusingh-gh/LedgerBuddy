import { useEffect, useRef } from "react";

const SHORTCUT_KEY = {
  NextRow: "j",
  PrevRow: "k",
  ToggleExpand: " ",
  OpenDetail: "Enter",
  Approve: "a",
  Export: "e",
  Escape: "Escape",
  Help: "?"
} as const;

interface KeyboardShortcutActions {
  enabled: boolean;
  onMoveDown?: () => void;
  onMoveUp?: () => void;
  onToggleExpand?: () => void;
  onOpenDetail?: () => void;
  onApprove?: () => void;
  onExport?: () => void;
  onEscape?: () => void;
  onShowHelp?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;
    return isEditableElement(active);
  }
  return isEditableElement(target);
}

function isEditableElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  const editableAttr = el.getAttribute("contenteditable");
  if (editableAttr === "" || editableAttr === "true" || editableAttr === "plaintext-only") return true;
  return false;
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!actions.enabled) return;

    function handler(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;

      const a = actionsRef.current;
      switch (event.key) {
        case "ArrowDown":
        case SHORTCUT_KEY.NextRow:
          event.preventDefault();
          a.onMoveDown?.();
          break;
        case "ArrowUp":
        case SHORTCUT_KEY.PrevRow:
          event.preventDefault();
          a.onMoveUp?.();
          break;
        case SHORTCUT_KEY.ToggleExpand:
          event.preventDefault();
          a.onToggleExpand?.();
          break;
        case SHORTCUT_KEY.OpenDetail:
          event.preventDefault();
          a.onOpenDetail?.();
          break;
        case SHORTCUT_KEY.Approve:
          event.preventDefault();
          a.onApprove?.();
          break;
        case SHORTCUT_KEY.Export:
          event.preventDefault();
          a.onExport?.();
          break;
        case SHORTCUT_KEY.Escape:
          event.preventDefault();
          a.onEscape?.();
          break;
        case SHORTCUT_KEY.Help:
          event.preventDefault();
          a.onShowHelp?.();
          break;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions.enabled]);
}
