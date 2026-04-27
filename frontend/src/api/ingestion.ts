import { apiClient } from "@/api/client";
import { ingestionUrls } from "@/api/urls/ingestionUrls";
import { MissingActiveClientOrgError } from "@/api/errors";
import type { IngestionJobStatus } from "@/types";

function sanitizeIngestionStatus(value: unknown): IngestionJobStatus {
  const data = value as Partial<IngestionJobStatus>;
  const validStates = ["running", "completed", "failed", "idle", "paused"] as const;
  return {
    state: validStates.includes(data.state as typeof validStates[number]) ? data.state! : "idle",
    running: data.running === true,
    totalFiles: typeof data.totalFiles === "number" ? data.totalFiles : 0,
    processedFiles: typeof data.processedFiles === "number" ? data.processedFiles : 0,
    newInvoices: typeof data.newInvoices === "number" ? data.newInvoices : 0,
    duplicates: typeof data.duplicates === "number" ? data.duplicates : 0,
    failures: typeof data.failures === "number" ? data.failures : 0,
    startedAt: typeof data.startedAt === "string" ? data.startedAt : undefined,
    completedAt: typeof data.completedAt === "string" ? data.completedAt : undefined,
    error: typeof data.error === "string" ? data.error : undefined,
    correlationId: typeof data.correlationId === "string" ? data.correlationId : undefined,
    lastUpdatedAt: (typeof data.lastUpdatedAt === "string" ? data.lastUpdatedAt : undefined) ?? new Date(0).toISOString(),
    systemAlert: typeof data.systemAlert === "string" ? data.systemAlert : undefined
  };
}

interface PresignedUploadEntry {
  key: string;
  uploadUrl: string;
  expiresAt: string;
}

interface PresignedUploadResponse {
  uploads: PresignedUploadEntry[];
}

export async function requestPresignedUrls(
  files: Array<{ name: string; contentType: string; sizeBytes: number }>
): Promise<PresignedUploadResponse> {
  return (await apiClient.post<PresignedUploadResponse>("/uploads/presign", { files })).data;
}

export async function registerUploadedKeys(
  keys: string[]
): Promise<{ uploaded: string[]; count: number }> {
  return (await apiClient.post<{ uploaded: string[]; count: number }>("/jobs/upload/by-keys", { keys })).data;
}

export async function runIngestion() {
  return sanitizeIngestionStatus((await apiClient.post<IngestionJobStatus>("/jobs/ingest")).data);
}

export async function pauseIngestion() {
  return sanitizeIngestionStatus((await apiClient.post<IngestionJobStatus>("/jobs/ingest/pause")).data);
}

export async function fetchIngestionStatus() {
  return sanitizeIngestionStatus((await apiClient.get<IngestionJobStatus>("/jobs/ingest/status")).data);
}

export function subscribeIngestionSSE(
  onMessage: (status: IngestionJobStatus) => void,
  onError?: () => void
): () => void {
  let resolvedUrl: string;
  try {
    resolvedUrl = ingestionUrls.sseStatus();
  } catch (err) {
    if (err instanceof MissingActiveClientOrgError) {
      onError?.();
      return () => {};
    }
    throw err;
  }
  let disposed = false;
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (disposed) return;
    source = new EventSource(resolvedUrl);
    source.onmessage = (e) => onMessage(sanitizeIngestionStatus(JSON.parse(e.data)));
    source.onerror = () => {
      if (source) {
        source.close();
        source = null;
      }
      onError?.();
      if (!disposed && reconnectTimer == null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 2000);
      }
    };
  };

  connect();

  return () => {
    disposed = true;
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
    }
    source?.close();
  };
}
