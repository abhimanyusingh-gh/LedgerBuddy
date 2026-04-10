import { z } from "zod";

export const runtimeManifestSchema = z.object({
  defaultTenantId: z.string().min(1).optional(),
  defaultWorkloadTier: z.enum(["standard", "heavy"]).optional(),
  ocr: z
    .object({
      provider: z.enum(["auto", "deepseek", "mock", "llamaparse"]).optional(),
      deepseek: z
        .object({
          baseUrl: z.string().min(1).optional(),
          apiKey: z.string().optional(),
          model: z.string().min(1).optional(),
          timeoutMs: z.coerce.number().int().positive().optional()
        })
        .optional(),
      mock: z
        .object({
          text: z.string().optional(),
          confidence: z.coerce.number().min(0).max(1).optional()
        })
        .optional(),
      llamaparse: z
        .object({
          apiKey: z.string().optional(),
          tier: z.enum(["fast", "cost_effective", "agentic", "agentic_plus"]).optional()
        })
        .optional()
    })
    .optional(),
  verifier: z
    .object({
      provider: z.enum(["none", "http"]).optional(),
      http: z
        .object({
          baseUrl: z.string().min(1).optional(),
          timeoutMs: z.coerce.number().int().positive().optional(),
          apiKey: z.string().optional()
        })
        .optional()
    })
    .optional(),
  fileStore: z
    .object({
      provider: z.enum(["local", "s3"]).optional(),
      local: z
        .object({
          rootPath: z.string().min(1).optional()
        })
        .optional(),
      s3: z
        .object({
          bucket: z.string().optional(),
          region: z.string().min(1).optional(),
          prefix: z.string().optional(),
          endpoint: z.string().optional(),
          forcePathStyle: z.coerce.boolean().optional()
        })
        .optional()
    })
    .optional(),
  extraction: z
    .object({
      ocrHighConfidenceThreshold: z.coerce.number().min(0).max(1).optional(),
      llmAssistConfidenceThreshold: z.coerce.number().int().min(0).max(100).optional()
    })
    .optional(),
  database: z
    .object({
      provider: z.literal("mongo").optional(),
      uri: z.string().min(1).optional()
    })
    .optional(),
  export: z
    .object({
      tallyEndpoint: z.string().optional(),
      tallyCompany: z.string().optional(),
      tallyPurchaseLedger: z.string().optional(),
      tallyGstLedgers: z
        .object({
          cgstLedger: z.string().optional(),
          sgstLedger: z.string().optional(),
          igstLedger: z.string().optional(),
          cessLedger: z.string().optional()
        })
        .optional()
    })
    .optional(),
  sources: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("email"),
          key: z.string().min(1).optional(),
          tenantId: z.string().min(1).optional(),
          workloadTier: z.enum(["standard", "heavy"]).optional(),
          oauthUserId: z.string().min(1).optional(),
          transport: z.enum(["imap", "mailhog_oauth"]).optional(),
          mailhogApiBaseUrl: z.string().optional(),
          host: z.string().optional(),
          port: z.coerce.number().int().positive().optional(),
          secure: z.coerce.boolean().optional(),
          smtpHost: z.string().optional(),
          smtpPort: z.coerce.number().int().positive().optional(),
          smtpSecure: z.coerce.boolean().optional(),
          smtpTimeoutMs: z.coerce.number().int().positive().optional(),
          username: z.string().optional(),
          authMode: z.enum(["password", "oauth2"]).optional(),
          password: z.string().optional(),
          oauth2: z
            .object({
              clientId: z.string().optional(),
              clientSecret: z.string().optional(),
              refreshToken: z.string().optional(),
              accessToken: z.string().optional(),
              tokenEndpoint: z.string().optional()
            })
            .optional(),
          mailbox: z.string().optional(),
          fromFilter: z.string().optional()
        }),
        z.object({
          type: z.literal("folder"),
          key: z.string().min(1).optional(),
          tenantId: z.string().min(1).optional(),
          workloadTier: z.enum(["standard", "heavy"]).optional(),
          folderPath: z.string().optional(),
          recursive: z.coerce.boolean().optional()
        })
      ])
    )
    .optional()
});

export type RuntimeManifestInput = z.infer<typeof runtimeManifestSchema>;
export type RuntimeSourceInput = NonNullable<RuntimeManifestInput["sources"]>[number];
