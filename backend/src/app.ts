import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { healthRouter } from "./routes/health.js";
import { buildDependencies } from "./core/dependencies.js";
import { createInvoiceRouter } from "./routes/invoices.js";
import { createExportRouter } from "./routes/export.js";
import { createJobsRouter } from "./routes/jobs.js";
import { createGmailConnectionRouter } from "./routes/gmailConnection.js";
import { createAuthRouter } from "./routes/auth.js";
import { createSessionRouter } from "./routes/session.js";
import { createTenantAdminRouter } from "./routes/tenantAdmin.js";
import { createTenantLifecycleRouter } from "./routes/tenantLifecycle.js";
import { createPlatformAdminRouter } from "./routes/platformAdmin.js";
import {
  createAuthenticationMiddleware,
  requireNonPlatformAdmin,
  requireTenantSetupCompleted
} from "./auth/middleware.js";
import { logger, runWithLogContext } from "./utils/logger.js";
import { isHttpError } from "./errors/HttpError.js";

export async function createApp() {
  const dependencies = await buildDependencies();
  const app = express();
  const authenticate = createAuthenticationMiddleware(dependencies.authService);

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
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
  app.use("/", createAuthRouter(dependencies.authService));
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
  app.use("/", createGmailConnectionRouter(dependencies.gmailIntegrationService, dependencies.authService));
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createInvoiceRouter(dependencies.invoiceService));
  app.use(
    "/api",
    requireNonPlatformAdmin,
    requireTenantSetupCompleted,
    createJobsRouter(dependencies.ingestionService, dependencies.emailSimulationService)
  );
  app.use("/api", requireNonPlatformAdmin, requireTenantSetupCompleted, createExportRouter(dependencies.exportService));

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
