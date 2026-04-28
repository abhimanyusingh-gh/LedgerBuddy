export const INGESTION_URL_PATHS = {
  jobsIngestStatus: "/jobs/ingest/status",
  jobsIngestSse: "/jobs/ingest/sse",
  jobsIngest: "/jobs/ingest",
  jobsIngestEmailSimulate: "/jobs/ingest/email-simulate",
  jobsIngestPause: "/jobs/ingest/pause",
  jobsUpload: "/jobs/upload",
  jobsUploadByKeys: "/jobs/upload/by-keys",
  uploadsPresign: "/uploads/presign"
} as const;
