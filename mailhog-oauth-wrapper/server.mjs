import axios from "axios";
import express from "express";
import nodemailer from "nodemailer";

const port = Number(process.env.PORT ?? 8026);
const mailhogBaseUrl = trimTrailingSlash(process.env.MAILHOG_BASE_URL ?? "http://mailhog:8025");
const mailhogSmtpHost = process.env.MAILHOG_SMTP_HOST ?? "mailhog";
const mailhogSmtpPort = Number(process.env.MAILHOG_SMTP_PORT ?? 1025);
const oauthClientId = process.env.OAUTH_CLIENT_ID ?? "mailhog-client";
const oauthClientSecret = process.env.OAUTH_CLIENT_SECRET ?? "mailhog-secret";
const oauthRefreshToken = process.env.OAUTH_REFRESH_TOKEN ?? "mailhog-refresh";
const oauthAccessToken = process.env.OAUTH_ACCESS_TOKEN ?? "mailhog-access-token";
const xoauth2Username = process.env.OAUTH_XOAUTH2_USERNAME ?? "ap@example.com";
const tokenExpiresIn = Number(process.env.OAUTH_TOKEN_EXPIRES_IN ?? 3600);

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: false }));

const smtpTransport = nodemailer.createTransport({
  host: mailhogSmtpHost,
  port: mailhogSmtpPort,
  secure: false,
  ignoreTLS: true
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/oauth/token", (req, res) => {
  const params = {
    grantType: String(req.body?.grant_type ?? "").trim(),
    refreshToken: String(req.body?.refresh_token ?? "").trim(),
    clientId: String(req.body?.client_id ?? "").trim(),
    clientSecret: String(req.body?.client_secret ?? "").trim()
  };

  if (params.grantType !== "refresh_token") {
    res.status(400).json({ error: "unsupported_grant_type" });
    return;
  }

  if (
    params.clientId !== oauthClientId ||
    params.clientSecret !== oauthClientSecret ||
    params.refreshToken !== oauthRefreshToken
  ) {
    res.status(401).json({ error: "invalid_client" });
    return;
  }

  res.json({
    access_token: oauthAccessToken,
    token_type: "Bearer",
    expires_in: tokenExpiresIn
  });
});

app.get("/messages", async (req, res) => {
  if (!isXoauth2Authorized(req.headers.authorization)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const after = typeof req.query.after === "string" ? req.query.after : "";

  try {
    const response = await axios.get(`${mailhogBaseUrl}/api/v1/messages`, {
      timeout: 15_000
    });
    const rawMessages = Array.isArray(response.data) ? response.data : [];
    const items = rawMessages
      .map((message) => toWrapperMessage(message))
      .filter((message) => message.checkpoint > after)
      .sort((left, right) => left.checkpoint.localeCompare(right.checkpoint));

    res.json({ items });
  } catch (error) {
    res.status(502).json({
      error: "mailhog_unavailable",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/seed", async (req, res) => {
  if (!isXoauth2Authorized(req.headers.authorization)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const from = String(req.body?.from ?? "").trim();
  const to = String(req.body?.to ?? "").trim();
  const subject = String(req.body?.subject ?? "").trim();
  const text = String(req.body?.text ?? "invoice attachment");
  const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];

  if (!from || !to || !subject || attachments.length === 0) {
    res.status(400).json({ error: "invalid_seed_payload" });
    return;
  }

  try {
    await smtpTransport.sendMail({
      from,
      to,
      subject,
      text,
      attachments: attachments
        .map((attachment) => normalizeAttachment(attachment))
        .filter((attachment) => attachment !== null)
    });
    res.status(202).json({ accepted: true });
  } catch (error) {
    res.status(502).json({
      error: "seed_failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`mailhog-oauth-wrapper listening on :${port}`);
});

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function isXoauth2Authorized(authorizationHeader) {
  const parsed = parseXoauth2Authorization(authorizationHeader);
  if (!parsed) {
    return false;
  }
  if (xoauth2Username.trim().length > 0 && parsed.user !== xoauth2Username) {
    return false;
  }
  return parsed.accessToken === oauthAccessToken;
}

function parseXoauth2Authorization(authorizationHeader) {
  if (typeof authorizationHeader !== "string") {
    return null;
  }

  const [scheme, payload] = authorizationHeader.split(" ");
  if (scheme?.toUpperCase() !== "XOAUTH2" || !payload) {
    return null;
  }

  let decoded = "";
  try {
    decoded = Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return null;
  }

  const parts = decoded.split("\u0001");
  const userPart = parts.find((entry) => entry.startsWith("user="));
  const authPart = parts.find((entry) => entry.startsWith("auth=Bearer "));
  if (!userPart || !authPart) {
    return null;
  }

  const user = userPart.slice("user=".length).trim();
  const accessToken = authPart.slice("auth=Bearer ".length).trim();
  if (!user || !accessToken) {
    return null;
  }

  return { user, accessToken };
}

function normalizeAttachment(value) {
  const filename = String(value?.filename ?? "").trim();
  const contentBase64 = String(value?.contentBase64 ?? "").trim();
  if (!filename || !contentBase64) {
    return null;
  }
  const contentType = String(value?.contentType ?? "application/octet-stream").trim();
  return {
    filename,
    contentType,
    content: Buffer.from(contentBase64, "base64")
  };
}

function toWrapperMessage(message) {
  const id = String(message?.ID ?? "");
  const created = String(message?.Created ?? "");
  const rawData = String(message?.Raw?.Data ?? "");
  return {
    id,
    checkpoint: `${normalizeIsoTimestamp(created)}#${id}`,
    receivedAt: created,
    rawData: Buffer.from(rawData, "utf8").toString("base64")
  };
}

function normalizeIsoTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(0).toISOString();
  }
  return parsed.toISOString();
}
