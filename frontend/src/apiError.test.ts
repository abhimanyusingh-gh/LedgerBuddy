import { ApiClientError, getUserFacingErrorMessage, isAuthenticationError, normalizeApiError } from "./apiError";

describe("normalizeApiError", () => {
  it("maps login 401 errors to credential message", () => {
    const error = normalizeApiError({
      isAxiosError: true,
      config: { url: "/auth/token" },
      response: {
        status: 401,
        data: {
          message: "Invalid email or password.",
          code: "auth_credentials_invalid"
        }
      }
    });

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.message).toBe("Invalid email or password.");
    expect(error.status).toBe(401);
    expect(isAuthenticationError(error)).toBe(true);
  });

  it("maps protected route 401 errors to session-expired message", () => {
    const error = normalizeApiError({
      isAxiosError: true,
      config: { url: "/api/invoices" },
      response: {
        status: 401,
        data: {
          message: "Authentication required."
        }
      }
    });

    expect(error.message).toBe("Your session has expired. Please sign in again.");
    expect(error.status).toBe(401);
    expect(isAuthenticationError(error)).toBe(true);
  });

  it("maps not-provisioned auth code to functional guidance", () => {
    const error = normalizeApiError({
      isAxiosError: true,
      config: { url: "/auth/token" },
      response: {
        status: 403,
        data: {
          message: "User is not provisioned for this environment.",
          code: "auth_user_not_provisioned"
        }
      }
    });

    expect(error.message).toBe("Your account has not been set up yet. Contact your administrator.");
    expect(error.status).toBe(403);
    expect(error.code).toBe("auth_user_not_provisioned");
  });

  it("maps network failures to connectivity message", () => {
    const error = normalizeApiError({
      isAxiosError: true,
      config: { url: "/api/invoices" },
      message: "Network Error",
      response: undefined
    });

    expect(error.message).toBe("Unable to reach the server. Check your connection and try again.");
  });

  it("preserves existing ApiClientError values", () => {
    const existing = new ApiClientError("Existing message", { status: 500 });
    const normalized = normalizeApiError(existing);

    expect(normalized).toBe(existing);
  });
});

describe("getUserFacingErrorMessage", () => {
  it("falls back when raw request-status message is not user-facing", () => {
    const message = getUserFacingErrorMessage(new Error("Request failed with status code 401"), "Fallback message");
    expect(message).toBe("Fallback message");
  });

  it("returns regular error text for non-generic errors", () => {
    const message = getUserFacingErrorMessage(new Error("Invoice selection is invalid."), "Fallback message");
    expect(message).toBe("Invoice selection is invalid.");
  });
});
