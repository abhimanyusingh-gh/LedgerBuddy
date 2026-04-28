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
import { createTenantLifecycleRouter, createTenantOnboardingCompleteRouter } from "@/routes/tenant/tenantLifecycle.js";
import { createClientOrgsRouter } from "@/routes/tenant/clientOrgs.js";
import { createMailboxAssignmentsRouter } from "@/routes/tenant/mailboxAssignments.js";
import { createPlatformAdminRouter } from "@/routes/admin/platformAdmin.js";
import { createBankAccountsRouter } from "@/routes/bank/bankAccounts.js";
import { createBankWebhooksRouter } from "@/routes/bank/bankWebhooks.js";
import { createApprovalWorkflowRouter } from "@/routes/invoice/approvalWorkflow.js";
import { createGlCodesRouter } from "@/routes/compliance/glCodes.js";
import { createTdsRatesRouter } from "@/routes/compliance/tdsRates.js";
import { createVendorsRouter } from "@/routes/compliance/vendors.js";
import { createClientComplianceConfigRouter, createComplianceMetadataRouter } from "@/routes/compliance/clientComplianceConfig.js";
import { createCsvExportRouter } from "@/routes/export/csvExport.js";
import { createClientExportConfigRouter } from "@/routes/export/clientExportConfig.js";
import { createBankStatementsRouter, createBankStatementsParseSseRouter } from "@/routes/bank/bankStatements.js";
import { BankStatementParseProgress } from "@/ai/extractors/bank/BankStatementParseProgress.js";
import { createTcsConfigRouter } from "@/routes/compliance/tcsConfig.js";
import { createNotificationConfigRouter, createNotificationLogRouter } from "@/routes/tenant/notificationConfig.js";
import {
  createAuthenticationMiddleware,
  requireNonPlatformAdmin,
  requireTenantSetupCompleted
} from "@/auth/middleware.js";
import { requireMatchingTenantIdParam, requirePathClientOrgOwnership } from "@/auth/pathScope.js";
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

  app.use((req, res, next) => {
    const safeMethods = ["GET", "HEAD", "OPTIONS"];
    if (safeMethods.includes(req.method)) return next();

    if (req.path.startsWith("/api/webhooks/") || req.path.startsWith("/api/connect/")) {
      return next();
    }

    const xRequestedWith = req.header("x-requested-with");
    if (xRequestedWith === "LedgerBuddy") return next();

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
    createTenantLifecycleRouter(dependencies.tenantInviteService)
  );
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createComplianceMetadataRouter());
  app.use("/api", createTdsRatesRouter());

  const jobsRouter = createJobsRouter(
    dependencies.ingestionService,
    dependencies.emailSimulationService,
    dependencies.fileStore
  );
  const uploadsRouter = createUploadsRouter(dependencies.fileStore);
  const analyticsRouter = createAnalyticsRouter();

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

  clientOrgRouter.use(createExportRouter(dependencies.exportService));
  clientOrgRouter.use(createCsvExportRouter());
  clientOrgRouter.use(createClientExportConfigRouter());

  tenantRouter.use(jobsRouter);
  clientOrgRouter.use(jobsRouter);
  tenantRouter.use(uploadsRouter);

  clientOrgRouter.use(createVendorsRouter());
  clientOrgRouter.use(createGlCodesRouter());
  clientOrgRouter.use(createTcsConfigRouter());
  clientOrgRouter.use(createClientComplianceConfigRouter());

  clientOrgRouter.use(createInvoiceRouter(dependencies.invoiceService, dependencies.approvalWorkflowService, dependencies.fileStore));
  clientOrgRouter.use(createActionRequiredRouter());
  clientOrgRouter.use(createApprovalWorkflowRouter(dependencies.approvalWorkflowService));
  tenantRouter.use(createTriageRouter(dependencies.triageService));

  clientOrgRouter.use(createNotificationConfigRouter());

  tenantRouter.use(analyticsRouter);

  const tenantAdminRouter = express.Router({ mergeParams: true });
  app.use(
    "/api/tenants/:tenantId",
    requireNonPlatformAdmin,
    requireMatchingTenantIdParam,
    tenantAdminRouter
  );
  tenantAdminRouter.use(createTenantAdminRouter(dependencies.tenantAdminService, dependencies.tenantInviteService));
  tenantAdminRouter.use(createClientOrgsRouter(dependencies.clientOrgsAdminService));
  tenantAdminRouter.use(createMailboxAssignmentsRouter(dependencies.mailboxAssignmentsAdminService));
  tenantAdminRouter.use(createGmailConnectionRouter(dependencies.gmailIntegrationService));
  tenantAdminRouter.use(createNotificationLogRouter());
  tenantAdminRouter.use(createTenantOnboardingCompleteRouter(dependencies.tenantAdminService));

  const bankParseProgress = new BankStatementParseProgress();
  clientOrgRouter.use(createBankAccountsRouter(dependencies.bankService));
  clientOrgRouter.use(createBankStatementsRouter(dependencies.fileStore, dependencies.ocrProvider, dependencies.fieldVerifier, bankParseProgress));
  tenantRouter.use(createBankStatementsParseSseRouter(bankParseProgress));

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
