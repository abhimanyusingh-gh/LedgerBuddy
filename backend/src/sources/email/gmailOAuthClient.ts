import axios from "axios";

interface TokenApiResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  error?: unknown;
  error_description?: unknown;
}

interface UserInfoApiResponse {
  email?: unknown;
}

interface RefreshGoogleAccessTokenInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  tokenEndpoint: string;
  timeoutMs: number;
}

interface RefreshGoogleAccessTokenResult {
  accessToken: string;
  expiresInSeconds: number;
}

interface ExchangeAuthorizationCodeInput {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEndpoint: string;
  timeoutMs: number;
}

interface ExchangeAuthorizationCodeResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

class GoogleOAuthTokenError extends Error {
  constructor(
    message: string,
    readonly errorCode: string
  ) {
    super(message);
    this.name = "GoogleOAuthTokenError";
  }
}

interface OAuthHttpClient {
  post(url: string, body: string, options: { headers: Record<string, string>; timeout: number }): Promise<{ data: unknown }>;
}

export async function refreshGoogleAccessToken(
  input: RefreshGoogleAccessTokenInput,
  httpClient: OAuthHttpClient = axios
): Promise<RefreshGoogleAccessTokenResult> {
  const payload = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: "refresh_token"
  });

  const response = await httpClient.post(input.tokenEndpoint, payload.toString(), {
    timeout: input.timeoutMs,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });

  const body = parseTokenResponse(response?.data);
  const accessToken = body.accessToken;
  if (!accessToken) {
    throw new Error("Google OAuth token response does not contain access_token.");
  }

  return {
    accessToken,
    expiresInSeconds: body.expiresInSeconds
  };
}

export async function exchangeGoogleAuthorizationCode(
  input: ExchangeAuthorizationCodeInput,
  httpClient: OAuthHttpClient = axios
): Promise<ExchangeAuthorizationCodeResult> {
  const payload = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code"
  });

  const response = await httpClient.post(input.tokenEndpoint, payload.toString(), {
    timeout: input.timeoutMs,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    }
  });

  const body = parseTokenResponse(response?.data);
  const accessToken = body.accessToken;
  if (!accessToken) {
    throw new Error("Google OAuth code exchange did not return an access_token.");
  }

  const refreshToken = body.refreshToken;
  if (!refreshToken) {
    throw new Error("Google OAuth code exchange did not return a refresh_token. Re-consent is required.");
  }

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: body.expiresInSeconds
  };
}

export async function fetchGoogleUserEmail(
  accessToken: string,
  userInfoEndpoint: string,
  timeoutMs: number,
  httpClient: { get(url: string, options: { headers: Record<string, string>; timeout: number }): Promise<{ data: unknown }> } = axios
): Promise<string> {
  const response = await httpClient.get(userInfoEndpoint, {
    timeout: timeoutMs,
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const payload = (response?.data ?? {}) as UserInfoApiResponse;
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) {
    throw new Error("Google user info response did not contain a valid email.");
  }

  return email;
}

export function isInvalidGrantError(error: unknown): boolean {
  if (error instanceof GoogleOAuthTokenError) {
    return error.errorCode.toLowerCase() === "invalid_grant";
  }

  if (!axios.isAxiosError(error)) {
    return false;
  }

  const payload = error.response?.data;
  if (!isRecord(payload)) {
    return false;
  }

  const rawCode = payload.error;
  return typeof rawCode === "string" && rawCode.toLowerCase() === "invalid_grant";
}

function parseTokenResponse(rawBody: unknown): {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
} {
  const body = (rawBody ?? {}) as TokenApiResponse;
  const errorCode = typeof body.error === "string" ? body.error.trim() : "";
  if (errorCode) {
    const description =
      typeof body.error_description === "string" && body.error_description.trim().length > 0
        ? body.error_description.trim()
        : "OAuth token endpoint returned an error.";
    throw new GoogleOAuthTokenError(description, errorCode);
  }

  const accessToken = typeof body.access_token === "string" ? body.access_token.trim() : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";
  if (!accessToken) {
    throw new Error("Google OAuth token response does not contain access_token.");
  }

  const expiresInSeconds = normalizePositiveInteger(body.expires_in, 3600);
  return {
    accessToken,
    refreshToken,
    expiresInSeconds
  };
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
