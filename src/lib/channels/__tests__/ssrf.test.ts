import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("dns/promises", () => ({ lookup: lookupMock }));

import { assertSafeFeedUrl, BlockedUrlError } from "@/lib/channels/ssrf";

describe("assertSafeFeedUrl (guard SSRF)", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "34.120.10.10", family: 4 }]);
  });

  it("rechaza esquemas no https", async () => {
    await expect(assertSafeFeedUrl("http://example.com/cal.ics")).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeFeedUrl("ftp://example.com/cal.ics")).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeFeedUrl("file:///etc/passwd")).rejects.toThrow(BlockedUrlError);
  });

  it("rechaza credenciales embebidas y puertos raros", async () => {
    await expect(assertSafeFeedUrl("https://user:pass@example.com/x")).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeFeedUrl("https://example.com:8443/x")).rejects.toThrow(BlockedUrlError);
  });

  it("rechaza loopback, privadas, link-local y metadata por IP literal", async () => {
    for (const bad of [
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://172.16.1.1/x",
      "https://192.168.1.1/x",
      "https://169.254.169.254/latest/meta-data", // metadata endpoint
      "https://100.64.0.1/x", // CGNAT
      "https://0.0.0.0/x",
      "https://[::1]/x",
      "https://[fe80::1]/x",
      "https://[fd00::1]/x",
      "https://[::ffff:127.0.0.1]/x",
    ]) {
      await expect(assertSafeFeedUrl(bad), bad).rejects.toThrow(BlockedUrlError);
    }
  });

  it("rechaza hostnames locales", async () => {
    await expect(assertSafeFeedUrl("https://localhost/x")).rejects.toThrow(BlockedUrlError);
    await expect(assertSafeFeedUrl("https://foo.local/x")).rejects.toThrow(BlockedUrlError);
  });

  it("rechaza dominios que RESUELVEN a IPs privadas (DNS rebinding)", async () => {
    lookupMock.mockResolvedValue([
      { address: "34.120.10.10", family: 4 },
      { address: "127.0.0.1", family: 4 }, // una sola dirección prohibida basta
    ]);
    await expect(assertSafeFeedUrl("https://evil.example.com/cal.ics")).rejects.toThrow(
      /IP no pública/,
    );
  });

  it("acepta un feed https válido con resolución pública", async () => {
    const url = await assertSafeFeedUrl("https://www.airbnb.com/calendar/ical/123.ics?s=abc");
    expect(url.hostname).toBe("www.airbnb.com");
    expect(lookupMock).toHaveBeenCalledWith("www.airbnb.com", { all: true, verbatim: true });
  });

  it("rechaza dominios que no resuelven", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(assertSafeFeedUrl("https://noexiste.example/x")).rejects.toThrow(
      /No se pudo resolver/,
    );
  });
});
