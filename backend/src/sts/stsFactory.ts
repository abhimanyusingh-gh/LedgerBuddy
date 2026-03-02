import { env } from "../config/env.js";
import type { StsBoundary } from "./StsBoundary.js";
import { LocalStsProvider } from "./LocalStsProvider.js";
import { ProdStsProvider } from "./ProdStsProvider.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export function createStsProvider(): StsBoundary {
  if (env.ENV === "local") {
    return new LocalStsProvider({
      clientId: env.STS_CLIENT_ID,
      clientSecret: env.STS_CLIENT_SECRET,
      authUrl: env.STS_AUTH_URL,
      tokenUrl: env.STS_TOKEN_URL,
      validateUrl: env.STS_VALIDATE_URL,
      userInfoUrl: env.STS_USERINFO_URL,
      timeoutMs: DEFAULT_TIMEOUT_MS
    });
  }

  return new ProdStsProvider({
    clientId: env.STS_CLIENT_ID,
    clientSecret: env.STS_CLIENT_SECRET,
    authUrl: env.STS_AUTH_URL,
    tokenUrl: env.STS_TOKEN_URL,
    validateUrl: env.STS_VALIDATE_URL,
    userInfoUrl: env.STS_USERINFO_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS
  });
}
