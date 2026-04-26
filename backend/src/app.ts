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
  // Unscoped compliance metadata + tds-rates — deliberately retained on the
  // legacy `/api` mount. These routes have no tenantId/clientOrgId in the URL
  // (tenant comes from the auth context, no realm at all) and FE callers in
  // `frontend/src/api/admin.ts` invoke them via the bare path, bypassing the
  // path-rewriting interceptor in `client.ts`.
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createComplianceMetadataRouter());
  app.use("/api", createTdsRatesRouter());

  // Shared router instances reused across the new nested-router mounts below.
  // `createJobsRouter` carries per-tenant orchestrator state (running flag,
  // pendingRerun, SSE subscribers) so a single instance must back every mount.
  const jobsRouter = createJobsRouter(
    dependencies.ingestionService,
    dependencies.emailSimulationService,
    dependencies.fileStore
  );
  const uploadsRouter = createUploadsRouter(dependencies.fileStore);
  // `createAnalyticsRouter` is mounted on the new tenant-scoped tree only;
  // optional realm scoping flows via `?clientOrgId=` query param resolved by
  // `resolveOptionalClientOrgId` (#162), so no realm-scoped mount is needed.
  const analyticsRouter = createAnalyticsRouter();

  // Nested-router scaffold for #171 — REST URL refactor (Stage 2 freeze lift).
  // Routes under `/api/tenants/:tenantId/...` get tenant-id-from-path validation;
  // routes under `/api/tenants/:tenantId/clientOrgs/:clientOrgId/...` additionally
  // get composite-key ownership validation that stamps `req.activeClientOrgId`.
  // Post-#230 (Sub-PR B-2): all legacy `/api/...` realm-scoped mounts dropped;
  // the path-stamping middleware below is the sole source of
  // `req.activeClientOrgId` (no more query/header/session source chain).
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

  // Export domain — realm-scoped routers mount under `clientOrgRouter`.
  clientOrgRouter.use(createExportRouter(dependencies.exportService));
  clientOrgRouter.use(createCsvExportRouter());
  clientOrgRouter.use(createClientExportConfigRouter());

  // Ingestion domain — `jobsRouter` mounts on BOTH the tenant-scoped tree (for
  // ingest orchestration: status/sse/pause/email-simulate) AND the realm-scoped
  // tree (for `/jobs/upload{,/by-keys}` which needs `req.activeClientOrgId`).
  // `uploadsRouter` is tenant-scoped only.
  tenantRouter.use(jobsRouter);
  clientOrgRouter.use(jobsRouter);
  tenantRouter.use(uploadsRouter);

  // Compliance domain — vendors, GL codes, TCS config, realm-scoped compliance
  // config. Unscoped metadata + tds-rates routes stay on the legacy `/api`
  // mount above (FE bypasses the rewriter for those).
  clientOrgRouter.use(createVendorsRouter());
  clientOrgRouter.use(createGlCodesRouter());
  clientOrgRouter.use(createTcsConfigRouter());
  clientOrgRouter.use(createClientComplianceConfigRouter());

  // Invoice domain — realm-scoped routers (`/invoices`, `/invoices/action-required`,
  // `/admin/approval-*`, `/invoices/:id/workflow-*`) mount under `clientOrgRouter`.
  // The triage router mounts under `tenantRouter` (no `/clientOrgs/:clientOrgId`
  // segment) because PENDING_TRIAGE invoices carry `clientOrgId: null` per the
  // documented composite-key exception (#156, #166).
  clientOrgRouter.use(createInvoiceRouter(dependencies.invoiceService, dependencies.approvalWorkflowService, dependencies.fileStore));
  clientOrgRouter.use(createActionRequiredRouter());
  clientOrgRouter.use(createApprovalWorkflowRouter(dependencies.approvalWorkflowService));
  tenantRouter.use(createTriageRouter(dependencies.triageService));

  // Notification config (realm-scoped) — mounts under `clientOrgRouter`.
  clientOrgRouter.use(createNotificationConfigRouter());

  // Analytics domain — tenant-scoped mount of the shared `analyticsRouter`.
  // Optional clientOrgId flows via `?clientOrgId=` query param (see
  // `resolveOptionalClientOrgId`), so no realm-scoped mount.
  tenantRouter.use(analyticsRouter);

  // Tenant domain — administrative + integration routes that operate on the
  // tenant itself (users, mailboxes, client-orgs, mailbox-assignments, gmail
  // connection, notification log). All purely tenant-scoped — no clientOrgId
  // dependency. These routes run DURING tenant onboarding (admin sets things
  // up before setup is marked completed), so they mount on a separate router
  // that omits `requireTenantSetupCompleted`.
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

  // Bank domain — realm-scoped routers (accounts + statements) mount under
  // `clientOrgRouter`. The shared `BankStatementParseProgress` instance is
  // passed into both the realm-scoped router (for upload broadcasts) and the
  // standalone SSE router (for subscribers) so events flow end-to-end.
  // The SSE subscriber endpoint is tenant-scoped and uses EventSource which
  // bypasses the axios interceptor, so it stays on the legacy `/api` mount.
  const bankParseProgress = new BankStatementParseProgress();
  clientOrgRouter.use(createBankAccountsRouter(dependencies.bankService));
  clientOrgRouter.use(createBankStatementsRouter(dependencies.fileStore, dependencies.ocrProvider, dependencies.fieldVerifier, bankParseProgress));
  app.use(
    "/api",
    requireNonPlatformAdmin,
    requireTenantSetupCompleted,
    createBankStatementsParseSseRouter(bankParseProgress)
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
