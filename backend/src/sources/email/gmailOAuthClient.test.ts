import {
  refreshGoogleAccessToken,
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserEmail,
  isInvalidGrantError
} from "@/sources/email/gmailOAuthClient.ts";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const TIMEOUT_MS = 5000;

const BASE_REFRESH_INPUT = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
  tokenEndpoint: TOKEN_ENDPOINT,
  timeoutMs: TIMEOUT_MS
};

const BASE_EXCHANGE_INPUT = {
  code: "auth-code-abc",
  codeVerifier: "pkce-verifier-xyz",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "https://app.example.com/callback",
  tokenEndpoint: TOKEN_ENDPOINT,
  timeoutMs: TIMEOUT_MS
};

function createMockHttpClient(responseData: unknown) {
  return {
    post: jest.fn(async () => ({ data: responseData })),
    get: jest.fn(async () => ({ data: responseData }))
  };
}

function createFailingHttpClient(status: number, errorBody: unknown) {
  const error = Object.assign(new Error(`Request failed with status ${status}`), {
    response: { status, data: errorBody },
    isAxiosError: true
  });
  return {
    post: jest.fn(async () => { throw error; }),
    get: jest.fn(async () => { throw error; })
  };
}

describe("refreshGoogleAccessToken", () => {
  it("returns access token and expiry on successful refresh", async () => {
    const client = createMockHttpClient({
      access_token: "fresh-access-token",
      expires_in: 3600
    });

    const result = await refreshGoogleAccessToken(BASE_REFRESH_INPUT, client);

    expect(result.accessToken).toBe("fresh-access-token");
    expect(result.expiresInSeconds).toBe(3600);
    expect(client.post).toHaveBeenCalledWith(
      TOKEN_ENDPOINT,
      expect.stringContaining("grant_type=refresh_token"),
      expect.objectContaining({ timeout: TIMEOUT_MS })
    );
  });

  it("sends client_id, client_secret, refresh_token in form body", async () => {
    const client = createMockHttpClient({ access_token: "tok", expires_in: 1800 });

    await refreshGoogleAccessToken(BASE_REFRESH_INPUT, client);

    const body = String((client.post.mock.calls as unknown[][])[0][1]);
    expect(body).toContain("client_id=test-client-id");
    expect(body).toContain("client_secret=test-client-secret");
    expect(body).toContain("refresh_token=test-refresh-token");
  });

  it("defaults expires_in to 3600 when missing from response", async () => {
    const client = createMockHttpClient({ access_token: "tok" });

    const result = await refreshGoogleAccessToken(BASE_REFRESH_INPUT, client);

    expect(result.expiresInSeconds).toBe(3600);
  });

  it("parses string expires_in value", async () => {
    const client = createMockHttpClient({ access_token: "tok", expires_in: "7200" });

    const result = await refreshGoogleAccessToken(BASE_REFRESH_INPUT, client);

    expect(result.expiresInSeconds).toBe(7200);
  });

  it("throws when response has error field (invalid_grant)", async () => {
    const client = createMockHttpClient({
      error: "invalid_grant",
      error_description: "Token has been revoked."
    });

    await expect(refreshGoogleAccessToken(BASE_REFRESH_INPUT, client)).rejects.toThrow("Token has been revoked.");
  });

  it("throws when access_token is missing from response", async () => {
    const client = createMockHttpClient({ expires_in: 3600 });

    await expect(refreshGoogleAccessToken(BASE_REFRESH_INPUT, client)).rejects.toThrow("access_token");
  });

  it("throws when response body is null", async () => {
    const client = createMockHttpClient(null);

    await expect(refreshGoogleAccessToken(BASE_REFRESH_INPUT, client)).rejects.toThrow("access_token");
  });

  it("propagates HTTP errors from the client", async () => {
    const client = createFailingHttpClient(500, { error: "server_error" });

    await expect(refreshGoogleAccessToken(BASE_REFRESH_INPUT, client)).rejects.toThrow();
  });
});

describe("exchangeGoogleAuthorizationCode", () => {
  it("returns access token, refresh token, and expiry on success", async () => {
    const client = createMockHttpClient({
      access_token: "new-access-token",
      refresh_token: "new-refresh-token",
      expires_in: 3600
    });

    const result = await exchangeGoogleAuthorizationCode(BASE_EXCHANGE_INPUT, client);

    expect(result.accessToken).toBe("new-access-token");
    expect(result.refreshToken).toBe("new-refresh-token");
    expect(result.expiresInSeconds).toBe(3600);
  });

  it("sends code, code_verifier, redirect_uri in form body", async () => {
    const client = createMockHttpClient({
      access_token: "tok",
      refresh_token: "ref",
      expires_in: 3600
    });

    await exchangeGoogleAuthorizationCode(BASE_EXCHANGE_INPUT, client);

    const body = String((client.post.mock.calls as unknown[][])[0][1]);
    expect(body).toContain("code=auth-code-abc");
    expect(body).toContain("code_verifier=pkce-verifier-xyz");
    expect(body).toContain("redirect_uri=" + encodeURIComponent("https://app.example.com/callback"));
    expect(body).toContain("grant_type=authorization_code");
  });

  it("throws when refresh_token is missing (consent not granted)", async () => {
    const client = createMockHttpClient({
      access_token: "tok",
      expires_in: 3600
    });

    await expect(exchangeGoogleAuthorizationCode(BASE_EXCHANGE_INPUT, client)).rejects.toThrow("refresh_token");
  });

  it("throws when access_token is missing", async () => {
    const client = createMockHttpClient({ refresh_token: "ref" });

    await expect(exchangeGoogleAuthorizationCode(BASE_EXCHANGE_INPUT, client)).rejects.toThrow("access_token");
  });

  it("throws on OAuth error response", async () => {
    const client = createMockHttpClient({
      error: "invalid_request",
      error_description: "Missing required parameter."
    });

    await expect(exchangeGoogleAuthorizationCode(BASE_EXCHANGE_INPUT, client)).rejects.toThrow("Missing required parameter.");
  });
});

describe("fetchGoogleUserEmail", () => {
  it("returns lowercase trimmed email from userinfo response", async () => {
    const client = createMockHttpClient({ email: "  User@Example.COM  " });

    const email = await fetchGoogleUserEmail("access-tok", USERINFO_ENDPOINT, TIMEOUT_MS, client);

    expect(email).toBe("user@example.com");
  });

  it("sends Bearer token in Authorization header", async () => {
    const client = createMockHttpClient({ email: "user@test.com" });

    await fetchGoogleUserEmail("my-token-123", USERINFO_ENDPOINT, TIMEOUT_MS, client);

    expect(client.get).toHaveBeenCalledWith(
      USERINFO_ENDPOINT,
      expect.objectContaining({
        headers: { Authorization: "Bearer my-token-123" }
      })
    );
  });

  it("throws when email is missing from response", async () => {
    const client = createMockHttpClient({});

    await expect(fetchGoogleUserEmail("tok", USERINFO_ENDPOINT, TIMEOUT_MS, client)).rejects.toThrow("email");
  });

  it("throws when email is empty string", async () => {
    const client = createMockHttpClient({ email: "   " });

    await expect(fetchGoogleUserEmail("tok", USERINFO_ENDPOINT, TIMEOUT_MS, client)).rejects.toThrow("email");
  });

  it("throws when email is non-string type", async () => {
    const client = createMockHttpClient({ email: 12345 });

    await expect(fetchGoogleUserEmail("tok", USERINFO_ENDPOINT, TIMEOUT_MS, client)).rejects.toThrow("email");
  });
});

describe("isInvalidGrantError", () => {
  it("detects invalid_grant from axios error response", () => {
    const error = Object.assign(new Error("fail"), {
      isAxiosError: true,
      response: { status: 400, data: { error: "invalid_grant" } }
    });
    Object.defineProperty(error, "isAxiosError", { value: true, enumerable: true });

    expect(isInvalidGrantError(error)).toBe(true);
  });

  it("returns false for other error codes", () => {
    const error = Object.assign(new Error("fail"), {
      isAxiosError: true,
      response: { status: 400, data: { error: "invalid_request" } }
    });
    Object.defineProperty(error, "isAxiosError", { value: true, enumerable: true });

    expect(isInvalidGrantError(error)).toBe(false);
  });

  it("returns false for non-axios errors", () => {
    expect(isInvalidGrantError(new Error("random error"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isInvalidGrantError(null)).toBe(false);
    expect(isInvalidGrantError(undefined)).toBe(false);
  });

  it("case-insensitive match on invalid_grant", () => {
    const error = Object.assign(new Error("fail"), {
      isAxiosError: true,
      response: { status: 400, data: { error: "INVALID_GRANT" } }
    });
    Object.defineProperty(error, "isAxiosError", { value: true, enumerable: true });

    expect(isInvalidGrantError(error)).toBe(true);
  });
});
