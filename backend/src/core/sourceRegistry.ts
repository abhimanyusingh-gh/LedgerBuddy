import type { IngestionSource } from "./interfaces/IngestionSource.js";
import { EmailIngestionSource } from "../sources/EmailIngestionSource.js";
import { FolderIngestionSource } from "../sources/FolderIngestionSource.js";
import type { IngestionSourceManifest } from "./runtimeManifest.js";

export function buildIngestionSources(sourceManifests: IngestionSourceManifest[]): IngestionSource[] {
  const sources: IngestionSource[] = [];

  for (const sourceManifest of sourceManifests) {
    if (sourceManifest.type === "email") {
      if (!sourceManifest.host || !sourceManifest.username || !sourceManifest.password) {
        throw new Error("Email source selected but EMAIL_HOST/EMAIL_USERNAME/EMAIL_PASSWORD are missing.");
      }

      sources.push(
        new EmailIngestionSource({
          key: sourceManifest.key,
          tenantId: sourceManifest.tenantId,
          workloadTier: sourceManifest.workloadTier,
          host: sourceManifest.host,
          port: sourceManifest.port,
          secure: sourceManifest.secure,
          username: sourceManifest.username,
          password: sourceManifest.password,
          mailbox: sourceManifest.mailbox,
          fromFilter: sourceManifest.fromFilter
        })
      );
      continue;
    }

    if (sourceManifest.type === "folder") {
      if (!sourceManifest.folderPath) {
        throw new Error("Folder source selected but FOLDER_SOURCE_PATH is missing.");
      }

      sources.push(
        new FolderIngestionSource({
          key: sourceManifest.key,
          tenantId: sourceManifest.tenantId,
          workloadTier: sourceManifest.workloadTier,
          folderPath: sourceManifest.folderPath,
          recursive: sourceManifest.recursive
        })
      );
      continue;
    }

    throw new Error("Unsupported ingestion source. Add an IngestionSource implementation to support it.");
  }

  return sources;
}
