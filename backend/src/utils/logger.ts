/* eslint-disable no-console */

import { AsyncLocalStorage } from "node:async_hooks";

type LogContext = Record<string, unknown>;

interface RequestLogContext {
  correlationId: string;
}

const contextStore = new AsyncLocalStorage<RequestLogContext>();

function write(level: "info" | "warn" | "error", message: string, context?: LogContext) {
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
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
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
    write("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    write("warn", message, context);
  },
  error(message: string, context?: LogContext) {
    write("error", message, context);
  }
};
