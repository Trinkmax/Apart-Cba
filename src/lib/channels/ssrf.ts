import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * Guard SSRF para feeds iCal entrantes. Las URLs las carga el operador, pero
 * viajan al servidor y se fetchean desde infraestructura propia, así que se
 * tratan como entrada no confiable:
 *
 *  - solo HTTPS, sin userinfo, sin puerto no estándar
 *  - DNS resuelto ANTES de conectar; toda IP debe ser unicast pública
 *  - redirects manuales (máx 3), cada salto re-validado
 *  - tamaño máximo, MIME whitelist, timeout duro
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB — un ICS de OTA pesa KBs
const ALLOWED_MIME = /text\/calendar|text\/plain/i;

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

function inCidr4(ip: number, base: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

/** true si la IPv4 NO es unicast pública. */
function isForbiddenIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return (
    inCidr4(n, "0.0.0.0", 8) || // "this network"
    inCidr4(n, "10.0.0.0", 8) || // privada
    inCidr4(n, "100.64.0.0", 10) || // CGNAT
    inCidr4(n, "127.0.0.0", 8) || // loopback
    inCidr4(n, "169.254.0.0", 16) || // link-local + metadata endpoints
    inCidr4(n, "172.16.0.0", 12) || // privada
    inCidr4(n, "192.0.0.0", 24) || // IETF
    inCidr4(n, "192.0.2.0", 24) || // TEST-NET
    inCidr4(n, "192.168.0.0", 16) || // privada
    inCidr4(n, "198.18.0.0", 15) || // benchmarking
    inCidr4(n, "198.51.100.0", 24) || // TEST-NET-2
    inCidr4(n, "203.0.113.0", 24) || // TEST-NET-3
    inCidr4(n, "224.0.0.0", 3) // multicast + reservado + broadcast
  );
}

/** true si la IPv6 NO es unicast pública. */
function isForbiddenIpv6(raw: string): boolean {
  const ip = raw.toLowerCase();
  if (ip === "::" || ip === "::1") return true; // unspecified / loopback
  if (ip.startsWith("fe80") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb"))
    return true; // link-local fe80::/10
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique-local fc00::/7
  if (ip.startsWith("ff")) return true; // multicast
  if (ip.startsWith("::ffff:")) {
    // IPv4-mapped — validar la parte v4
    const v4 = ip.slice(7);
    if (isIP(v4) === 4) return isForbiddenIpv4(v4);
    return true;
  }
  if (ip.startsWith("2001:db8")) return true; // documentación
  return false;
}

function isForbiddenIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isForbiddenIpv4(ip);
  if (kind === 6) return isForbiddenIpv6(ip);
  return true; // no es una IP válida
}

/**
 * Valida la URL (esquema/estructura) y su resolución DNS. Lanza BlockedUrlError
 * con un mensaje SIN la URL completa (para no filtrar tokens en logs).
 */
export async function assertSafeFeedUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("URL inválida");
  }
  if (url.protocol !== "https:") {
    throw new BlockedUrlError("Solo se aceptan URLs https://");
  }
  if (url.username || url.password) {
    throw new BlockedUrlError("La URL no puede incluir credenciales");
  }
  if (url.port && url.port !== "443") {
    throw new BlockedUrlError("Puerto no permitido (solo 443)");
  }
  const host = url.hostname;
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new BlockedUrlError("Host no permitido");
  }
  // Host literal IP → validar directo
  const literal = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(literal)) {
    if (isForbiddenIp(literal)) throw new BlockedUrlError("La IP de destino no es pública");
    return url;
  }
  // Resolver DNS y validar TODAS las direcciones
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BlockedUrlError("No se pudo resolver el dominio");
  }
  if (addresses.length === 0) throw new BlockedUrlError("El dominio no resuelve");
  for (const a of addresses) {
    if (isForbiddenIp(a.address)) {
      throw new BlockedUrlError("El dominio resuelve a una IP no pública");
    }
  }
  return url;
}

export interface SafeFetchResult {
  status: number;
  body?: string;
  etag?: string | null;
  lastModified?: string | null;
  contentType?: string | null;
}

/**
 * Fetch endurecido para feeds: valida cada salto de redirect, corta por tamaño
 * y timeout, y exige MIME de calendario.
 */
export async function safeFetchFeed(
  rawUrl: string,
  opts: { etag?: string | null; lastModified?: string | null; timeoutMs?: number } = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const deadline = AbortSignal.timeout(timeoutMs);

  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertSafeFeedUrl(current);

    const headers: Record<string, string> = {
      "user-agent": "ApartCba-ChannelSync/2.0 (+https://www.apartcba.com)",
      accept: "text/calendar, text/plain;q=0.8",
    };
    if (opts.etag) headers["if-none-match"] = opts.etag;
    if (opts.lastModified) headers["if-modified-since"] = opts.lastModified;

    const res = await fetch(url.toString(), {
      method: "GET",
      headers,
      redirect: "manual",
      signal: deadline,
      cache: "no-store",
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      res.body?.cancel().catch(() => {});
      if (!location) throw new BlockedUrlError("Redirect sin destino");
      if (hop === MAX_REDIRECTS) throw new BlockedUrlError("Demasiados redirects");
      current = new URL(location, url).toString();
      continue;
    }

    if (res.status === 304) {
      res.body?.cancel().catch(() => {});
      return { status: 304 };
    }

    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return { status: res.status };
    }

    const contentType = res.headers.get("content-type");
    if (contentType && !ALLOWED_MIME.test(contentType)) {
      res.body?.cancel().catch(() => {});
      throw new BlockedUrlError(`Tipo de contenido no permitido (${contentType.split(";")[0]})`);
    }

    // Lectura acotada por tamaño
    const reader = res.body?.getReader();
    if (!reader) return { status: res.status, body: "" };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new BlockedUrlError("El feed excede el tamaño máximo permitido");
      }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString("utf8");
    return {
      status: res.status,
      body,
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
      contentType,
    };
  }
  throw new BlockedUrlError("Demasiados redirects");
}
