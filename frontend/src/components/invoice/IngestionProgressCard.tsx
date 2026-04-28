import { useMemo } from "react";
import type { IngestionJobStatus } from "@/types";
import { useUserPrefsStore } from "@/stores/userPrefsStore";

interface IngestionProgressCardProps {
  status: IngestionJobStatus | null;
  progressPercent: number;
  successfulFiles: number;
  fading?: boolean;
  label?: string;
  uploadProgress?: Map<string, number>;
}

function formatElapsed(startedAt?: string): string {
  if (!startedAt) return "";
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function initOverlay(el: HTMLDivElement) {
  let dragging = false;
  let ox = 0;
  let oy = 0;

  const saved = useUserPrefsStore.getState().ingestionOverlay.position;
  if (saved) {
    el.style.left = `${Math.max(0, Math.min(saved.x, window.innerWidth - el.offsetWidth))}px`;
    el.style.top = `${Math.max(0, Math.min(saved.y, window.innerHeight - el.offsetHeight))}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "none";
  }

  el.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-action]")) return;
    dragging = true;
    const rect = el.getBoundingClientRect();
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = "grabbing";
    el.style.transition = "none";
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(e.clientX - ox, window.innerWidth - el.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - oy, window.innerHeight - el.offsetHeight));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.transform = "none";
  });

  el.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    el.releasePointerCapture(e.pointerId);
    el.style.cursor = "grab";
    el.style.transition = "";
    const rect = el.getBoundingClientRect();
    useUserPrefsStore.getState().setIngestionOverlayPosition({
      x: Math.round(rect.left),
      y: Math.round(rect.top)
    });
  });
}

function FileUploadProgress({ uploadProgress }: { uploadProgress: Map<string, number> }) {
  const entries = [...uploadProgress.entries()];
  const totalPercent = entries.length > 0
    ? Math.round(entries.reduce((sum, [, pct]) => sum + pct, 0) / entries.length)
    : 0;

  return (
    <div className="ingestion-overlay ingestion-progress-running" role="status" aria-live="polite" style={{ cursor: "default" }}>
      <div className="ingestion-overlay-header">
        <div className="ingestion-overlay-toggle">
          <span className="ingestion-spinner" aria-hidden="true" />
          <span className="ingestion-overlay-headline">Uploading {entries.length} file{entries.length !== 1 ? "s" : ""} ({totalPercent}%)</span>
        </div>
      </div>
      <div className="ingestion-overlay-body">
        <div className="ingestion-progress-track">
          <div className="ingestion-progress-fill ingestion-progress-fill-shimmer" style={{ width: `${totalPercent}%` }} />
        </div>
        <div style={{ maxHeight: "8rem", overflowY: "auto", marginTop: "0.25rem" }}>
          {entries.map(([name, pct]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", padding: "0.125rem 0" }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
              <span style={{ minWidth: "2.5rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function IngestionProgressCard({ status, progressPercent, successfulFiles, fading, label, uploadProgress }: IngestionProgressCardProps) {
  if (uploadProgress && uploadProgress.size > 0) {
    return <FileUploadProgress uploadProgress={uploadProgress} />;
  }

  if (!status || status.state === "idle" || status.state === "completed") {
    return null;
  }

  const isRunning = status.running;
  const isFailed = status.state === "failed";
  const isPaused = status.state === "paused";
  const isComplete = !isRunning && !isFailed && !isPaused;

  const stateClass = isRunning || isPaused
    ? "ingestion-progress-running"
    : isFailed
      ? "ingestion-progress-failed"
      : "ingestion-progress-complete";

  const headline = useMemo(() => {
    if (isRunning) {
      return status.totalFiles > 0
        ? `${status.processedFiles}/${status.totalFiles} processed`
        : "Ingesting…";
    }
    if (isPaused) return "Paused";
    if (isFailed) return "Failed";
    return `Done — ${status.newInvoices} new`;
  }, [isRunning, isPaused, isFailed, status.totalFiles, status.processedFiles, status.newInvoices]);

  const elapsed = formatElapsed(status.startedAt);
  const icon = isRunning ? "sync" : isFailed ? "error" : isPaused ? "pause_circle" : "check_circle";

  return (
    <div
      ref={(el) => { if (el && !el.dataset.init) { el.dataset.init = "1"; initOverlay(el); } }}
      className={`ingestion-overlay ${stateClass}${fading ? " ingestion-progress-fading" : ""}`}
      role="status"
      aria-live="polite"
      style={{ cursor: "grab" }}
    >
      <div className="ingestion-overlay-header">
        <div className="ingestion-overlay-toggle">
          {isRunning ? <span className="ingestion-spinner" aria-hidden="true" /> : <span className="material-symbols-outlined" style={{ fontSize: "1rem" }}>{icon}</span>}
          <span className="ingestion-overlay-headline">{headline}</span>
          {elapsed && isRunning ? <span className="ingestion-overlay-elapsed">{elapsed}</span> : null}
        </div>
        {label ? <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ink-soft)", marginLeft: "auto", paddingRight: "0.5rem" }}>{label}</span> : null}
        <div className="ingestion-overlay-actions">
          <button
            type="button"
            data-action="minimize"
            className="ingestion-overlay-btn"
            title="Minimize"
            onClick={(e) => {
              e.stopPropagation();
              const overlay = (e.target as HTMLElement).closest(".ingestion-overlay");
              overlay?.classList.toggle("ingestion-overlay-minimized");
            }}
          >
            <span className="material-symbols-outlined">remove</span>
          </button>
          {(isComplete || isFailed) ? (
            <button
              type="button"
              data-action="close"
              className="ingestion-overlay-btn"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                const overlay = (e.target as HTMLElement).closest(".ingestion-overlay");
                if (overlay) (overlay as HTMLElement).style.display = "none";
              }}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="ingestion-overlay-body">
        <div className="ingestion-progress-track">
          <div className={`ingestion-progress-fill${isRunning ? " ingestion-progress-fill-shimmer" : ""}`} style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="muted ingestion-progress-meta">
          Successful {successfulFiles} | New {status.newInvoices} | Dup {status.duplicates} | Fail {status.failures}
        </p>
        {isFailed && status.error ? (
          <p className="error ingestion-progress-error">{status.error}</p>
        ) : null}
      </div>
    </div>
  );
}
