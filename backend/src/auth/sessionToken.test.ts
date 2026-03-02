import { createHmac } from "node:crypto";
import { createSessionToken, verifySessionToken } from "./sessionToken.js";

describe("sessionToken", () => {
  const secret = "test-secret";

  it("encodes and decodes role and platform claims", () => {
    const token = createSessionToken({
      userId: "user-1",
      email: "user@example.com",
      tenantId: "tenant-1",
      role: "TENANT_ADMIN",
      isPlatformAdmin: true,
      ttlSeconds: 600,
      secret
    });

    const verified = verifySessionToken(token, secret);
    expect(verified).toEqual({
      userId: "user-1",
      email: "user@example.com",
      tenantId: "tenant-1",
      role: "TENANT_ADMIN",
      isPlatformAdmin: true
    });
  });

  it("rejects token payload without valid role", () => {
    const token = createSessionToken({
      userId: "user-1",
      email: "user@example.com",
      tenantId: "tenant-1",
      role: "MEMBER",
      isPlatformAdmin: false,
      ttlSeconds: 600,
      secret
    });

    const [header, payload] = token.split(".");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    parsed.role = "UNKNOWN";
    const tamperedPayload = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
    const signature = createHmac("sha256", secret).update(`${header}.${tamperedPayload}`).digest("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    expect(() => verifySessionToken(tampered, secret)).toThrow(/payload is incomplete/i);
  });
});
