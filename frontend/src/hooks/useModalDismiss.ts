import { useEffect, useRef } from "react";

interface UseModalDismissOptions {
  lockScroll?: boolean;
  saveFocusOnOpen?: boolean;
}

interface UseModalDismissParams {
  open: boolean;
  onClose: () => void;
  options?: UseModalDismissOptions;
}

export function useModalDismiss({ open, onClose, options }: UseModalDismissParams): void {
  const { lockScroll = true, saveFocusOnOpen = false } = options ?? {};
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    if (saveFocusOnOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    }

    let prevOverflow = "";
    if (lockScroll) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("keydown", handleKey);
      if (lockScroll) {
        document.body.style.overflow = prevOverflow;
      }
      if (saveFocusOnOpen) {
        previouslyFocusedRef.current?.focus?.();
      }
    };
  }, [open, onClose, lockScroll, saveFocusOnOpen]);
}
