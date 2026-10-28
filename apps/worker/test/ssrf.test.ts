import { describe, expect, it } from "vitest";
import { BlockedUrlError, assertPublicUrl, isBlockedIp } from "../src/lib/ssrf.js";

describe("SSRF guard", () => {
  it("blocks private, loopback, link-local and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254"]) expect(isBlockedIp(ip), ip).toBe(true);
  });
  it("allows ordinary public addresses", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"]) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it("rejects non-http schemes, credentials and internal names without any lookup", async () => {
    for (const u of ["file:///etc/passwd", "ftp://example.com/", "gopher://x", "http://user:pw@example.com/", "http://localhost/", "http://foo.internal/", "http://metadata.google.internal/computeMetadata/v1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]:8080/", "http://127.0.0.1:3000/admin", "not a url"])
      await expect(assertPublicUrl(u), u).rejects.toBeInstanceOf(BlockedUrlError);
  });
});
