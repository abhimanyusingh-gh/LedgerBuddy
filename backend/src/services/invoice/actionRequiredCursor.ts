export interface ActionRequiredCursor {
  lastSeverity: number;
  lastCreatedAt: string;
  lastInvoiceId: string;
}

export class ActionRequiredCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionRequiredCursorError";
  }
}

export function encodeActionRequiredCursor(cursor: ActionRequiredCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeActionRequiredCursor(raw: string): ActionRequiredCursor {
  let parsed: unknown;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new ActionRequiredCursorError("Invalid cursor encoding.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ActionRequiredCursorError("Invalid cursor shape.");
  }

  const obj = parsed as Record<string, unknown>;
  const lastSeverity = obj.lastSeverity;
  const lastCreatedAt = obj.lastCreatedAt;
  const lastInvoiceId = obj.lastInvoiceId;

  if (typeof lastSeverity !== "number" || !Number.isFinite(lastSeverity)) {
    throw new ActionRequiredCursorError("Invalid cursor: lastSeverity must be a finite number.");
  }
  if (typeof lastCreatedAt !== "string" || Number.isNaN(Date.parse(lastCreatedAt))) {
    throw new ActionRequiredCursorError("Invalid cursor: lastCreatedAt must be an ISO date string.");
  }
  if (typeof lastInvoiceId !== "string" || lastInvoiceId.length === 0) {
    throw new ActionRequiredCursorError("Invalid cursor: lastInvoiceId must be a non-empty string.");
  }

  return { lastSeverity, lastCreatedAt, lastInvoiceId };
}
