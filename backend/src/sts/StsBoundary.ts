export interface StsAuthorizationUrlInput {
  state: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  loginHint?: string;
}

export interface StsAuthorizationCodeExchangeInput {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface StsAccessTokenValidationInput {
  accessToken: string;
}

export interface StsNormalizedClaims {
  subject: string;
  email: string;
  name: string;
}

export interface StsAuthorizationCodeExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  tokenType: string;
}

export interface StsBoundary {
  getAuthorizationUrl(input: StsAuthorizationUrlInput): string;
  exchangeAuthorizationCode(input: StsAuthorizationCodeExchangeInput): Promise<StsAuthorizationCodeExchangeResult>;
  validateAccessToken(input: StsAccessTokenValidationInput): Promise<Record<string, unknown>>;
  normalizeClaims(rawClaims: Record<string, unknown>): StsNormalizedClaims;
}
