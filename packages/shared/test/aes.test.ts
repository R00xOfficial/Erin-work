import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, loadKey } from "../src/index.js";

describe("aes", () => {
  it("round-trips and rejects tampering", () => {
    const key = loadKey(randomBytes(32).toString("base64"));
    const blob = encrypt("refresh-token-123", key);
    expect(decrypt(blob, key)).toBe("refresh-token-123");
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decrypt(tampered, key)).toThrow();
    expect(() => loadKey("short")).toThrow();
  });
});
