import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";

describe("credential encryption (lib/crypto)", () => {
  it("round-trips a secret through encrypt/decrypt", () => {
    const plaintext = "app-password-correct-horse-battery-staple";
    const encoded = encryptSecret(plaintext);
    expect(encoded).not.toBe(plaintext);
    expect(decryptSecret(encoded)).toBe(plaintext);
  });

  it("never persists the plaintext inside the encoded output", () => {
    const plaintext = "super-secret-token-value";
    const encoded = encryptSecret(plaintext);
    expect(encoded).not.toContain(plaintext);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-input");
    expect(decryptSecret(b)).toBe("same-input");
  });

  it("treats empty input as empty, both directions", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("rejects a tampered ciphertext instead of returning garbage", () => {
    const encoded = encryptSecret("do-not-tamper");
    const bytes = Buffer.from(encoded, "base64");
    bytes[bytes.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(() => decryptSecret(bytes.toString("base64"))).toThrow();
  });
});
