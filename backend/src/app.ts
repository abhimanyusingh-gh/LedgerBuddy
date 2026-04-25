import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { healthRouter } from "@/routes/auth/health.js";
import { buildDependencies } from "@/core/dependencies.js";
import { createInvoiceRouter } from "@/routes/invoice/invoices.js";
import { createActionRequiredRouter } from "@/routes/invoice/actionRequired.js";
import { createTriageRouter } from "@/routes/invoice/triage.js";
import { createExportRouter } from "@/routes/export/export.js";
import { createAnalyticsRouter } from "@/routes/invoice/analytics.js";
import { createJobsRouter } from "@/routes/ingestion/jobs.js";
import { createUploadsRouter } from "@/routes/ingestion/uploads.js";
import { createGmailConnectionRouter, createGmailPublicRouter } from "@/routes/tenant/gmailConnection.js";
import { createAuthRouter } from "@/routes/auth/auth.js";
import { createSessionRouter } from "@/routes/auth/session.js";
import { createTenantAdminRouter } from "@/routes/tenant/tenantAdmin.js";
import { createTenantLifecycleRouter } from "@/routes/tenant/tenantLifecycle.js";
import { createClientOrgsRouter } from "@/routes/tenant/clientOrgs.js";
import { createMailboxAssignmentsRouter } from "@/routes/tenant/mailboxAssignments.js";
import { createPlatformAdminRouter } from "@/routes/admin/platformAdmin.js";
import { createBankAccountsRouter } from "@/routes/bank/bankAccounts.js";
import { createBankWebhooksRouter } from "@/routes/bank/bankWebhooks.js";
import { createApprovalWorkflowRouter } from "@/routes/invoice/approvalWorkflow.js";
import { createGlCodesRouter } from "@/routes/compliance/glCodes.js";
import { createTdsRatesRouter } from "@/routes/compliance/tdsRates.js";
import { createVendorsRouter } from "@/routes/compliance/vendors.js";
import { createClientComplianceConfigRouter } from "@/routes/compliance/clientComplianceConfig.js";
import { createCsvExportRouter } from "@/routes/export/csvExport.js";
import { createClientExportConfigRouter } from "@/routes/export/clientExportConfig.js";
import { createBankStatementsRouter } from "@/routes/bank/bankStatements.js";
import { createTcsConfigRouter } from "@/routes/compliance/tcsConfig.js";
import { createNotificationConfigRouter } from "@/routes/tenant/notificationConfig.js";
import {
  createAuthenticationMiddleware,
  requireNonPlatformAdmin,
  requireTenantSetupCompleted
} from "@/auth/middleware.js";
import { requireMatchingTenantIdParam, requirePathClientOrgOwnership } from "@/auth/pathScope.js";
import { requireActiveClientOrg } from "@/auth/activeClientOrg.js";
import { logger, runWithLogContext } from "@/utils/logger.js";
import { isHttpError } from "@/errors/HttpError.js";
import { env } from "@/config/env.js";

export async function createApp(prebuiltDependencies?: Awaited<ReturnType<typeof buildDependencies>>) {
  const dependencies = prebuiltDependencies ?? await buildDependencies();
  const app = express();
  const authenticate = createAuthenticationMiddleware(dependencies.authService);

  app.use(cors({
    origin: env.ENV === "local" ? true : env.FRONTEND_BASE_URL,
    exposedHeaders: ["Content-Disposition"]
  }));
  app.use(express.json({ limit: "10mb" }));

  // CSRF protection: require X-Requested-With header on state-changing requests.
  // Browser-initiated cross-origin requests (form submissions, <img> tags, etc.)
  // cannot set custom headers, so this blocks CSRF attacks even without a token.
  // GET/HEAD/OPTIONS are excluded as they should be safe (no side effects).
  app.use((req, res, next) => {
    const safeMethods = ["GET", "HEAD", "OPTIONS"];
    if (safeMethods.includes(req.method)) return next();

    // Skip CSRF check for webhook endpoints that receive external callbacks
    if (req.path.startsWith("/api/webhooks/") || req.path.startsWith("/api/connect/")) {
      return next();
    }

    const xRequestedWith = req.header("x-requested-with");
    if (xRequestedWith === "LedgerBuddy") return next();

    // In local dev, warn but don't block to avoid breaking dev tools / curl
    if (env.ENV === "local") return next();

    res.status(403).json({ message: "Missing CSRF header. Set X-Requested-With: LedgerBuddy on all mutating requests." });
  });
  app.use((req, res, next) => {
    const incoming = req.header("x-correlation-id");
    const correlationId = typeof incoming === "string" && incoming.trim().length > 0 ? incoming.trim() : randomUUID();
    res.setHeader("x-correlation-id", correlationId);

    runWithLogContext(correlationId, () => {
      logger.info("request.start", { method: req.method, path: req.originalUrl });
      res.on("finish", () => {
        runWithLogContext(correlationId, () => {
          logger.info("request.end", { method: req.method, path: req.originalUrl, status: res.statusCode });
        });
      });
      next();
    });
  });

  app.use("/", healthRouter);
  app.use("/api", createAuthRouter(dependencies.authService));
  app.use("/api", createBankWebhooksRouter(dependencies.bankService));
  app.use("/api", createGmailPublicRouter(dependencies.gmailIntegrationService, dependencies.authService));
  app.use("/api", authenticate);
  app.use("/api", createSessionRouter(dependencies.authService));
  app.use("/api", createPlatformAdminRouter(dependencies.platformAdminService));
  app.use(
    "/api",
    requireNonPlatformAdmin,
    createTenantLifecycleRouter(dependencies.tenantAdminService, dependencies.tenantInviteService)
  );
  app.use(
    "/api",
    requireNonPlatformAdmin,
    createTenantAdminRouter(dependencies.tenantAdminService, dependencies.tenantInviteService)
  );
  app.use(
    "/api",
    requireNonPlatformAdmin,
    createClientOrgsRouter(dependencies.clientOrgsAdminService)
  );
  app.use(
    "/api",
    requireNonPlatformAdmin,
    createMailboxAssignmentsRouter(dependencies.mailboxAssignmentsAdminService)
  );
  app.use("/api", requireNonPlatformAdmin, createApprovalWorkflowRouter(dependencies.approvalWorkflowService));
  app.use("/api", createGmailConnectionRouter(dependencies.gmailIntegrationService));
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createInvoiceRouter(dependencies.invoiceService, dependencies.approvalWorkflowService, dependencies.fileStore));
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createActionRequiredRouter());
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createTriageRouter(dependencies.triageService));
  app.use(
    "/api",
    requireNonPlatformAdmin,
    requireTenantSetupCompleted,
    createJobsRouter(dependencies.ingestionService, dependencies.emailSimulationService, dependencies.fileStore)
  );
  app.use(
    "/api",
    requireNonPlatformAdmin,
    requireTenantSetupCompleted,
    createUploadsRouter(dependencies.fileStore)
  );
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createAnalyticsRouter());
  app.use("/api", requireNonPlatformAdmin, createBankAccountsRouter(dependencies.bankService));
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createGlCodesRouter());
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createVendorsRouter());
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createClientComplianceConfigRouter());
  app.use("/api", createTdsRatesRouter());
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createBankStatementsRouter(dependencies.fileStore, dependencies.ocrProvider, dependencies.fieldVerifier));
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createTcsConfigRouter());
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createNotificationConfigRouter());

  // Nested-router scaffold for #171 — REST URL refactor.
  // Routes under `/api/tenants/:tenantId/...` get tenant-id-from-path validation;
  // routes under `/api/tenants/:tenantId/clientOrgs/:clientOrgId/...` additionally
  // get composite-key ownership validation that stamps `req.activeClientOrgId`.
  // Domains migrate one vertical slice at a time (per-domain sub-PRs); the OLD
  // `/api/...` mount stays alive in parallel (additive) so existing FE callers
  // keep working until the FE has fully cut over for that domain.
  // `mergeParams: true` propagates the path params down to mounted routers.
  const tenantRouter = express.Router({ mergeParams: true });
  app.use(
    "/api/tenants/:tenantId",
    requireNonPlatformAdmin,
    requireTenantSetupCompleted,
    requireMatchingTenantIdParam,
    tenantRouter
  );
  const clientOrgRouter = express.Router({ mergeParams: true });
  tenantRouter.use("/clientOrgs/:clientOrgId", requirePathClientOrgOwnership, clientOrgRouter);

  // Export domain (sub-PR 1) — first domain migrated to the new path shape.
  // Mount BOTH new (path-scoped) and old (query-scoped) — backward compat.
  // The router handlers read `req.activeClientOrgId`, which is stamped by
  // either `requirePathClientOrgOwnership` (new) or `requireActiveClientOrg`
  // (old query/header/session source chain).
  clientOrgRouter.use(createExportRouter(dependencies.exportService));
  clientOrgRouter.use(createCsvExportRouter());
  clientOrgRouter.use(createClientExportConfigRouter());

  app.use(
    "/api",
    requireNonPlatformAdmin,
    requireTenantSetupCompleted,
    requireActiveClientOrg,
    createExportRouter(dependencies.exportService)
  );
  app.use(
    "/api",
    requireNonPlatformAdmin,
    requireTenantSetupCompleted,
    requireActiveClientOrg,
    createCsvExportRouter()
  );
  app.use(
    "/api",
    requireNonPlatformAdmin,
    requireTenantSetupCompleted,
    requireActiveClientOrg,
    createClientExportConfigRouter()
  );

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    logger.error("request.error", { message });
    if (isHttpError(error)) {
      res.status(error.statusCode).json({
        message: error.message,
        ...(error.code ? { code: error.code } : {})
      });
      return;
    }

    res.status(500).json({ message });
  });

  return app;
}
