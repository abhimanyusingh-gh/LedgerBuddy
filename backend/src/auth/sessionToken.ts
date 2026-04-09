import { createHmac, timingSafeEqual } from "node:crypto";
import { TenantRoles, type TenantRole } from "../models/TenantUserRole.js";

interface SessionTokenPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: TenantRole;
  isPlatformAdmin: boolean;
  iat: number;
  exp: number;
}

interface CreateSessionTokenInput {
  userId: string;
  email: string;
  tenantId: string;
  role: TenantRole;
  isPlatformAdmin: boolean;
  ttlSeconds: number;
  secret: string;
}

interface VerifiedSessionToken {
  userId: string;
  email: string;
  tenantId: string;
  role: TenantRole;
  isPlatformAdmin: boolean;
}

export function createSessionToken(input: CreateSessionTokenInput): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: SessionTokenPayload = {
    sub: input.userId,
    email: input.email,
    tenantId: input.tenantId,
    role: input.role,
    isPlatformAdmin: input.isPlatformAdmin,
    iat: nowSeconds,
    exp: nowSeconds + input.ttlSeconds
  };

  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(signingInput, input.secret);
  return `${signingInput}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): VerifiedSessionToken {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Session token format is invalid.");
  }

  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, secret);
  const actual = Buffer.from(encodedSignature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Session token signature is invalid.");
  }

  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(fromBase64Url(encodedHeader)) as { alg?: unknown; typ?: unknown };
  } catch {
    throw new Error("Session token header is invalid JSON.");
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new Error("Session token header is invalid.");
  }

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload)) as SessionTokenPayload;
  } catch {
    throw new Error("Session token payload is invalid JSON.");
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Session token payload is invalid.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) {
    throw new Error("Session token has expired.");
  }

  const userId = normalizeString(payload.sub);
  const email = normalizeString(payload.email);
  const tenantId = normalizeString(payload.tenantId);
  const role = normalizeRole(payload.role);
  if (!userId || !email || !tenantId || !role) {
    throw new Error("Session token payload is incomplete.");
  }
  const isPlatformAdmin = payload.isPlatformAdmin === true;

  return {
    userId,
    email,
    tenantId,
    role,
    isPlatformAdmin
  };
}

function sign(payloadPart: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function normalizeString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed;
}

function normalizeRole(value: unknown): TenantRole | null {
  if (typeof value !== "string") {
    return null;
  }
  return (TenantRoles as readonly string[]).includes(value) ? (value as TenantRole) : null;
}
