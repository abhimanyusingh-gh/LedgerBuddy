import {
  createSign,
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

export function jwsSign(payload: string, privateKeyPem: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(payload).toString("base64url");
  const signing = `${header}.${body}`;
  const sign = createSign("SHA256");
  sign.update(signing);
  sign.end();
  const signature = sign.sign(privateKeyPem, "base64url");
  return `${signing}.${signature}`;
}

export function aesEncrypt(plaintext: string, aesKeyHex: string): { encrypted: string; iv: string } {
  const key = Buffer.from(aesKeyHex, "hex");
  const ivBytes = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, ivBytes);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    encrypted: encrypted.toString("base64url"),
    iv: ivBytes.toString("base64url")
  };
}

export function aesDecrypt(encryptedBase64url: string, ivBase64url: string, aesKeyHex: string): string {
  const key = Buffer.from(aesKeyHex, "hex");
  const ivBytes = Buffer.from(ivBase64url, "base64url");
  const encryptedBytes = Buffer.from(encryptedBase64url, "base64url");
  const decipher = createDecipheriv("aes-256-cbc", key, ivBytes);
  const decrypted = Buffer.concat([decipher.update(encryptedBytes), decipher.final()]);
  return decrypted.toString("utf8");
}
