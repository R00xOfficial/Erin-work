import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for OAuth tokens at rest. Output layout: version(1) | iv(12) | tag(16) | ciphertext.
 * The key comes from env TOKEN_ENC_KEY (32 bytes, base64) and never touches the database.
 */
const VERSION = 1;

export function loadKey(base64: string | undefined): Buffer {
  if (!base64) throw new Error("TOKEN_ENC_KEY is not set");
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENC_KEY must decode to 32 bytes");
  return key;
}

export function encrypt(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]);
}

export function decrypt(blob: Uint8Array, key: Buffer): string {
  const buf = Buffer.from(blob);
  if (buf.length < 29) throw new Error("Ciphertext too short");
  const version = buf[0];
  if (version !== VERSION) throw new Error(`Unsupported ciphertext version ${version}`);
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const ct = buf.subarray(29);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
