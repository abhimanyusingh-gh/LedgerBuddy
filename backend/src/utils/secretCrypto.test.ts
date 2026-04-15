import { decryptSecret, encryptSecret } from "@/utils/secretCrypto.js";

describe("secretCrypto", () => {
  it("encrypts and decrypts secrets", () => {
    const encrypted = encryptSecret("refresh-token-value", "strong-passphrase-1234");
    const decrypted = decryptSecret(encrypted, "strong-passphrase-1234");
    expect(decrypted).toBe("refresh-token-value");
    expect(encrypted).not.toContain("refresh-token-value");
  });

  it("rejects invalid payloads", () => {
    expect(() => decryptSecret("invalid", "strong-passphrase-1234")).toThrow(
      "Encrypted secret payload format is invalid."
    );
  });
});
