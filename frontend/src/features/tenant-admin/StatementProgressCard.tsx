import type { BankParseProgressEvent } from "@/api/bank";

interface StatementProgressCardProps {
  event: BankParseProgressEvent | null;
  fading?: boolean;
}

const STAGE_LABELS: Record<string, string> = {
  "text-extraction": "Extracting text...",
  ocr: "Running OCR...",
  "slm-chunk": "Processing",
  validation: "Validating transactions..."
};

function stageMessage(event: BankParseProgressEvent): string {
  if (event.type === "start") return "Starting parse...";
  if (event.type === "error") return event.message ?? "Parse failed";
  if (event.type === "complete") {
    return `Done — ${event.transactionCount ?? 0} transactions`;
  }

  const base = STAGE_LABELS[event.stage ?? ""] ?? "Processing...";
  if (event.stage === "slm-chunk" && event.chunk != null && event.totalChunks != null) {
    return `Processing chunk ${event.chunk}/${event.totalChunks}...`;
  }
  return base;
}

export function StatementProgressCard({ event, fading }: StatementProgressCardProps) {
  if (!event) return null;

  const isRunning = event.type === "start" || event.type === "progress";
  const isFailed = event.type === "error";
  const isComplete = event.type === "complete";

  const stateClass = isRunning
    ? "ingestion-progress-running"
    : isFailed
      ? "ingestion-progress-failed"
      : "ingestion-progress-complete";

  const icon = isRunning ? "sync" : isFailed ? "error" : "check_circle";
  const headline = stageMessage(event);
  const txnCount = event.transactionsSoFar ?? event.transactionCount ?? 0;

  let progressPercent = 0;
  if (event.type === "complete") {
    progressPercent = 100;
  } else if (event.stage === "text-extraction" || event.stage === "ocr") {
    progressPercent = 15;
  } else if (event.stage === "slm-chunk" && event.chunk != null && event.totalChunks != null && event.totalChunks > 0) {
    progressPercent = 15 + Math.round((event.chunk / event.totalChunks) * 70);
  } else if (event.stage === "validation") {
    progressPercent = 90;
  }

  return (
    <div
      className={`ingestion-overlay ${stateClass}${fading ? " ingestion-progress-fading" : ""}`}
      role="status"
      aria-live="polite"
      data-progress-type="statement"
    >
      <div className="ingestion-overlay-header">
        <div className="ingestion-overlay-toggle">
          {isRunning ? <span className="ingestion-spinner" aria-hidden="true" /> : <span className="material-symbols-outlined" style={{ fontSize: "1rem" }}>{icon}</span>}
          <span className="ingestion-overlay-headline">{headline}</span>
        </div>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--ink-soft)", marginLeft: "auto", paddingRight: "0.5rem" }}>Statement Processing</span>
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
      <div className="ingestion-overlay-body">
        <div className="ingestion-progress-track">
          <div className={`ingestion-progress-fill${isRunning ? " ingestion-progress-fill-shimmer" : ""}`} style={{ width: `${progressPercent}%` }} />
        </div>
        <p className="muted ingestion-progress-meta">
          {txnCount > 0 ? `${txnCount} transactions found` : ""}
          {event.fileName ? `${txnCount > 0 ? " | " : ""}${event.fileName}` : ""}
        </p>
        {isFailed && event.message ? (
          <p className="error ingestion-progress-error">{event.message}</p>
        ) : null}
      </div>
    </div>
  );
}
