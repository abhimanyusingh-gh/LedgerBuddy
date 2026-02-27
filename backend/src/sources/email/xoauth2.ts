export function buildXoauth2AuthorizationHeader(username: string, accessToken: string): string {
  const payload = `user=${username}\u0001auth=Bearer ${accessToken}\u0001\u0001`;
  const encoded = Buffer.from(payload, "utf8").toString("base64");
  return `XOAUTH2 ${encoded}`;
}
