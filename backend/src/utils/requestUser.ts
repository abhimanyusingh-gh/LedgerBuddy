import type { Request } from "express";
import { env } from "../config/env.js";

export function resolveRequestUserId(request: Request): string {
  const rawUserId = request.header("x-user-id");
  if (typeof rawUserId === "string" && rawUserId.trim().length > 0) {
    return rawUserId.trim();
  }

  return env.DEFAULT_USER_ID;
}
