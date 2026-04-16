import axios, { type AxiosInstance } from "axios";
import type {
  OidcAccessTokenValidationInput,
  OidcAuthorizationCodeExchangeInput,
  OidcAuthorizationCodeExchangeResult,
  OidcAuthorizationUrlInput,
  OidcNormalizedClaims,
  OidcPasswordGrantResult,
  OidcProvider
} from "@/sts/OidcProvider.js";

interface HttpOidcProviderConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  validateUrl: string;
  userInfoUrl: string;
  timeoutMs: number;
}

interface TokenResponsePayload {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
}

export class HttpOidcProvider implements OidcProvider {
  private readonly http: AxiosInstance;

  constructor(private readonly config: HttpOidcProviderConfig) {
    this.http = axios.create({
      timeout: config.timeoutMs,
      validateStatus: () => true
    });
  }

  getAuthorizationUrl(input: OidcAuthorizationUrlInput): string {
    const query = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: input.redirectUri,
      state: input.state,
      scope: input.scopes.join(" ")
    });

    if (input.codeChallenge && input.codeChallenge.length > 0) {
      query.set("code_challenge", input.codeChallenge);
      query.set("code_challenge_method", "S256");
    }
    if (input.loginHint && input.loginHint.length > 0) {
      query.set("login_hint", input.loginHint);
    }

    return `${this.config.authUrl}?${query.toString()}`;
  }

  async exchangeAuthorizationCode(
    input: OidcAuthorizationCodeExchangeInput
  ): Promise<OidcAuthorizationCodeExchangeResult> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret
    });
    if (input.codeVerifier && input.codeVerifier.length > 0) {
      body.set("code_verifier", input.codeVerifier);
    }

    const response = await this.http.post(this.config.tokenUrl, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OIDC authorization-code exchange failed with HTTP ${response.status}.`);
    }

    const payload = response.data as TokenResponsePayload;
    const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
    const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";
    const tokenType = typeof payload.token_type === "string" ? payload.token_type.trim() : "Bearer";
    const expiresInSeconds = Number(payload.expires_in ?? 0);

    if (!accessToken || !refreshToken || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error("OIDC provider returned incomplete token payload.");
    }

    return {
      accessToken,
      refreshToken,
      tokenType,
      expiresInSeconds
    };
  }

  async validateAccessToken(input: OidcAccessTokenValidationInput): Promise<Record<string, unknown>> {
    const body = new URLSearchParams({
      token: input.accessToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret
    });
    const response = await this.http.post(this.config.validateUrl, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OIDC token validation failed with HTTP ${response.status}.`);
    }

    const payload = asRecord(response.data);
    const active = payload.active;
    if (active !== true) {
      throw new Error("OIDC token validation returned inactive token.");
    }

    return payload;
  }

  normalizeClaims(rawClaims: Record<string, unknown>): OidcNormalizedClaims {
    const subject = normalizeFirstString(rawClaims.sub, rawClaims.user_id, rawClaims.subject, rawClaims.preferred_username);
    const email = normalizeFirstString(rawClaims.email, rawClaims.preferred_username);
    const name = normalizeFirstString(rawClaims.name, rawClaims.given_name, email);

    if (!subject || !email || !name) {
      throw new Error("OIDC claims payload is missing required identity fields.");
    }

    return {
      subject,
      email,
      name
    };
  }

  async exchangePasswordGrant(username: string, password: string): Promise<OidcPasswordGrantResult> {
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username,
      password,
      scope: "openid"
    });

    const response = await this.http.post(this.config.tokenUrl, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    if (response.status === 401 || response.status === 400) {
      return { accessToken: "", refreshToken: "", ok: false };
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OIDC password grant failed with HTTP ${response.status}.`);
    }

    const payload = response.data as TokenResponsePayload;
    const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
    if (!accessToken) {
      return { accessToken: "", refreshToken: "", ok: false };
    }
    const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";

    return { accessToken, refreshToken, ok: true };
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret
    });

    const response = await this.http.post(this.config.tokenUrl, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OIDC refresh token exchange failed with HTTP ${response.status}.`);
    }

    const payload = response.data as TokenResponsePayload;
    const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
    const newRefreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token.trim() : "";

    if (!accessToken || !newRefreshToken) {
      throw new Error("OIDC provider returned incomplete token payload on refresh.");
    }

    return { accessToken, refreshToken: newRefreshToken };
  }

}

function normalizeFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("OIDC response payload must be an object.");
}
