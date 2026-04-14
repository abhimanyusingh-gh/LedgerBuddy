import { useEffect, useRef, useState } from "react";
import type { Toast } from "@/hooks/useToast";

const ICON_MAP: Record<Toast["type"], string> = {
  success: "check_circle",
  error: "error",
  info: "info"
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(() => setExiting(true), toast.duration);
    return () => clearTimeout(timerRef.current);
  }, [toast.duration]);

  useEffect(() => {
    if (exiting) {
      const t = setTimeout(() => onRemove(toast.id), 200);
      return () => clearTimeout(t);
    }
  }, [exiting, toast.id, onRemove]);

  return (
    <div className={`toast toast-${toast.type}${exiting ? " toast-exiting" : ""}`}>
      <span className="material-symbols-outlined toast-icon">{ICON_MAP[toast.type]}</span>
      <span className="toast-message">{toast.message}</span>
      <button type="button" className="toast-dismiss" onClick={() => setExiting(true)}>
        <span className="material-symbols-outlined" style={{ fontSize: "1rem" }}>close</span>
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}
