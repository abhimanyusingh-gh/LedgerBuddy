import { randomBytes } from "node:crypto";
import express from "express";

const port = Number(process.env.PORT ?? 8090);
const issuer = process.env.ISSUER ?? `http://local-sts:${port}`;
const clientId = process.env.CLIENT_ID ?? "invoice-processor-local-client";
const clientSecret = process.env.CLIENT_SECRET ?? "invoice-processor-local-secret";
const defaultUserEmail = process.env.DEFAULT_USER_EMAIL ?? "admin@local.test";
const defaultUserName = process.env.DEFAULT_USER_NAME ?? "Local Admin";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const authCodes = new Map();
const refreshTokens = new Map();
const accessTokens = new Map();

app.get("/health", (_req, res) => {
  res.json({ status: "ok", issuer });
});

app.get("/oauth2/authorize", (req, res) => {
  const responseType = String(req.query.response_type ?? "").trim();
  const redirectUri = String(req.query.redirect_uri ?? "").trim();
  const state = String(req.query.state ?? "").trim();
  const requestedClientId = String(req.query.client_id ?? "").trim();
  const loginHint = String(req.query.login_hint ?? "").trim();

  if (responseType !== "code" || !redirectUri || !state || requestedClientId !== clientId) {
    res.status(400).json({ error: "invalid_authorize_request" });
    return;
  }

  const email = normalizeEmail(loginHint) || defaultUserEmail;
  const code = randomToken();
  const subject = `local-${email}`;
  authCodes.set(code, {
    subject,
    email,
    name: defaultUserName,
    clientId: requestedClientId,
    redirectUri,
    createdAtMs: Date.now()
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", state);
  res.redirect(302, redirect.toString());
});

app.post("/oauth2/token", (req, res) => {
  const grantType = String(req.body?.grant_type ?? "").trim();
  const requestedClientId = String(req.body?.client_id ?? "").trim();
  const requestedClientSecret = String(req.body?.client_secret ?? "").trim();

  if (requestedClientId !== clientId || requestedClientSecret !== clientSecret) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }

  if (grantType === "authorization_code") {
    const code = String(req.body?.code ?? "").trim();
    const redirectUri = String(req.body?.redirect_uri ?? "").trim();
    const record = authCodes.get(code);
    if (!record || record.redirectUri !== redirectUri || record.clientId !== requestedClientId) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    authCodes.delete(code);
    const tokenPayload = issueTokens(record);
    res.json(tokenPayload);
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(req.body?.refresh_token ?? "").trim();
    const record = refreshTokens.get(refreshToken);
    if (!record) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    const accessToken = randomToken();
    accessTokens.set(accessToken, {
      ...record,
      active: true,
      expiresAtMs: Date.now() + 3600 * 1000
    });

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600
    });
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

app.post("/oauth2/introspect", (req, res) => {
  const token = String(req.body?.token ?? "").trim();
  const record = accessTokens.get(token);
  if (!record || record.expiresAtMs <= Date.now()) {
    res.json({ active: false });
    return;
  }

  res.json({
    active: true,
    iss: issuer,
    sub: record.subject,
    email: record.email,
    name: record.name
  });
});

app.get("/oauth2/userinfo", (req, res) => {
  const authorization = String(req.headers.authorization ?? "");
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const record = accessTokens.get(token);
  if (!record || record.expiresAtMs <= Date.now()) {
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  res.json({
    sub: record.subject,
    email: record.email,
    name: record.name
  });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`local-sts listening on :${port}`);
});

function issueTokens(identity) {
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const accessRecord = {
    ...identity,
    active: true,
    expiresAtMs: Date.now() + 3600 * 1000
  };
  const refreshRecord = {
    subject: identity.subject,
    email: identity.email,
    name: identity.name
  };
  accessTokens.set(accessToken, accessRecord);
  refreshTokens.set(refreshToken, refreshRecord);
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: 3600
  };
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function normalizeEmail(value) {
  const normalized = value.trim().toLowerCase();
  return normalized.includes("@") ? normalized : "";
}
