import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@/types/auth.js";
import { requireAuth } from "@/auth/requireAuth.js";
import {
  ACTION_REQUIRED_DEFAULT_LIMIT,
  ACTION_REQUIRED_MAX_LIMIT,
  fetchActionRequired
} from "@/services/invoice/actionRequired.js";
import {
  ActionRequiredCursorError,
  decodeActionRequiredCursor,
  encodeActionRequiredCursor
} from "@/services/invoice/actionRequiredCursor.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function wrap(fn: AsyncHandler): AsyncHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function parseLimit(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return ACTION_REQUIRED_DEFAULT_LIMIT;
  const rounded = Math.floor(parsed);
  if (rounded <= 0) return ACTION_REQUIRED_DEFAULT_LIMIT;
  return Math.min(rounded, ACTION_REQUIRED_MAX_LIMIT);
}

export function createActionRequiredRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/invoices/action-required", wrap(async (req, res) => {
    const { tenantId } = getAuth(req);

    const limit = req.query.limit !== undefined
      ? parseLimit(req.query.limit)
      : ACTION_REQUIRED_DEFAULT_LIMIT;

    const rawCursor = typeof req.query.cursor === "string" ? req.query.cursor.trim() : "";
    let cursor = null;
    if (rawCursor.length > 0) {
      try {
        cursor = decodeActionRequiredCursor(rawCursor);
      } catch (error) {
        if (error instanceof ActionRequiredCursorError) {
          res.status(400).json({ message: error.message });
          return;
        }
        throw error;
      }
    }

    const result = await fetchActionRequired({ tenantId, limit, cursor });

    res.json({
      items: result.items,
      nextCursor: result.nextCursor ? encodeActionRequiredCursor(result.nextCursor) : null,
      totalByReason: result.totalByReason,
      total: result.total
    });
  }));

  return router;
}
