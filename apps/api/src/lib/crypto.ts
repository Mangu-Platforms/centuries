import crypto from "node:crypto";
import { config } from "../config.js";

// AES-256-GCM encryption for connector credentials at rest (OAuth tokens,
// app passwords). Never store these values in plaintext (BRD NF16).
//
// Encoded format (base64 of the concatenation): 12-byte IV | 16-byte auth
// tag | ciphertext. Self-contained per value, so no separate IV column is
// needed on the Connection model.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEX_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

let cachedDevKey: Buffer | undefined;

function resolveKey(): Buffer {
  if (HEX_KEY_PATTERN.test(config.dataKey)) {
    return Buffer.from(config.dataKey, "hex");
  }
  if (config.isProd) {
    throw new Error(
      "DATA_KEY must be set to a 64-character hex string (32 bytes) in production. " +
        "Generate one with `openssl rand -hex 32`.",
    );
  }
  // Dev/test-only deterministic fallback so the demo flow and test suite
  // never break when DATA_KEY is unset locally. Not used in production —
  // resolveKey() throws above before ever reaching this line when isProd.
  if (!cachedDevKey) {
    cachedDevKey = crypto.createHash("sha256").update("nexus-dev-only-data-key-do-not-use-in-prod").digest();
  }
  return cachedDevKey;
}

/** Encrypts a secret for storage. Returns "" for empty input (nothing to store). */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Decrypts a value produced by encryptSecret(). Returns "" for empty input. */
export function decryptSecret(encoded: string): string {
  if (!encoded) return "";
  const key = resolveKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
