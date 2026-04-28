import { randomUUID } from "node:crypto";
import { Router } from "express";
import { getAuth } from "@/types/auth.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";
import {
  ALLOWED_UPLOAD_CONTENT_TYPES,
  MAX_UPLOAD_FILE_COUNT,
  MAX_UPLOAD_FILE_SIZE_BYTES,
  PRESIGNED_URL_EXPIRY_SECONDS
} from "@/constants.js";
import { INGESTION_URL_PATHS } from "@/routes/urls/ingestionUrls.js";

interface PresignFileRequest {
  name: string;
  contentType: string;
  sizeBytes: number;
}

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case "application/pdf": return ".pdf";
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/webp": return ".webp";
    default: return "";
  }
}

export function createUploadsRouter(fileStore?: FileStore) {
  const router = Router();
  router.use(requireAuth);

  router.post(INGESTION_URL_PATHS.uploadsPresign, requireCap("canUploadFiles"), async (req, res, next) => {
    try {
      if (!fileStore?.generatePresignedPutUrl) {
        res.status(400).json({ message: "File storage does not support presigned uploads." });
        return;
      }

      const body = req.body as { files?: unknown };
      if (!Array.isArray(body.files) || body.files.length === 0) {
        res.status(400).json({ message: "Request body must include a non-empty 'files' array." });
        return;
      }

      if (body.files.length > MAX_UPLOAD_FILE_COUNT) {
        res.status(400).json({ message: `Maximum ${MAX_UPLOAD_FILE_COUNT} files per request.` });
        return;
      }

      const files = body.files as PresignFileRequest[];
      const errors: string[] = [];

      for (const file of files) {
        if (typeof file.name !== "string" || file.name.trim().length === 0) {
          errors.push("Each file must have a non-empty 'name'.");
          break;
        }
        if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(file.contentType)) {
          errors.push(`Unsupported content type '${file.contentType}' for '${file.name}'. Allowed: ${[...ALLOWED_UPLOAD_CONTENT_TYPES].join(", ")}.`);
        }
        if (typeof file.sizeBytes !== "number" || file.sizeBytes <= 0) {
          errors.push(`Invalid size for '${file.name}'.`);
        }
        if (typeof file.sizeBytes === "number" && file.sizeBytes > MAX_UPLOAD_FILE_SIZE_BYTES) {
          errors.push(`File '${file.name}' exceeds the ${MAX_UPLOAD_FILE_SIZE_BYTES / (1024 * 1024)} MB size limit.`);
        }
      }

      if (errors.length > 0) {
        res.status(400).json({ message: errors.join(" ") });
        return;
      }

      const context = getAuth(req);
      const uploads = await Promise.all(
        files.map(async (file) => {
          const ext = extensionForContentType(file.contentType);
          const key = `uploads/${context.tenantId}/${randomUUID()}${ext}`;
          const uploadUrl = await fileStore.generatePresignedPutUrl!(
            key,
            file.contentType,
            PRESIGNED_URL_EXPIRY_SECONDS
          );
          const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();
          return { key, uploadUrl, expiresAt };
        })
      );

      res.json({ uploads });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
