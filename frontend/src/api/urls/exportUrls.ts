import { buildClientOrgPathUrl } from "@/api/urls/pathBuilder";

export const exportUrls = {
  tallyDownloadStart: (): string => buildClientOrgPathUrl("/exports/tally/download"),
  tallyDownloadResult: (batchId: string): string =>
    buildClientOrgPathUrl(`/exports/tally/download/${encodeURIComponent(batchId)}`),
  tallyHistory: (): string => buildClientOrgPathUrl("/exports/tally/history"),
  tallyRetryByBatchId: (batchId: string): string =>
    buildClientOrgPathUrl(`/exports/tally/batches/${encodeURIComponent(batchId)}/retry`)
};
