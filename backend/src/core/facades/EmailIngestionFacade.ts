import type { IngestedFile, IngestionSource } from "../interfaces/IngestionSource.js";
import { EmailIngestionSource, type EmailSourceConfig } from "@/sources/EmailIngestionSource.js";
import type { WorkloadTier } from "@/types/tenant.js";

export class EmailIngestionFacade implements IngestionSource {
  readonly type: string;
  readonly key: string;
  readonly tenantId: string;
  readonly workloadTier: WorkloadTier;

  private readonly adapter: EmailIngestionSource;

  constructor(config: EmailSourceConfig) {
    this.adapter = new EmailIngestionSource(config);
    this.type = this.adapter.type;
    this.key = this.adapter.key;
    this.tenantId = this.adapter.tenantId;
    this.workloadTier = this.adapter.workloadTier;
  }

  fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]> {
    return this.adapter.fetchNewFiles(lastCheckpoint);
  }
}
