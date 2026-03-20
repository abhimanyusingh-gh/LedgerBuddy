import { useMemo } from "react";
import type { IngestionJobStatus } from "../types";

interface IngestionProgressCardProps {
  status: IngestionJobStatus | null;
  progressPercent: number;
  successfulFiles: number;
  fading?: boolean;
}

function formatElapsed(startedAt?: string): string {
  if (!startedAt) return "";
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function IngestionProgressCard({ status, progressPercent, successfulFiles, fading }: IngestionProgressCardProps) {
  if (!status || status.state === "idle") {
    return null;
  }

  const cardClassName = status.running
    ? "ingestion-progress-running"
    : status.state === "failed"
      ? "ingestion-progress-failed"
      : status.state === "paused"
        ? "ingestion-progress-running"
        : "ingestion-progress-complete";

  const headline = useMemo(() => {
    if (status.running) {
      return status.totalFiles > 0
        ? `Processing invoice ${status.processedFiles} of ${status.totalFiles}...`
        : "Ingestion in progress";
    }
    if (status.state === "paused") return "Ingestion paused";
    if (status.state === "failed") return "Ingestion failed";
    return `Ingestion completed \u2014 ${status.newInvoices} new, ${status.duplicates} duplicates, ${status.failures} failed`;
  }, [status.running, status.state, status.totalFiles, status.processedFiles, status.newInvoices, status.duplicates, status.failures]);

  const elapsed = formatElapsed(status.startedAt);

  return (
    <div className={`ingestion-progress ${cardClassName}${fading ? " ingestion-progress-fading" : ""}`} role="status" aria-live="polite">
      <div className="ingestion-progress-head">
        {status.running ? <span className="ingestion-spinner" aria-hidden="true" /> : null}
        <strong>{headline}</strong>
        <span>
          {status.processedFiles}/{status.totalFiles > 0 ? status.totalFiles : "?"} processed
          {elapsed ? ` \u00b7 ${elapsed}` : ""}
        </span>
      </div>

      <div className="ingestion-progress-track">
        <div className={`ingestion-progress-fill${status.running ? " ingestion-progress-fill-shimmer" : ""}`} style={{ width: `${progressPercent}%` }} />
      </div>

      <p className="muted ingestion-progress-meta">
        Successful {successfulFiles} | New {status.newInvoices} | Duplicates {status.duplicates} | Failures{" "}
        {status.failures}
      </p>

      {status.state === "failed" && status.error ? (
        <p className="error ingestion-progress-error">{status.error}. Check service health and retry.</p>
      ) : null}
    </div>
  );
}
