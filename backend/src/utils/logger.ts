/* eslint-disable no-console */

import { AsyncLocalStorage } from "node:async_hooks";
import { LOG_LEVEL, type LogLevel } from "@/types/logging.js";

type LogContext = Record<string, unknown>;

interface RequestLogContext {
  correlationId: string;
}

const contextStore = new AsyncLocalStorage<RequestLogContext>();

function write(level: LogLevel, message: string, context?: LogContext) {
  if (process.env.NODE_ENV === "test" && process.env.LOG_IN_TESTS !== "true") {
    return;
  }

  const requestContext = contextStore.getStore();
  const payload: Record<string, unknown> = {
    time: new Date().toISOString(),
    level,
    service: "backend",
    message,
    correlationId: requestContext?.correlationId ?? null
  };

  if (context && Object.keys(context).length > 0) {
    payload.context = context;
  }

  const line = JSON.stringify(payload);
  if (level === LOG_LEVEL.ERROR) {
    console.error(line);
    return;
  }
  if (level === LOG_LEVEL.WARN) {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function runWithLogContext<T>(correlationId: string, callback: () => T): T {
  return contextStore.run({ correlationId }, callback);
}

export function getCorrelationId(): string | undefined {
  return contextStore.getStore()?.correlationId;
}

export const logger = {
  info(message: string, context?: LogContext) {
    write(LOG_LEVEL.INFO, message, context);
  },
  warn(message: string, context?: LogContext) {
    write(LOG_LEVEL.WARN, message, context);
  },
  error(message: string, context?: LogContext) {
    write(LOG_LEVEL.ERROR, message, context);
  }
};
