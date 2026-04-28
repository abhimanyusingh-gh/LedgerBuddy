export const EXPORT_URL_PATHS = {
  csv: "/exports/csv",
  tally: "/exports/tally",
  tallyDownload: "/exports/tally/download",
  tallyHistory: "/exports/tally/history",
  tallyDownloadByBatchId: "/exports/tally/download/:batchId",
  tallyRetryByBatchId: "/exports/tally/batches/:batchId/retry",
  config: "/export-config"
} as const;
