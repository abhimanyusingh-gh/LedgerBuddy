import axios from "axios";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/config/env.js";
import { refreshGoogleAccessToken } from "@/sources/email/gmailOAuthClient.js";
import { buildXoauth2AuthorizationHeader } from "@/sources/email/xoauth2.js";
import { DOCUMENT_MIME_TYPE, type DocumentMimeType } from "@/types/mime.js";

const MAX_ATTACHMENTS_PER_EMAIL = 2;

interface SimulationAttachment {
  fileName: string;
  mimeType: DocumentMimeType;
  contentBase64: string;
}

interface EmailSimulationSummary {
  emailsSeeded: number;
  attachmentsSeeded: number;
}

export class EmailSimulationService {
  async seedSampleEmails(): Promise<EmailSimulationSummary> {
    this.assertMailhogXoauth2Config();
    const accessToken = await this.resolveAccessToken();
    const authorizationHeader = buildXoauth2AuthorizationHeader(env.EMAIL_USERNAME ?? "", accessToken);
    const attachments = await collectSampleAttachments(resolveSampleDirectory());
    const batches = chunkAttachments(attachments, MAX_ATTACHMENTS_PER_EMAIL);

    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index] ?? [];
      await axios.post(
        `${env.EMAIL_MAILHOG_API_BASE_URL}/seed`,
        {
          from: "billing@example.com",
          to: env.EMAIL_USERNAME,
          subject: `Invoice Batch ${index + 1}`,
          text: `Seeded sample invoice batch ${index + 1}`,
          attachments: batch.map((attachment) => ({
            filename: attachment.fileName,
            contentType: attachment.mimeType,
            contentBase64: attachment.contentBase64
          }))
        },
        {
          timeout: 30_000,
          headers: {
            Authorization: authorizationHeader
          }
        }
      );
    }

    return {
      emailsSeeded: batches.length,
      attachmentsSeeded: attachments.length
    };
  }

  private async resolveAccessToken(): Promise<string> {
    const staticToken = (env.EMAIL_OAUTH_ACCESS_TOKEN ?? "").trim();
    if (staticToken.length > 0) {
      return staticToken;
    }

    const clientId = (env.EMAIL_OAUTH_CLIENT_ID ?? "").trim();
    const clientSecret = (env.EMAIL_OAUTH_CLIENT_SECRET ?? "").trim();
    const refreshToken = (env.EMAIL_OAUTH_REFRESH_TOKEN ?? "").trim();
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("EMAIL_OAUTH credentials are incomplete for simulation.");
    }

    const refreshed = await refreshGoogleAccessToken({
      clientId,
      clientSecret,
      refreshToken,
      tokenEndpoint: env.EMAIL_OAUTH_TOKEN_ENDPOINT,
      timeoutMs: 15_000
    });

    return refreshed.accessToken;
  }

  private assertMailhogXoauth2Config(): void {
    if (env.EMAIL_TRANSPORT !== "mailhog_oauth") {
      throw new Error("Email simulation requires EMAIL_TRANSPORT=mailhog_oauth.");
    }
    if (env.EMAIL_AUTH_MODE !== "oauth2") {
      throw new Error("Email simulation requires EMAIL_AUTH_MODE=oauth2.");
    }
    if (!(env.EMAIL_USERNAME ?? "").trim()) {
      throw new Error("EMAIL_USERNAME is required for XOAUTH2 simulation.");
    }
  }
}

async function collectSampleAttachments(directory: string): Promise<SimulationAttachment[]> {
  const fileEntries = await fs.readdir(directory, { withFileTypes: true });
  const fileNames = fileEntries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const requiredFiles = {
    pdf: fileNames.find((fileName) => fileName.toLowerCase().endsWith(".pdf")),
    png: fileNames.find((fileName) => fileName.toLowerCase().endsWith(".png")),
    jpg: fileNames.find((fileName) => fileName.toLowerCase().endsWith(".jpg") || fileName.toLowerCase().endsWith(".jpeg"))
  };

  if (!requiredFiles.pdf || !requiredFiles.png || !requiredFiles.jpg) {
    throw new Error(
      `Sample invoices must include .pdf, .png, and .jpg/.jpeg files in '${directory}' for email simulation.`
    );
  }

  const selectedFiles = [requiredFiles.pdf, requiredFiles.png, requiredFiles.jpg];
  const attachments: SimulationAttachment[] = [];

  for (const fileName of selectedFiles) {
    const absolutePath = path.join(directory, fileName);
    const buffer = await fs.readFile(absolutePath);
    attachments.push({
      fileName,
      mimeType: resolveMimeType(fileName),
      contentBase64: buffer.toString("base64")
    });
  }

  return attachments;
}

function resolveSampleDirectory(): string {
  if (env.EMAIL_SIMULATION_SAMPLE_DIR.trim().length > 0) {
    return resolvePath(env.EMAIL_SIMULATION_SAMPLE_DIR);
  }

  const candidates = [
    "/app/sample-invoices/inbox",
    path.resolve(process.cwd(), "sample-invoices/inbox"),
    path.resolve(process.cwd(), "../sample-invoices/inbox")
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolvePath(rawPath: string): string {
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

function pathExists(candidatePath: string): boolean {
  return !!candidatePath && existsSync(candidatePath);
}

function resolveMimeType(fileName: string): DocumentMimeType {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return DOCUMENT_MIME_TYPE.PDF;
  }
  if (lower.endsWith(".png")) {
    return DOCUMENT_MIME_TYPE.PNG;
  }
  return DOCUMENT_MIME_TYPE.JPEG;
}

function chunkAttachments(attachments: SimulationAttachment[], maxPerBatch: number): SimulationAttachment[][] {
  if (maxPerBatch <= 0) {
    return [attachments];
  }

  const batches: SimulationAttachment[][] = [];
  for (let index = 0; index < attachments.length; index += maxPerBatch) {
    batches.push(attachments.slice(index, index + maxPerBatch));
  }
  return batches;
}
