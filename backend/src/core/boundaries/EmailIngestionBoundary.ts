import type { IngestedFile } from "@/core/interfaces/IngestionSource.js";

export interface EmailIngestionBoundary {
  fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]>;
}

