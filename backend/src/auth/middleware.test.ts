import type { Request, Response } from "express";
import { createAuthenticationMiddleware, resolveBearerToken } from "./middleware.js";

describe("auth middleware", () => {
  it("prefers authToken query when authorization header token is invalid", () => {
    const request = {
      header: (name: string) => (name.toLowerCase() === "authorization" ? "Bearer undefined" : undefined),
      query: { authToken: "query-token-1" }
    } as unknown as Request;

    expect(resolveBearerToken(request)).toBe("query-token-1");
  });

  it("uses query token when authorization header is missing", () => {
    const request = {
      header: () => undefined,
      query: { authToken: "query-token-2" }
    } as unknown as Request;

    expect(resolveBearerToken(request)).toBe("query-token-2");
  });

  it("authenticates request using query token", async () => {
    const authService = {
      resolveRequestContext: jest.fn().mockResolvedValue({
        userId: "u1",
        email: "u@example.com",
        tenantId: "t1",
        tenantName: "Tenant",
        onboardingStatus: "completed",
        role: "TENANT_ADMIN",
        isPlatformAdmin: false
      })
    };
    const middleware = createAuthenticationMiddleware(authService as never);

    const request = {
      header: () => undefined,
      query: { authToken: "image-token" }
    } as unknown as Request;

    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    } as unknown as Response;
    const next = jest.fn();

    await middleware(request, response, next);

    expect(authService.resolveRequestContext).toHaveBeenCalledWith("image-token");
    expect(next).toHaveBeenCalledTimes(1);
    expect((request as { authContext?: unknown }).authContext).toBeTruthy();
  });
});
