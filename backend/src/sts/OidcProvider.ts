export interface OidcAuthorizationUrlInput {
  state: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  loginHint?: string;
}

export interface OidcAuthorizationCodeExchangeInput {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface OidcAccessTokenValidationInput {
  accessToken: string;
}

export interface OidcNormalizedClaims {
  subject: string;
  email: string;
  name: string;
}

export interface OidcAuthorizationCodeExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  tokenType: string;
}

export interface OidcPasswordGrantResult {
  accessToken: string;
  refreshToken: string;
  ok: boolean;
}

export interface OidcProvider {
  getAuthorizationUrl(input: OidcAuthorizationUrlInput): string;
  exchangeAuthorizationCode(input: OidcAuthorizationCodeExchangeInput): Promise<OidcAuthorizationCodeExchangeResult>;
  validateAccessToken(input: OidcAccessTokenValidationInput): Promise<Record<string, unknown>>;
  normalizeClaims(rawClaims: Record<string, unknown>): OidcNormalizedClaims;
  exchangePasswordGrant(username: string, password: string): Promise<OidcPasswordGrantResult>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>;
}
