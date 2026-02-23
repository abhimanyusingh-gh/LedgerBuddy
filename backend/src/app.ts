import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { healthRouter } from "./routes/health.js";
import { buildDependencies } from "./core/dependencies.js";
import { createInvoiceRouter } from "./routes/invoices.js";
import { createExportRouter } from "./routes/export.js";
import { createJobsRouter } from "./routes/jobs.js";
import { logger, runWithLogContext } from "./utils/logger.js";

export async function createApp() {
  const dependencies = await buildDependencies();
  const app = express();

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
  app.use("/api", createInvoiceRouter(dependencies.invoiceService));
  app.use("/api", createJobsRouter(dependencies.ingestionService));
  app.use("/api", createExportRouter(dependencies.exportService));

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unknown server error";
    logger.error("request.error", { message });
    res.status(500).json({ message });
  });

  return app;
}
