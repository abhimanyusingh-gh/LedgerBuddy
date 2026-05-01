import { useState } from "react";
import { retryExportFailures } from "@/api";
import { normalizeApiError } from "@/lib/common/apiError";

interface ExportBatchRetryButtonProps {
  batchId: string;
  onRetried: () => void;
  onError: (message: string) => void;
}

export function ExportBatchRetryButton({ batchId, onRetried, onError }: ExportBatchRetryButtonProps) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await retryExportFailures(batchId);
      onRetried();
    } catch (error) {
      onError(normalizeApiError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="app-button app-button-secondary app-button-sm"
      disabled={busy}
      onClick={() => void handleClick()}
    >
      {busy ? "Retrying..." : "Retry failures"}
    </button>
  );
}
